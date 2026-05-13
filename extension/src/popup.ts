import type { BackgroundMessage, ConnectionState, RollEvent, StoredRoll } from "./shared/protocol";
import { defaultConfig, type ExtensionConfig } from "./shared/storage";

const form = requireElement("#settingsForm", HTMLFormElement);
const statusPill = requireElement("#statusPill", HTMLSpanElement);
const playerCount = requireElement("#playerCount", HTMLElement);
const detail = requireElement("#detail", HTMLParagraphElement);
const connectButton = requireElement("#connectButton", HTMLButtonElement);
const disconnectButton = requireElement("#disconnectButton", HTMLButtonElement);
const testButton = requireElement("#testButton", HTMLButtonElement);
const lastRoll = requireElement("#lastRoll", HTMLDivElement);
const createRoomButton = requireElement("#createRoomButton", HTMLButtonElement);
const joinRoomButton = requireElement("#joinRoomButton", HTMLButtonElement);
const roomModeHint = requireElement("#roomModeHint", HTMLParagraphElement);
const localizedElements = Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]"));

const panelUiStorageKey = "diceRoomPanelUi";

type UiLanguage = "pt-BR" | "en";
type RoomMode = "host" | "join";
type RollOutcome = "bestialFailure" | "messyCritical" | "criticalSuccess" | "success" | "failure";
type DisplayConnectionStatus = ConnectionState["status"] | "local";

const messages = {
  "pt-BR": {
    playerNameLabel: "Nome do jogador",
    characterNameLabel: "Personagem",
    channelLabel: "Canal da mesa",
    passwordLabel: "Senha da sala",
    relayLabel: "Relay",
    roomFlowTitle: "Sala da mesa",
    createRoom: "Criar sala",
    joinRoom: "Entrar em sala",
    hostHint: "Para criar: escolha nome/senha e conecte em um relay online. Passe o nome e a senha para a mesa. O launcher local fica como fallback.",
    joinHint: "Para entrar: use o nome e a senha da sala que o narrador criou. Se todos usam o relay online, nao precisa abrir servidor local.",
    showOwnRollsLabel: "Mostrar minhas rolagens",
    showOwnRollsHelp: "O Demiplane ja mostra sua rolagem; deixe desligado para ver so a sala. Interpretacoes especiais ainda aparecem.",
    enableDiceAnimationLabel: "Animacao dos dados",
    enableDiceAnimationHelp: "Mostra os dados caindo e quicando na ficha, com som leve.",
    save: "Salvar",
    connect: "Conectar",
    disconnect: "Desconectar",
    inRoom: "na sala",
    test: "Teste",
    lastRollTitle: "Ultima rolagem",
    noRoll: "Nenhuma rolagem recebida.",
    connected: "Conectado",
    connecting: "Conectando",
    disconnected: "Desconectado",
    error: "Erro",
    localMode: "Local",
    localReady: "Modo local ativo na ficha. Conecte em uma sala para compartilhar com outros jogadores.",
    relayIssue: "Relay indisponivel",
    sent: "enviado",
    received: "recebido",
    history: "historico",
    local: "local",
    tested: "testou",
    failed: "Falhou.",
    resultCaptured: "Resultado capturado.",
    result: "Resultado",
    success: "sucesso",
    successes: "sucessos",
    outcomeBestialFailure: "Falha bestial",
    outcomeMessyCritical: "Critico bestial",
    outcomeCriticalSuccess: "Critico",
    missingConfig: "Informe nome do jogador e canal da mesa.",
    connectingRelay: "Conectando ao relay...",
    enteringRoom: "Entrando na sala...",
    invalidRelayMessage: "Relay enviou uma mensagem invalida."
  },
  en: {
    playerNameLabel: "Player name",
    characterNameLabel: "Character",
    channelLabel: "Table channel",
    passwordLabel: "Room password",
    relayLabel: "Relay",
    roomFlowTitle: "Table room",
    createRoom: "Create room",
    joinRoom: "Join room",
    hostHint: "To create: choose a room name/password and connect to an online relay. Share the name and password with the table. The local launcher remains a fallback.",
    joinHint: "To join: use the room name and password created by the Storyteller. If everyone uses the online relay, no local server is needed.",
    showOwnRollsLabel: "Show my own rolls",
    showOwnRollsHelp: "Demiplane already shows your roll; leave this off to see only the room. Special interpretations still appear.",
    enableDiceAnimationLabel: "Dice animation",
    enableDiceAnimationHelp: "Shows dice falling and bouncing on the sheet, with light sound.",
    save: "Save",
    connect: "Connect",
    disconnect: "Disconnect",
    inRoom: "in room",
    test: "Test",
    lastRollTitle: "Latest roll",
    noRoll: "No rolls received yet.",
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
    error: "Error",
    localMode: "Local",
    localReady: "Local mode is active on the sheet. Connect to a room to share with other players.",
    relayIssue: "Relay unavailable",
    sent: "sent",
    received: "received",
    history: "history",
    local: "local",
    tested: "rolled",
    failed: "Failed.",
    resultCaptured: "Result captured.",
    result: "Result",
    success: "success",
    successes: "successes",
    outcomeBestialFailure: "Bestial failure",
    outcomeMessyCritical: "Messy critical",
    outcomeCriticalSuccess: "Critical success",
    missingConfig: "Enter a player name and table channel.",
    connectingRelay: "Connecting to relay...",
    enteringRoom: "Entering room...",
    invalidRelayMessage: "Relay sent an invalid message."
  }
};

let uiLanguage: UiLanguage = "pt-BR";
let roomMode: RoomMode = "join";
let lastState: ConnectionState | undefined;
let renderedRoll: { roll: RollEvent; delivery: string } | undefined;

const inputs = {
  serverUrl: requireElement("#serverUrl", HTMLInputElement),
  playerName: requireElement("#playerName", HTMLInputElement),
  characterName: requireElement("#characterName", HTMLInputElement),
  channel: requireElement("#channel", HTMLInputElement),
  password: requireElement("#password", HTMLInputElement),
  showOwnRolls: requireElement("#showOwnRolls", HTMLInputElement),
  enableDiceAnimation: requireElement("#enableDiceAnimation", HTMLInputElement)
};

void loadState();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[panelUiStorageKey]) {
    return;
  }

  const nextValue = changes[panelUiStorageKey].newValue as { language?: unknown } | undefined;
  uiLanguage = nextValue?.language === "en" ? "en" : "pt-BR";
  applyLanguage();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

connectButton.addEventListener("click", () => {
  void saveSettings().then(() => sendRuntimeMessage({ kind: "popup:connect" }));
});

disconnectButton.addEventListener("click", () => {
  void sendRuntimeMessage({ kind: "popup:disconnect" });
});

createRoomButton.addEventListener("click", () => {
  roomMode = "host";
  updateRoomMode();
});

joinRoomButton.addEventListener("click", () => {
  roomMode = "join";
  updateRoomMode();
});

testButton.addEventListener("click", () => {
  void sendRuntimeMessage<{ ok: true; roll?: RollEvent; delivered?: string }>({ kind: "popup:test-roll" }).then(
    (response) => {
      if (response?.roll) {
        renderLastRoll(response.roll, response.delivered ?? "local");
      }
    }
  );
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage) => {
  if (message.kind === "background:connection-state") {
    renderState(message.state);
  }

  if (message.kind === "background:roll-event") {
    renderLastRoll(message.roll, message.delivery);
  }

  if (message.kind === "background:roll-history" && message.rolls[0]) {
    renderLastRoll(message.rolls[0].roll, message.rolls[0].delivery);
  }
});

async function loadState(): Promise<void> {
  await loadLanguage();
  applyLanguage();

  const response = await sendRuntimeMessage<{
    ok: true;
    config?: ExtensionConfig;
    state?: ConnectionState;
    recentRolls?: StoredRoll[];
    lastLiveRoll?: StoredRoll;
  }>({ kind: "popup:get-state" });

  fillConfig(response?.config ?? defaultConfig);

  if (response?.state) {
    renderState(response.state);
  }

  if (response?.lastLiveRoll) {
    renderLastRoll(response.lastLiveRoll.roll, response.lastLiveRoll.delivery);
  } else {
    renderEmptyLastRoll();
  }
}

async function saveSettings(): Promise<void> {
  const response = await sendRuntimeMessage<{ ok: true; config?: ExtensionConfig; state?: ConnectionState }>({
    kind: "popup:save-config",
    config: readConfig()
  });

  if (response?.config) {
    fillConfig(response.config);
  }

  if (response?.state) {
    renderState(response.state);
  }
}

function fillConfig(config: ExtensionConfig): void {
  inputs.serverUrl.value = config.serverUrl;
  inputs.playerName.value = config.playerName;
  inputs.characterName.value = config.characterName;
  inputs.channel.value = config.channel;
  inputs.password.value = config.password;
  inputs.showOwnRolls.checked = config.showOwnRolls;
  inputs.enableDiceAnimation.checked = config.enableDiceAnimation;
}

function readConfig(): ExtensionConfig {
  return {
    serverUrl: inputs.serverUrl.value.trim(),
    playerName: inputs.playerName.value.trim(),
    characterName: inputs.characterName.value.trim(),
    channel: inputs.channel.value.trim(),
    password: inputs.password.value,
    autoConnect: false,
    showOwnRolls: inputs.showOwnRolls.checked,
    enableDiceAnimation: inputs.enableDiceAnimation.checked
  };
}

function renderState(state: ConnectionState): void {
  lastState = state;
  const displayStatus = getDisplayStatus(state.status);
  statusPill.textContent = statusLabel(displayStatus);
  statusPill.className = `status status-${displayStatus}`;
  playerCount.textContent = String(state.players.length);
  detail.textContent = getDisplayDetail(state);
  connectButton.disabled = state.status === "connecting" || state.status === "connected";
  disconnectButton.disabled = state.status === "disconnected";
}

function renderLastRoll(roll: RollEvent, delivery: string): void {
  if (!shouldShowRoll(roll, delivery)) {
    renderEmptyLastRoll();
    return;
  }

  renderedRoll = { roll, delivery };
  lastRoll.textContent = `${describeRoll(roll)} (${deliveryLabel(delivery)})`;
}

function renderEmptyLastRoll(): void {
  renderedRoll = undefined;
  lastRoll.textContent = t("noRoll");
}

function getDisplayStatus(status: ConnectionState["status"]): DisplayConnectionStatus {
  if (status === "connected" || status === "connecting") {
    return status;
  }

  return "local";
}

function statusLabel(status: DisplayConnectionStatus): string {
  if (status === "connected") {
    return t("connected");
  }
  if (status === "connecting") {
    return t("connecting");
  }
  if (status === "local") {
    return t("localMode");
  }
  if (status === "error") {
    return t("error");
  }
  return t("disconnected");
}

function getDisplayDetail(state: ConnectionState): string {
  if (state.status === "error") {
    return `${t("localReady")} ${t("relayIssue")}: ${translateConnectionDetail(state.detail)}`;
  }

  if (state.status === "disconnected") {
    return t("localReady");
  }

  return translateConnectionDetail(state.detail);
}

function updateRoomMode(): void {
  createRoomButton.classList.toggle("active", roomMode === "host");
  joinRoomButton.classList.toggle("active", roomMode === "join");
  roomModeHint.textContent = roomMode === "host" ? t("hostHint") : t("joinHint");
}

function shouldShowRoll(roll: RollEvent, delivery: string): boolean {
  if (delivery !== "local" && delivery !== "sent") {
    return true;
  }

  return inputs.showOwnRolls.checked || hasSpecialOutcome(roll);
}

function hasSpecialOutcome(roll: RollEvent): boolean {
  const outcome = getRollOutcome(roll);
  return outcome === "bestialFailure" || outcome === "messyCritical" || outcome === "criticalSuccess";
}

function deliveryLabel(delivery: string): string {
  if (delivery === "sent") {
    return t("sent");
  }
  if (delivery === "received") {
    return t("received");
  }
  if (delivery === "history") {
    return t("history");
  }
  return t("local");
}

function describeRoll(roll: RollEvent): string {
  const actor = roll.characterName || roll.playerName;
  const result = describeResult(roll);
  return `${actor} ${t("tested")} ${roll.rollTitle}. ${result}`;
}

function describeResult(roll: RollEvent): string {
  if (typeof roll.successes === "number") {
    const outcome = getRollOutcome(roll);
    const outcomeText =
      outcome && outcome !== "success" && outcome !== "failure" ? ` ${outcomeLabel(outcome)}.` : "";

    if (roll.successes <= 0) {
      return `${t("failed")}${outcomeText}`;
    }

    return `${roll.successes} ${roll.successes === 1 ? t("success") : t("successes")}.${outcomeText}`;
  }

  if (typeof roll.total === "number") {
    return `${t("result")} ${roll.total}.`;
  }

  return t("resultCaptured");
}

function getRollOutcome(roll: RollEvent): RollOutcome | undefined {
  if (typeof roll.successes !== "number") {
    return undefined;
  }

  const hungerOnes = roll.dice.filter((die) => die.kind === "hunger" && die.value === 1).length;
  const tens = roll.dice.filter((die) => die.value === 10).length;
  const hungerTens = roll.dice.filter((die) => die.kind === "hunger" && die.value === 10).length;

  if (roll.successes <= 0) {
    return hungerOnes > 0 ? "bestialFailure" : "failure";
  }

  if (tens >= 2) {
    return hungerTens > 0 ? "messyCritical" : "criticalSuccess";
  }

  return "success";
}

function outcomeLabel(outcome: RollOutcome): string {
  if (outcome === "bestialFailure") {
    return t("outcomeBestialFailure");
  }
  if (outcome === "messyCritical") {
    return t("outcomeMessyCritical");
  }
  if (outcome === "criticalSuccess") {
    return t("outcomeCriticalSuccess");
  }
  return "";
}

async function loadLanguage(): Promise<void> {
  const stored = await chrome.storage.local.get({
    [panelUiStorageKey]: {
      language: "pt-BR"
    }
  });

  const value = stored[panelUiStorageKey] as { language?: unknown } | undefined;
  uiLanguage = value?.language === "en" ? "en" : "pt-BR";
}

function applyLanguage(): void {
  document.documentElement.lang = uiLanguage;

  for (const element of localizedElements) {
    const key = element.dataset.i18n as keyof (typeof messages)["pt-BR"] | undefined;
    if (key && key in messages[uiLanguage]) {
      element.textContent = t(key);
    }
  }

  if (lastState) {
    renderState(lastState);
  }

  if (renderedRoll) {
    renderLastRoll(renderedRoll.roll, renderedRoll.delivery);
  } else {
    renderEmptyLastRoll();
  }

  updateRoomMode();
}

function translateConnectionDetail(value: string): string {
  if (uiLanguage === "pt-BR") {
    return value;
  }

  if (value === "Desconectado") {
    return t("disconnected");
  }
  if (value === "Conectado") {
    return t("connected");
  }
  if (value === "Informe nome do jogador e canal da mesa.") {
    return t("missingConfig");
  }
  if (value === "Conectando ao relay...") {
    return t("connectingRelay");
  }
  if (value === "Entrando na sala...") {
    return t("enteringRoom");
  }
  if (value === "Relay enviou uma mensagem invalida.") {
    return t("invalidRelayMessage");
  }

  const closedMatch = value.match(/^Conexao com (.+) encerrada\. Tentando reconectar\.\.\.$/);
  if (closedMatch) {
    return `Connection to ${closedMatch[1]} closed. Trying to reconnect...`;
  }

  const failedMatch = value.match(/^Nao foi possivel conectar em (.+)\. Verifique o endereco do relay ou use o modo local\.$/);
  if (failedMatch) {
    return `Could not connect to ${failedMatch[1]}. Check the relay address or use local mode.`;
  }

  const invalidRelayMatch = value.match(/^Relay invalido: (.+)$/);
  if (invalidRelayMatch) {
    return `Invalid relay: ${invalidRelayMatch[1]}`;
  }

  return value;
}

function t<TKey extends keyof (typeof messages)["pt-BR"]>(key: TKey): string {
  return messages[uiLanguage][key];
}

function sendRuntimeMessage<TResponse>(message: unknown): Promise<TResponse | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }

      resolve(response);
    });
  });
}

function requireElement<TElement extends Element>(
  selector: string,
  constructor: { new (...args: never[]): TElement }
): TElement {
  const element = document.querySelector(selector);

  if (!(element instanceof constructor)) {
    throw new Error(`Elemento nao encontrado: ${selector}`);
  }

  return element;
}
