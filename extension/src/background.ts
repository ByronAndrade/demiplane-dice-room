import {
  createRollId,
  createRoomId,
  createRoomSocketUrl,
  isServerMessage,
  protocolVersion,
  type BackgroundMessage,
  type CapturedRoll,
  type ConnectionState,
  type RollEvent,
  type ServerMessage,
  type StoredRoll
} from "./shared/protocol";
import { getClientId, getConfig, saveConfig, type ExtensionConfig } from "./shared/storage";

type RuntimeRequest =
  | { kind: "popup:get-state" }
  | { kind: "popup:save-config"; config: ExtensionConfig }
  | { kind: "popup:connect" }
  | { kind: "popup:disconnect" }
  | { kind: "popup:test-roll" }
  | { kind: "content:ready" }
  | { kind: "content:captured-roll"; roll: CapturedRoll };

const localHistoryVersion = 8;
const liveRollStorageKey = "lastLiveRoll";
const panelUiStorageKey = "diceRoomPanelUi";
const protectedDefaultRelayHost = "demiplane-dice-room-relay.foxbyron.workers.dev";

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
let manualDisconnect = true;
let forcedDisconnectDetail: string | undefined;
let recentRolls: StoredRoll[] = [];

let connectionState: ConnectionState = {
  status: "disconnected",
  detail: "Desconectado",
  players: []
};

void bootstrap();

chrome.runtime.onInstalled.addListener(() => {
  void getClientId();
  void bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  void handleRuntimeMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Erro inesperado" });
    });

  return true;
});

async function handleRuntimeMessage(message: RuntimeRequest): Promise<unknown> {
  switch (message.kind) {
    case "popup:get-state":
    case "content:ready":
      if (message.kind === "popup:get-state") {
        await ensureContentScriptOnActiveDemiplaneTab();
      }
      await maybeAutoConnect();
      return {
        ok: true,
        state: connectionState,
        config: await getConfig(),
        recentRolls,
        lastLiveRoll: await loadLastLiveRoll()
      };

    case "popup:save-config": {
      const current = await getConfig();
      const config = await saveConfig({ ...message.config, autoConnect: current.autoConnect });
      return { ok: true, config, state: connectionState };
    }

    case "popup:connect":
      await ensureContentScriptOnActiveDemiplaneTab();
      await connect();
      return { ok: true, state: connectionState };

    case "popup:disconnect":
      await disconnect();
      return { ok: true, state: connectionState };

    case "popup:test-roll":
      await ensureContentScriptOnActiveDemiplaneTab();
      return publishCapturedRoll(createTestRoll());

    case "content:captured-roll":
      return publishCapturedRoll(message.roll);
  }
}

async function connect(): Promise<void> {
  const config = await getConfig();

  if (!config.playerName || !config.channel) {
    setConnectionState({
      status: "error",
        detail: "Informe nome do jogador e canal da mesa.",
        roomId: undefined,
        players: [],
        connectedAt: undefined
      });
    return;
  }

  if (requiresRelayKey(config)) {
    setConnectionState({
      status: "error",
      detail: "Informe a chave do relay ou use um relay proprio/local.",
      roomId: undefined,
      players: [],
      connectedAt: undefined
    });
    return;
  }

  clearReconnectTimer();
  manualDisconnect = false;
  forcedDisconnectDetail = undefined;
  await saveConfig({ ...config, autoConnect: true });

  if (socket) {
    socket.close();
  }

  setConnectionState({
    status: "connecting",
      detail: "Conectando ao relay...",
      roomId: undefined,
      players: [],
      connectedAt: undefined
  });

  const clientId = await getClientId();
  const publicCharacterName = await getPublicCharacterName(config);
  let socketUrl: string;
  try {
    socketUrl = createRoomSocketUrl(config.serverUrl, await createRoomId(config.channel, config.password), config.relayKey);
  } catch {
    setConnectionState({
      status: "error",
      detail: `Relay invalido: ${config.serverUrl}`,
      roomId: undefined,
      players: [],
      connectedAt: undefined
    });
    return;
  }

  const nextSocket = new WebSocket(socketUrl);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    sendSocketMessage({
      type: "hello",
      version: protocolVersion,
      clientId,
      playerName: config.playerName,
      characterName: publicCharacterName,
      roomRole: config.roomRole,
      channel: config.channel,
      password: config.password
    });

    setConnectionState({
      ...connectionState,
      status: "connecting",
      detail: "Entrando na sala..."
    });
  });

  nextSocket.addEventListener("message", (event) => {
    const parsed = parseServerMessage(event.data);

    if (!parsed) {
      setConnectionState({
        ...connectionState,
        status: "error",
        detail: "Relay enviou uma mensagem invalida."
      });
      return;
    }

    handleServerMessage(parsed);
  });

  nextSocket.addEventListener("close", () => {
    if (socket !== nextSocket) {
      return;
    }

    socket = undefined;

    if (manualDisconnect) {
      if (forcedDisconnectDetail) {
        const detail = forcedDisconnectDetail;
        forcedDisconnectDetail = undefined;
        setConnectionState({
          status: "error",
          detail,
          roomId: undefined,
          players: [],
          connectedAt: undefined
        });
        void restoreLocalHistory();
        return;
      }

      setConnectionState({
        status: "disconnected",
        detail: "Desconectado",
        roomId: undefined,
        players: [],
        connectedAt: undefined
      });
      void restoreLocalHistory();
      return;
    }

    setConnectionState({
      ...connectionState,
      status: "error",
      detail: `Conexao com ${config.serverUrl} encerrada. Tentando reconectar...`
    });
    scheduleReconnect();
  });

  nextSocket.addEventListener("error", () => {
    if (socket !== nextSocket) {
      return;
    }

    setConnectionState({
      ...connectionState,
      status: "error",
      detail: `Nao foi possivel conectar em ${config.serverUrl}. Verifique o endereco do relay ou use o modo local.`
    });
  });
}

async function disconnect(): Promise<void> {
  manualDisconnect = true;
  forcedDisconnectDetail = undefined;
  clearReconnectTimer();
  const config = await getConfig();
  await saveConfig({ ...config, autoConnect: false });

  if (socket) {
    socket.close();
    socket = undefined;
  }

  setConnectionState({
    status: "disconnected",
    detail: "Desconectado",
    roomId: undefined,
    players: [],
    connectedAt: undefined
  });
  await restoreLocalHistory();
}

async function publishCapturedRoll(captured: CapturedRoll): Promise<{ ok: true; delivered: string; roll: RollEvent }> {
  const config = await getConfig();
  const clientId = await getClientId();
  const createdAt = captured.createdAt || new Date().toISOString();
  const publicCharacterName = await getPublicCharacterName(config, captured.characterName);

  const roll: RollEvent = {
    type: "roll",
    version: protocolVersion,
    id: createRollId(clientId, captured.signature, createdAt),
    clientId,
    playerName: config.playerName || "Jogador",
    characterName: publicCharacterName,
    source: "demiplane",
    system: "vampire",
    rollTitle: captured.rollTitle || "Rolagem",
    successes: captured.successes ?? null,
    total: captured.total ?? null,
    dice: captured.dice,
    rawText: captured.rawText,
    createdAt
  };

  const canSend = socket?.readyState === WebSocket.OPEN && connectionState.status === "connected";
  const delivery = canSend ? "sent" : "local";
  rememberRoll({
    roll,
    origin: "local",
    delivery
  });
  rememberLastLiveRoll({ roll, origin: "local", delivery });

  broadcastToContent({
    kind: "background:roll-event",
    roll,
    origin: "local",
    delivery
  });

  if (canSend) {
    sendSocketMessage({ type: "roll", version: protocolVersion, roll });
  }

  return { ok: true, delivered: delivery, roll };
}

async function getPublicCharacterName(config: ExtensionConfig, sheetCharacterName?: string): Promise<string | undefined> {
  if (!config.hideCharacterName || config.roomRole !== "host") {
    return cleanDisplayName(sheetCharacterName) || cleanDisplayName(config.characterName);
  }

  const stored = await chrome.storage.local.get({
    [panelUiStorageKey]: {
      language: "pt-BR"
    }
  });
  const value = stored[panelUiStorageKey] as { language?: unknown } | undefined;
  return value?.language === "en" ? "Storyteller" : "Narrador";
}

function cleanDisplayName(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function handleServerMessage(message: ServerMessage): void {
  switch (message.type) {
    case "welcome":
      setConnectionState({
        status: "connected",
        detail: "Conectado",
        roomId: message.roomId,
        players: message.players,
        connectedAt: new Date().toISOString()
      });
      replaceRoomHistory(message.history);
      return;

    case "presence":
      setConnectionState({
        ...connectionState,
        status: connectionState.status === "connected" ? "connected" : connectionState.status,
        roomId: message.roomId,
        players: message.players
      });
      return;

    case "heartbeat":
      return;

    case "roll":
      rememberRoll({
        roll: message.roll,
        origin: "remote",
        delivery: "received"
      });
      rememberLastLiveRoll({
        roll: message.roll,
        origin: "remote",
        delivery: "received"
      });
      broadcastToContent({
        kind: "background:roll-event",
        roll: message.roll,
        origin: "remote",
        delivery: "received"
      });
      return;

    case "error":
      if (isTerminalRoomError(message.code)) {
        manualDisconnect = true;
        forcedDisconnectDetail = message.message;
        void getConfig().then((config) => saveConfig({ ...config, autoConnect: false }));
        if (socket) {
          socket.close();
          socket = undefined;
        }
        setConnectionState({
          status: "error",
          detail: message.message,
          roomId: undefined,
          players: [],
          connectedAt: undefined
        });
        void restoreLocalHistory();
        return;
      }
      setConnectionState({
        ...connectionState,
        status: "error",
        detail: message.message
      });
      return;
  }
}

function isTerminalRoomError(code: string): boolean {
  return code === "room_closed" || code === "room_full" || code === "room_host_exists";
}

async function bootstrap(): Promise<void> {
  recentRolls = await loadStoredRolls();
  await maybeAutoConnect();
}

async function maybeAutoConnect(): Promise<void> {
  const config = await getConfig();
  if (!config.autoConnect || socket?.readyState === WebSocket.OPEN || connectionState.status === "connecting") {
    return;
  }

  if (!config.playerName || !config.channel) {
    return;
  }

  await connect();
}

async function ensureContentScriptOnActiveDemiplaneTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !isDemiplaneCharacterSheetUrl(tab.url)) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch {
    // Manifest injection may already have loaded the script, or the tab may reject injection.
  }
}

function isDemiplaneCharacterSheetUrl(url: string | undefined): boolean {
  return Boolean(
    url?.startsWith("https://app.demiplane.com/nexus/") && url.includes("/character-sheet/")
  );
}

function rememberRoll(storedRoll: StoredRoll): void {
  if (!isUsefulRoll(storedRoll.roll)) {
    return;
  }

  if (recentRolls.some((item) => item.roll.id === storedRoll.roll.id)) {
    return;
  }

  setRecentRolls([storedRoll, ...recentRolls]);
}

function replaceRoomHistory(history: RollEvent[]): void {
  const storedHistory: StoredRoll[] = [...history]
    .filter(isUsefulRoll)
    .reverse()
    .map((roll) => ({
      roll,
      origin: "remote",
      delivery: "history"
    }));

  setRecentRolls(storedHistory, { persist: false });
  broadcastHistory();
}

function setRecentRolls(nextRolls: StoredRoll[], options: { persist?: boolean } = {}): void {
  const seen = new Set<string>();
  recentRolls = [];

  for (const item of nextRolls) {
    if (!isUsefulRoll(item.roll)) {
      continue;
    }

    if (seen.has(item.roll.id)) {
      continue;
    }

    seen.add(item.roll.id);
    recentRolls.push(item);

    if (recentRolls.length >= 100) {
      break;
    }
  }

  if (options.persist ?? shouldPersistLocalHistory()) {
    void chrome.storage.local.set({ recentRolls, localHistoryVersion });
  }
}

function shouldPersistLocalHistory(): boolean {
  return connectionState.status !== "connected" || !connectionState.roomId;
}

async function restoreLocalHistory(): Promise<void> {
  recentRolls = await loadStoredRolls();
  broadcastHistory();
}

function rememberLastLiveRoll(storedRoll: StoredRoll): void {
  if (!isUsefulRoll(storedRoll.roll) || storedRoll.delivery === "history") {
    return;
  }

  void chrome.storage.local.set({ [liveRollStorageKey]: storedRoll });
}

async function loadLastLiveRoll(): Promise<StoredRoll | undefined> {
  const stored = await chrome.storage.local.get({ [liveRollStorageKey]: undefined });
  const roll = stored[liveRollStorageKey] as StoredRoll | undefined;
  return roll && isUsefulRoll(roll.roll) && roll.delivery !== "history" ? roll : undefined;
}

async function loadStoredRolls(): Promise<StoredRoll[]> {
  const stored = await chrome.storage.local.get({ recentRolls: [], localHistoryVersion: 0 });

  if (stored.localHistoryVersion !== localHistoryVersion) {
    await chrome.storage.local.set({ recentRolls: [], localHistoryVersion });
    return [];
  }

  return Array.isArray(stored.recentRolls) ? (stored.recentRolls as StoredRoll[]).filter((item) => isUsefulRoll(item.roll)) : [];
}

function broadcastHistory(): void {
  const message: BackgroundMessage = {
    kind: "background:roll-history",
    rolls: recentRolls
  };

  sendRuntimeMessage(message);
  broadcastToContent(message);
}

function sendSocketMessage(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function requiresRelayKey(config: ExtensionConfig): boolean {
  if (config.relayKey) {
    return false;
  }

  try {
    return new URL(config.serverUrl).hostname === protectedDefaultRelayHost;
  } catch {
    return false;
  }
}

function scheduleReconnect(): void {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connect();
  }, 2500);
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function setConnectionState(nextState: ConnectionState): void {
  connectionState = nextState;
  const message: BackgroundMessage = {
    kind: "background:connection-state",
    state: connectionState
  };

  sendRuntimeMessage(message);
  broadcastToContent(message);
}

function broadcastToContent(message: BackgroundMessage): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) {
        continue;
      }

      chrome.tabs.sendMessage(tab.id, message, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}

function sendRuntimeMessage(message: BackgroundMessage): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function parseServerMessage(data: unknown): ServerMessage | undefined {
  if (typeof data !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    return isServerMessage(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function createTestRoll(): CapturedRoll {
  const createdAt = new Date().toISOString();
  return {
    rollTitle: "STRENGTH + ATHLETICS",
    successes: 2,
    total: null,
    dice: [
      { kind: "regular", value: 8, sides: 10, face: "success" },
      { kind: "regular", value: 5, sides: 10, face: "blank" },
      { kind: "hunger", value: 10, sides: 10, face: "critical" }
    ],
    rawText: "STRENGTH + ATHLETICS\nSUCCESSES: 2\n8 5 10",
    createdAt,
    signature: `test-${createdAt}`
  };
}

function isUsefulRoll(roll: RollEvent | undefined): roll is RollEvent {
  if (!roll) {
    return false;
  }

  return (
    isUsefulRollTitle(roll.rollTitle) &&
    typeof roll.successes === "number" &&
    !/(add dice to roll|dice pool|clear|regular\s+hunger)/i.test(roll.rawText)
  );
}

function isUsefulRollTitle(value: string): boolean {
  const title = value.trim();
  return isMultiPartRollTitle(title) || isSingleTraitRollTitle(title) || /^custom(?:[ \t]*\([ \t]*re-?roll[ \t]*\))?$/i.test(title);
}

function isMultiPartRollTitle(value: string): boolean {
  const parts = stripRerollTitleSuffix(value).split("+").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 && parts.every(isTraitTitlePart);
}

function isSingleTraitRollTitle(value: string): boolean {
  const title = stripRerollTitleSuffix(value);
  if (!isTraitTitlePart(title) || isMultiPartRollTitle(title)) {
    return false;
  }

  return !/^(ADD DICE TO ROLL|ATTRIBUTES|CLEAR|COTERIE|CUSTOM|DETAILS|DETAILED|DICE POOL|DISCIPLINES|EXPAND|FLAWS|GAME RULES|GROUPS|HEALTH|HUMANITY|HUNGER|INVENTORY|LIBRARY|LOCAL|MENTAL|MERITS|NOTES|PHYSICAL|RE-ROLL|REROLL|ROLL|SELECT DICE TO REROLL|SKILLS|SOCIAL|SUCCESSES?|SUCCESS|WILLPOWER)$/i.test(
    title
  );
}

function isTraitTitlePart(value: string): boolean {
  return /^[A-Z][A-Z '-]{1,50}$/i.test(value.trim());
}

function stripRerollTitleSuffix(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[ \t]*\([ \t]*re-?roll[ \t]*\)$/i, "").trim();
}
