import {
  activeDiceRollTtlMs,
  createRollId,
  createRoomId,
  createRoomSocketUrl,
  isServerMessage,
  protocolVersion,
  type ActiveDiceRoll,
  type BackgroundMessage,
  type CapturedRoll,
  type ConnectionState,
  type DiceValue,
  type RollEvent,
  type ServerMessage,
  type SharedDiceClearEvent,
  type SharedDiceControlEvent,
  type StoredRoll
} from "./shared/protocol";
import { getClientId, getConfig, getHostRoomKey, saveConfig, type ExtensionConfig } from "./shared/storage";

type RuntimeRequest =
  | { kind: "popup:get-state" }
  | { kind: "popup:save-config"; config: ExtensionConfig }
  | { kind: "popup:connect" }
  | { kind: "popup:disconnect" }
  | { kind: "popup:approve-player"; clientId: string }
  | { kind: "popup:reject-player"; clientId: string }
  | { kind: "popup:kick-player"; clientId: string }
  | { kind: "popup:test-roll" }
  | { kind: "content:ready" }
  | { kind: "content:sheet-activity"; active: boolean }
  | { kind: "content:dice-control"; event: SharedDiceControlEvent }
  | { kind: "content:dice-clear"; event: SharedDiceClearEvent }
  | { kind: "content:manual-d10" }
  | { kind: "content:manual-dice-pool"; regular: number; hunger: number }
  | { kind: "content:roll-compulsion"; parentRollId: string }
  | { kind: "content:captured-roll"; roll: CapturedRoll };

const localHistoryVersion = 9;
const liveRollStorageKey = "lastLiveRoll";
const roomHistoryStorageKey = "roomHistories";
const activeDiceRollStorageKey = "activeDiceRolls";
const pendingRoomRollStorageKey = "pendingRoomRolls";
const panelUiStorageKey = "diceRoomPanelUi";
const socketKeepAliveMs = 20_000;
const sheetActivityFreshMs = 15_000;
const sheetPresenceReportMs = 5_000;
const maxPendingRoomRolls = 100;
const maxManualDicePoolDice = 15;

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
let socketKeepAliveTimer: number | undefined;
let sheetPresenceTimer: number | undefined;
let manualDisconnect = true;
let forcedDisconnectDetail: string | undefined;
let recentRolls: StoredRoll[] = [];
let activeHistoryRoomId: string | undefined;
let pendingRoomRolls: RollEvent[] = [];
let activeDiceRolls: ActiveDiceRoll[] = [];
let lastSheetActivityAt = 0;
let lastReportedSheetActive: boolean | undefined;

let connectionState: ConnectionState = {
  status: "disconnected",
  detail: "Desconectado",
  players: [],
  pendingPlayers: []
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
      if (message.kind === "popup:get-state") {
        await ensureContentScriptOnActiveDemiplaneTab();
      }
      await maybeAutoConnect();
      return {
        ok: true,
        state: connectionState,
        config: await getConfig(),
        recentRolls,
        activeDiceRolls: await loadActiveDiceRolls(),
        lastLiveRoll: await loadLastLiveRoll()
      };

    case "content:ready":
      noteSheetActivity();
      await maybeAutoConnect();
      reportSheetPresenceStatus(true);
      return {
        ok: true,
        state: connectionState,
        config: await getConfig(),
        recentRolls,
        activeDiceRolls: await loadActiveDiceRolls(),
        lastLiveRoll: await loadLastLiveRoll()
      };

    case "content:sheet-activity":
      if (message.active) {
        noteSheetActivity();
      }
      reportSheetPresenceStatus();
      return { ok: true };

    case "content:dice-control":
      return publishDiceControlEvent(message.event);

    case "content:dice-clear":
      return publishDiceClearEvent(message.event);

    case "content:manual-d10":
      return publishManualD10Roll();

    case "content:manual-dice-pool":
      return publishManualDicePoolRoll(message.regular, message.hunger);

    case "content:roll-compulsion":
      return publishCompulsionRoll(message.parentRollId);

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

    case "popup:approve-player":
      sendSocketMessage({ type: "approve_player", version: protocolVersion, clientId: message.clientId });
      return { ok: true, state: connectionState };

    case "popup:reject-player":
      sendSocketMessage({ type: "reject_player", version: protocolVersion, clientId: message.clientId });
      return { ok: true, state: connectionState };

    case "popup:kick-player":
      sendSocketMessage({ type: "kick_player", version: protocolVersion, clientId: message.clientId });
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
        clientId: undefined,
        players: [],
        pendingPlayers: [],
        connectedAt: undefined
      });
    return;
  }

  clearReconnectTimer();
  manualDisconnect = false;
  forcedDisconnectDetail = undefined;
  await saveConfig({ ...config, autoConnect: true });
  const clientId = await getClientId();

  if (socket) {
    socket.close();
  }

  setConnectionState({
    status: "connecting",
      detail: "Conectando ao relay...",
      roomId: undefined,
      clientId,
      players: [],
      pendingPlayers: [],
      connectedAt: undefined
  });

  const publicCharacterName = await getPublicCharacterName(config);
  let roomId: string;
  let socketUrl: string;
  try {
    roomId = await createRoomId(config.channel, config.password);
    socketUrl = createRoomSocketUrl(config.serverUrl, roomId, config.relayKey);
  } catch {
    setConnectionState({
      status: "error",
      detail: `Relay invalido: ${config.serverUrl}`,
      roomId: undefined,
      clientId,
      players: [],
      pendingPlayers: [],
      connectedAt: undefined
    });
    return;
  }
  const hostKey = config.roomRole === "host" ? await getHostRoomKey(roomId) : undefined;

  const nextSocket = new WebSocket(socketUrl);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    startSocketKeepAlive(nextSocket);
    startSheetPresenceMonitor(nextSocket);
    const helloMessage = {
      type: "hello",
      version: protocolVersion,
      clientId,
      playerName: config.playerName,
      characterName: publicCharacterName,
      roomRole: config.roomRole,
      channel: config.channel,
      password: config.password
    } as const;
    sendSocketMessage(hostKey ? { ...helloMessage, hostKey } : helloMessage);

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
    stopSocketKeepAlive();
    stopSheetPresenceMonitor();

    if (manualDisconnect) {
      if (forcedDisconnectDetail) {
        const detail = forcedDisconnectDetail;
        forcedDisconnectDetail = undefined;
        setConnectionState({
          status: "error",
          detail,
          roomId: undefined,
          clientId: undefined,
          players: [],
          pendingPlayers: [],
          connectedAt: undefined
        });
        activeHistoryRoomId = undefined;
        clearPendingRoomRolls();
        void restoreLocalHistory({ preserveLocalRoomRolls: true });
        return;
      }

      setConnectionState({
        status: "disconnected",
        detail: "Desconectado",
        roomId: undefined,
        clientId: undefined,
        players: [],
        pendingPlayers: [],
        connectedAt: undefined
      });
      activeHistoryRoomId = undefined;
      clearPendingRoomRolls();
      void restoreLocalHistory({ preserveLocalRoomRolls: true });
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

    stopSocketKeepAlive();
    stopSheetPresenceMonitor();
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
    sendSocketMessage({ type: "leave_room", version: protocolVersion });
    socket.close(1000, "leave_room");
    socket = undefined;
  }
  stopSocketKeepAlive();
  stopSheetPresenceMonitor();

  setConnectionState({
    status: "disconnected",
    detail: "Desconectado",
    roomId: undefined,
    clientId: undefined,
    players: [],
    pendingPlayers: [],
    connectedAt: undefined
  });
  activeHistoryRoomId = undefined;
  clearPendingRoomRolls();
  await restoreLocalHistory({ preserveLocalRoomRolls: true });
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

  return publishRollEvent(roll);
}

async function publishManualD10Roll(): Promise<{ ok: true; delivered: string; roll: RollEvent }> {
  const config = await getConfig();
  const clientId = await getClientId();
  const createdAt = new Date().toISOString();
  const value = secureRandomInt(1, 10);
  const label = formatManualD10Label(value);
  const publicCharacterName = await getPublicCharacterName(config);
  const roll: RollEvent = {
    type: "roll",
    version: protocolVersion,
    id: createRollId(clientId, `manual-d10:${value}:${crypto.randomUUID()}`, createdAt),
    clientId,
    playerName: config.playerName || "Jogador",
    characterName: publicCharacterName,
    source: "extension",
    system: "generic",
    rollTitle: "1d10",
    successes: null,
    total: value,
    dice: [
      {
        kind: "regular",
        value,
        sides: 10,
        face: "blank",
        label
      }
    ],
    rawText: `1d10\nResultado: ${label}`,
    createdAt
  };

  return publishRollEvent(roll);
}

async function publishManualDicePoolRoll(
  regularInput: number,
  hungerInput: number
): Promise<{ ok: true; delivered: string; roll: RollEvent }> {
  const config = await getConfig();
  const clientId = await getClientId();
  const createdAt = new Date().toISOString();
  const regular = clampInteger(regularInput, 0, maxManualDicePoolDice);
  const hunger = clampInteger(hungerInput, 0, maxManualDicePoolDice - regular);
  const dice = [
    ...Array.from({ length: regular }, () => rollVampireDie("regular")),
    ...Array.from({ length: hunger }, () => rollVampireDie("hunger"))
  ];
  const publicCharacterName = await getPublicCharacterName(config);
  const successes = calculateVampireSuccesses(dice);
  const roll: RollEvent = {
    type: "roll",
    version: protocolVersion,
    id: createRollId(clientId, `manual-pool:${regular}:${hunger}:${diceKey(dice)}:${crypto.randomUUID()}`, createdAt),
    clientId,
    playerName: config.playerName || "Jogador",
    characterName: publicCharacterName,
    source: "extension",
    system: "vampire",
    rollTitle: "CUSTOM",
    successes,
    total: null,
    dice,
    rawText: [
      "CUSTOM",
      `Successes: ${successes}`,
      `Regular: ${regular}`,
      `Hunger: ${hunger}`,
      `Details: ${dice.map((die) => `${die.kind}:${formatManualD10Label(die.value)}`).join(", ")}`
    ].join("\n"),
    createdAt
  };

  return publishRollEvent(roll);
}

async function publishCompulsionRoll(parentRollId: string): Promise<{ ok: true; delivered: string; roll: RollEvent; existing?: boolean }> {
  const cleanParentRollId = parentRollId.trim();
  const existing = recentRolls.find((item) => getCompulsionParentRollId(item.roll) === cleanParentRollId);
  if (existing) {
    return { ok: true, delivered: existing.delivery, roll: existing.roll, existing: true };
  }

  const config = await getConfig();
  const clientId = await getClientId();
  const createdAt = new Date().toISOString();
  const value = secureRandomInt(1, 10);
  const label = formatManualD10Label(value);
  const compulsionKey = getCompulsionResultKey(value);
  const compulsionLabel = compulsionResultLabel(compulsionKey);
  const publicCharacterName = await getPublicCharacterName(config);
  const roll: RollEvent = {
    type: "roll",
    version: protocolVersion,
    id: createRollId(clientId, `compulsion:${cleanParentRollId}:${value}:${crypto.randomUUID()}`, createdAt),
    clientId,
    playerName: config.playerName || "Jogador",
    characterName: publicCharacterName,
    source: "extension",
    system: "vampire",
    rollTitle: "1d10",
    successes: null,
    total: value,
    dice: [
      {
        kind: "regular",
        value,
        sides: 10,
        face: "blank",
        label
      }
    ],
    rawText: [
      "Compulsion",
      `Parent Roll: ${cleanParentRollId}`,
      `Result: ${label}`,
      `Compulsion Key: ${compulsionKey}`,
      `Compulsion: ${compulsionLabel}`
    ].join("\n"),
    createdAt
  };

  return publishRollEvent(roll);
}

async function publishRollEvent(roll: RollEvent): Promise<{ ok: true; delivered: string; roll: RollEvent }> {
  const config = await getConfig();
  const canSend = socket?.readyState === WebSocket.OPEN && connectionState.status === "connected";
  const shouldUseRoom = await shouldUseRoomDelivery(config);
  if ((canSend || shouldUseRoom) && !activeHistoryRoomId) {
    activeHistoryRoomId = connectionState.roomId || (await createRoomId(config.channel, config.password));
  }
  const delivery = canSend || shouldUseRoom ? "sent" : "local";
  rememberRoll({
    roll,
    origin: "local",
    delivery
  });
  rememberLastLiveRoll({ roll, origin: "local", delivery });
  rememberActiveDiceRoll(roll);

  broadcastToContent({
    kind: "background:roll-event",
    roll,
    origin: "local",
    delivery
  });

  if (canSend) {
    queueRoomRoll(roll);
    sendSocketMessage({ type: "roll", version: protocolVersion, roll });
  } else if (shouldUseRoom) {
    queueRoomRoll(roll);
    void maybeAutoConnect();
  }

  return { ok: true, delivered: delivery, roll };
}

async function publishDiceControlEvent(event: SharedDiceControlEvent): Promise<{ ok: boolean }> {
  const config = await getConfig();
  if (config.enableSharedDice === false || socket?.readyState !== WebSocket.OPEN || connectionState.status !== "connected") {
    return { ok: false };
  }

  sendSocketMessage({ type: "dice_control", version: protocolVersion, event });
  return { ok: true };
}

async function publishDiceClearEvent(event: SharedDiceClearEvent): Promise<{ ok: boolean }> {
  const config = await getConfig();
  if (config.enableSharedDice === false || socket?.readyState !== WebSocket.OPEN || connectionState.status !== "connected") {
    return { ok: false };
  }

  clearActiveDiceRolls();
  broadcastToContent({
    kind: "background:dice-clear",
    event
  });
  sendSocketMessage({ type: "dice_clear", version: protocolVersion, event });
  return { ok: true };
}

async function shouldUseRoomDelivery(config: ExtensionConfig): Promise<boolean> {
  if (!config.autoConnect || !config.playerName || !config.channel) {
    return false;
  }

  return true;
}

function queueRoomRoll(roll: RollEvent): void {
  if (pendingRoomRolls.some((pendingRoll) => pendingRoll.id === roll.id)) {
    return;
  }

  pendingRoomRolls.push(roll);
  pendingRoomRolls = pendingRoomRolls.slice(-maxPendingRoomRolls);
  void savePendingRoomRolls();
}

function flushPendingRoomRolls(): void {
  if (socket?.readyState !== WebSocket.OPEN || connectionState.status !== "connected") {
    return;
  }

  for (const roll of pendingRoomRolls) {
    sendSocketMessage({ type: "roll", version: protocolVersion, roll });
  }
}

function forgetPendingRoomRoll(rollId: string): void {
  pendingRoomRolls = pendingRoomRolls.filter((roll) => roll.id !== rollId);
  void savePendingRoomRolls();
}

function markPendingRoomRollRejected(rollId: string | undefined): void {
  const rejectedRollId = rollId ?? pendingRoomRolls[0]?.id;
  if (!rejectedRollId) {
    return;
  }

  pendingRoomRolls = pendingRoomRolls.filter((roll) => roll.id !== rejectedRollId);
  void savePendingRoomRolls();
  setRecentRolls(
    recentRolls.map((item): StoredRoll =>
      item.roll.id === rejectedRollId && item.origin === "local" && item.delivery === "sent"
        ? { ...item, delivery: "local" }
        : item
    )
  );

  const rejectedRoll = recentRolls.find((item) => item.roll.id === rejectedRollId);
  if (rejectedRoll) {
    rememberLastLiveRoll(rejectedRoll);
  }

  broadcastHistory();
}

function startSocketKeepAlive(activeSocket: WebSocket): void {
  stopSocketKeepAlive();
  socketKeepAliveTimer = setInterval(() => {
    if (socket !== activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      stopSocketKeepAlive();
      return;
    }

    sendSocketMessage({ type: "heartbeat", version: protocolVersion, createdAt: new Date().toISOString() });
  }, socketKeepAliveMs);
}

function stopSocketKeepAlive(): void {
  if (!socketKeepAliveTimer) {
    return;
  }

  clearInterval(socketKeepAliveTimer);
  socketKeepAliveTimer = undefined;
}

function startSheetPresenceMonitor(activeSocket: WebSocket): void {
  stopSheetPresenceMonitor();
  lastReportedSheetActive = undefined;
  sheetPresenceTimer = setInterval(() => {
    if (socket !== activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      stopSheetPresenceMonitor();
      return;
    }

    reportSheetPresenceStatus();
  }, sheetPresenceReportMs);
}

function stopSheetPresenceMonitor(): void {
  if (!sheetPresenceTimer) {
    return;
  }

  clearInterval(sheetPresenceTimer);
  sheetPresenceTimer = undefined;
  lastReportedSheetActive = undefined;
}

function noteSheetActivity(): void {
  lastSheetActivityAt = Date.now();
}

function isSheetRecentlyActive(): boolean {
  return lastSheetActivityAt > 0 && Date.now() - lastSheetActivityAt <= sheetActivityFreshMs;
}

function reportSheetPresenceStatus(force = false): void {
  const active = isSheetRecentlyActive();
  if (!force && active === lastReportedSheetActive) {
    return;
  }

  if (socket?.readyState !== WebSocket.OPEN || connectionState.status !== "connected") {
    lastReportedSheetActive = active;
    return;
  }

  sendSocketMessage({
    type: "view_status",
    version: protocolVersion,
    active,
    reportedAt: new Date().toISOString()
  });
  lastReportedSheetActive = active;
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
        clientId: message.clientId,
        players: message.players,
        pendingPlayers: [],
        connectedAt: new Date().toISOString()
      });
      void syncRoomHistory(message.roomId, message.history);
      syncActiveDiceRolls(message.activeDice ?? []);
      flushPendingRoomRolls();
      reportSheetPresenceStatus(true);
      return;

    case "presence":
      setConnectionState({
        ...connectionState,
        status: connectionState.status === "connected" ? "connected" : connectionState.status,
        roomId: message.roomId,
        players: message.players
      });
      return;

    case "approval_required":
      setConnectionState({
        ...connectionState,
        status: "pending",
        detail: message.message,
        roomId: message.roomId,
        players: [],
        pendingPlayers: []
      });
      return;

    case "pending_players":
      setConnectionState({
        ...connectionState,
        roomId: message.roomId,
        pendingPlayers: message.pendingPlayers
      });
      return;

    case "heartbeat":
      return;

    case "roll":
      if (message.roll.clientId === connectionState.clientId) {
        forgetPendingRoomRoll(message.roll.id);
        return;
      }

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
      rememberActiveDiceRoll(message.roll);
      broadcastToContent({
        kind: "background:roll-event",
        roll: message.roll,
        origin: "remote",
        delivery: "received"
      });
      return;

    case "dice_control":
      rememberActiveDiceControl(message.event);
      void getConfig().then((config) => {
        if (config.enableSharedDice === false) {
          return;
        }

        broadcastToContent({
          kind: "background:dice-control",
          event: message.event
        });
      });
      return;

    case "dice_clear":
      clearActiveDiceRolls();
      void getConfig().then((config) => {
        if (config.enableSharedDice === false) {
          return;
        }

        broadcastToContent({
          kind: "background:dice-clear",
          event: message.event
        });
      });
      return;

    case "error":
      if (message.code === "ignored_roll") {
        markPendingRoomRollRejected(message.rollId);
        return;
      }

      if (message.code === "rate_limited") {
        return;
      }

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
          clientId: undefined,
          players: [],
          pendingPlayers: [],
          connectedAt: undefined
        });
        activeHistoryRoomId = undefined;
        clearPendingRoomRolls();
        void restoreLocalHistory({ preserveLocalRoomRolls: true });
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
  return (
    code === "room_closed" ||
    code === "room_full" ||
    code === "room_host_exists" ||
    code === "room_not_found" ||
    code === "host_offline" ||
    code === "relay_key_required" ||
    code === "room_pending_full" ||
    code === "approval_rejected" ||
    code === "kicked" ||
    code === "session_replaced"
  );
}

async function bootstrap(): Promise<void> {
  recentRolls = await loadStoredRolls();
  pendingRoomRolls = await loadPendingRoomRolls();
  await maybeAutoConnect();
}

async function maybeAutoConnect(): Promise<void> {
  const config = await getConfig();
  if (!config.autoConnect || socket?.readyState === WebSocket.OPEN || connectionState.status === "connecting" || connectionState.status === "pending") {
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

async function syncRoomHistory(roomId: string, history: RollEvent[]): Promise<void> {
  const historyIds = new Set(history.map((roll) => roll.id));
  if (historyIds.size > 0) {
    pendingRoomRolls = pendingRoomRolls.filter((roll) => !historyIds.has(roll.id));
    void savePendingRoomRolls();
  }

  const storedHistory: StoredRoll[] = [...history]
    .filter(isUsefulRoll)
    .reverse()
    .map((roll) => ({
      roll,
      origin: "remote",
      delivery: "history"
    }));
  const cachedHistory = activeHistoryRoomId === roomId ? recentRolls : await loadSessionRoomHistory(roomId);
  const mergedHistory = [...storedHistory, ...cachedHistory].sort(compareStoredRollsNewestFirst);

  activeHistoryRoomId = roomId;
  setRecentRolls(mergedHistory, { persist: false });
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
  } else if (activeHistoryRoomId) {
    void saveSessionRoomHistory(activeHistoryRoomId, recentRolls);
  }
}

function shouldPersistLocalHistory(): boolean {
  return !activeHistoryRoomId && (connectionState.status !== "connected" || !connectionState.roomId);
}

async function restoreLocalHistory(options: { preserveLocalRoomRolls?: boolean } = {}): Promise<void> {
  const localRoomRolls = options.preserveLocalRoomRolls
    ? recentRolls
        .filter((item) => item.origin === "local" && item.delivery !== "history")
        .map((item): StoredRoll => ({ ...item, delivery: "local" }))
    : [];
  const storedRolls = await loadStoredRolls();

  if (localRoomRolls.length > 0) {
    setRecentRolls([...localRoomRolls, ...storedRolls].sort(compareStoredRollsNewestFirst), { persist: true });
  } else {
    recentRolls = storedRolls;
  }

  broadcastHistory();
}

function compareStoredRollsNewestFirst(a: StoredRoll, b: StoredRoll): number {
  return getRollTimestamp(b.roll) - getRollTimestamp(a.roll);
}

function getRollTimestamp(roll: RollEvent): number {
  const value = Date.parse(roll.createdAt);
  return Number.isFinite(value) ? value : 0;
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

async function loadPendingRoomRolls(): Promise<RollEvent[]> {
  const stored = await chrome.storage.local.get({ [pendingRoomRollStorageKey]: [] });
  return Array.isArray(stored[pendingRoomRollStorageKey])
    ? (stored[pendingRoomRollStorageKey] as RollEvent[]).filter(isUsefulRoll).slice(-maxPendingRoomRolls)
    : [];
}

function savePendingRoomRolls(): Promise<void> {
  return chrome.storage.local.set({
    [pendingRoomRollStorageKey]: pendingRoomRolls.filter(isUsefulRoll).slice(-maxPendingRoomRolls)
  });
}

function clearPendingRoomRolls(): void {
  pendingRoomRolls = [];
  void savePendingRoomRolls();
}

async function loadSessionRoomHistory(roomId: string): Promise<StoredRoll[]> {
  const storage = getSessionStorage();
  if (!storage) {
    return [];
  }

  const stored = await storage.get({ [roomHistoryStorageKey]: {} });
  const roomHistories = stored[roomHistoryStorageKey] as Record<string, StoredRoll[]> | undefined;
  const history = roomHistories?.[roomId];
  return Array.isArray(history) ? history.filter((item) => isUsefulRoll(item.roll)).slice(0, 100) : [];
}

async function saveSessionRoomHistory(roomId: string, history: StoredRoll[]): Promise<void> {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  const stored = await storage.get({ [roomHistoryStorageKey]: {} });
  const roomHistories = normalizeRoomHistoryMap(stored[roomHistoryStorageKey]);
  roomHistories[roomId] = history.slice(0, 100);

  const roomIds = Object.keys(roomHistories);
  for (const staleRoomId of roomIds.slice(0, Math.max(0, roomIds.length - 8))) {
    if (staleRoomId !== roomId) {
      delete roomHistories[staleRoomId];
    }
  }

  await storage.set({ [roomHistoryStorageKey]: roomHistories });
}

function rememberActiveDiceRoll(roll: RollEvent): void {
  const activeRolls = pruneActiveDiceRolls(activeDiceRolls).filter((item) => item.roll.id !== roll.id);
  activeRolls.push({
    roll,
    expiresAt: new Date(Date.now() + activeDiceRollTtlMs).toISOString(),
    controls: []
  });
  setActiveDiceRolls(activeRolls);
}

function rememberActiveDiceControl(event: SharedDiceControlEvent): void {
  const activeRolls = pruneActiveDiceRolls(activeDiceRolls);
  const activeRoll = activeRolls.find((item) => item.roll.id === event.rollId);
  if (!activeRoll) {
    setActiveDiceRolls(activeRolls);
    return;
  }

  const controls = activeRoll.controls ?? [];
  activeRoll.controls = [
    ...controls.filter((control) => control.dieIndex !== event.dieIndex),
    event
  ];
  setActiveDiceRolls(activeRolls);
}

function syncActiveDiceRolls(nextActiveRolls: ActiveDiceRoll[]): void {
  setActiveDiceRolls([...pruneActiveDiceRolls(nextActiveRolls), ...pruneActiveDiceRolls(activeDiceRolls)]);
}

function clearActiveDiceRolls(): void {
  activeDiceRolls = [];
  void saveActiveDiceRolls();
}

function setActiveDiceRolls(nextActiveRolls: ActiveDiceRoll[]): void {
  const seen = new Set<string>();
  activeDiceRolls = [];

  for (const item of pruneActiveDiceRolls(nextActiveRolls).sort(compareActiveDiceRollsOldestFirst)) {
    if (seen.has(item.roll.id) || !isUsefulRoll(item.roll)) {
      continue;
    }

    seen.add(item.roll.id);
    activeDiceRolls.push(item);
  }

  activeDiceRolls = activeDiceRolls.slice(-12);
  void saveActiveDiceRolls();
}

function compareActiveDiceRollsOldestFirst(a: ActiveDiceRoll, b: ActiveDiceRoll): number {
  return getRollTimestamp(a.roll) - getRollTimestamp(b.roll);
}

function pruneActiveDiceRolls(value: ActiveDiceRoll[]): ActiveDiceRoll[] {
  const now = Date.now();
  return value.filter((item) => isUsefulRoll(item.roll) && Date.parse(item.expiresAt) > now);
}

async function loadActiveDiceRolls(): Promise<ActiveDiceRoll[]> {
  const storage = getSessionStorage();
  const stored = storage ? await storage.get({ [activeDiceRollStorageKey]: [] }) : {};
  const storedActiveRolls = Array.isArray(stored[activeDiceRollStorageKey])
    ? (stored[activeDiceRollStorageKey] as ActiveDiceRoll[])
    : [];
  setActiveDiceRolls([...storedActiveRolls, ...activeDiceRolls]);
  return activeDiceRolls;
}

async function saveActiveDiceRolls(): Promise<void> {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  await storage.set({ [activeDiceRollStorageKey]: activeDiceRolls });
}

function normalizeRoomHistoryMap(value: unknown): Record<string, StoredRoll[]> {
  return value && typeof value === "object" ? { ...(value as Record<string, StoredRoll[]>) } : {};
}

function getSessionStorage(): chrome.storage.StorageArea | undefined {
  return (chrome.storage as typeof chrome.storage & { session?: chrome.storage.StorageArea }).session;
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

function secureRandomInt(min: number, max: number): number {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  const range = upper - lower + 1;
  if (range <= 0) {
    return lower;
  }

  const maxUint = 0xffffffff;
  const limit = maxUint - (maxUint % range);
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  return lower + (buffer[0] % range);
}

function formatManualD10Label(value: number): string {
  return value === 10 ? "0" : String(value);
}

function rollVampireDie(kind: "regular" | "hunger"): DiceValue {
  const value = secureRandomInt(1, 10);
  return {
    kind,
    value,
    sides: 10,
    face: getVampireDieFace(kind, value)
  };
}

function getVampireDieFace(kind: "regular" | "hunger", value: number): DiceValue["face"] {
  if (kind === "hunger" && value === 1) {
    return "skull";
  }
  if (value === 10) {
    return "critical";
  }
  if (value >= 6) {
    return "success";
  }
  return "blank";
}

function calculateVampireSuccesses(dice: DiceValue[]): number {
  const successCount = dice.filter((die) => die.face === "success").length;
  const criticalCount = dice.filter((die) => die.face === "critical").length;
  return successCount + criticalCount + Math.floor(criticalCount / 2) * 2;
}

function diceKey(dice: DiceValue[]): string {
  return dice.map((die) => `${die.kind}:${die.value}:${die.face ?? ""}`).join(",");
}

function clampInteger(value: number, min: number, max: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.min(max, Math.max(min, parsed));
}

type CompulsionResultKey = "hunger" | "dominance" | "harm" | "paranoia" | "clan";

function getCompulsionParentRollId(roll: RollEvent): string | undefined {
  if (!isCompulsionRoll(roll)) {
    return undefined;
  }

  return roll.rawText.match(/^Parent Roll:\s*(.+)$/im)?.[1]?.trim();
}

function getCompulsionResultKey(value: number): CompulsionResultKey {
  if (value >= 1 && value <= 3) {
    return "hunger";
  }
  if (value >= 4 && value <= 5) {
    return "dominance";
  }
  if (value >= 6 && value <= 7) {
    return "harm";
  }
  if (value >= 8 && value <= 9) {
    return "paranoia";
  }
  return "clan";
}

function compulsionResultLabel(key: CompulsionResultKey): string {
  if (key === "hunger") {
    return "Hunger";
  }
  if (key === "dominance") {
    return "Dominance";
  }
  if (key === "harm") {
    return "Harm";
  }
  if (key === "paranoia") {
    return "Paranoia";
  }
  return "Clan Compulsion";
}

function isExtensionD10Roll(roll: RollEvent): boolean {
  return (
    (roll.rollTitle.trim().toLowerCase() === "1d10" || roll.rollTitle.trim().toLowerCase() === "compulsion") &&
    typeof roll.total === "number" &&
    roll.total >= 1 &&
    roll.total <= 10 &&
    roll.dice.length === 1 &&
    roll.dice[0]?.sides === 10
  );
}

function isCompulsionRoll(roll: RollEvent): boolean {
  return roll.source === "extension" && isExtensionD10Roll(roll) && /^Compulsion$/im.test(roll.rawText);
}

function isExtensionDicePoolRoll(roll: RollEvent): boolean {
  return (
    roll.source === "extension" &&
    /^custom$/i.test(roll.rollTitle.trim()) &&
    typeof roll.successes === "number" &&
    roll.dice.length > 0 &&
    roll.dice.length <= maxManualDicePoolDice &&
    roll.dice.every((die) => die.sides === 10 && (die.kind === "regular" || die.kind === "hunger"))
  );
}

function isUsefulRoll(roll: RollEvent | undefined): roll is RollEvent {
  if (!roll) {
    return false;
  }

  if (roll.source === "extension") {
    return isExtensionD10Roll(roll) || isExtensionDicePoolRoll(roll);
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
