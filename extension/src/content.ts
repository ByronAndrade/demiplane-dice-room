import type {
  BackgroundMessage,
  CapturedRoll,
  ConnectionState,
  DiceFace,
  DiceValue,
  RollEvent,
  StoredRoll
} from "./shared/protocol";
import { defaultConfig, type ExtensionConfig } from "./shared/storage";
import * as THREE from "three";

const candidateSelectors = [
  ".dice-history-main-container",
  ".dice-history-expanded-container",
  "[class*='dice-history-main']",
  "[class*='dice-history-expanded']",
  "[class*='dice-history-item']",
  "[class*='history-item']"
];

const seenSignatures = new Map<string, number>();
const signatureTtlMs = 10_000;
const elementSignatures = new WeakMap<Element, string>();
const rolls: Array<{ roll: RollEvent; origin: "local" | "remote"; delivery: string }> = [];
const liveToastMs = 9600;
const maxLiveToasts = 3;
const diceAnimationMs = 8800;
const diceFadeLeadMs = 420;
const diceFadeMs = 360;
const resultLabelRevealMs = 860;
const diceCameraWorldHeight = 560;
const stableFaceScore = 0.972;
const diceRestFaceScore = 0.992;
const diceSettleMotion = 34;
const diceStableHoldMs = 260;
const diceSpentEnergySettleMotion = 76;
const diceVisualSettleMs = 2200;
const diceHardSettleMs = 4200;
const diceToppleEnergyCost = 0.9;
const diceToppleImpulse = 5.8;
const diceRollAxisXBias = 1.55;
const diceRollAxisYBias = 0.08;
const diceGroundRollSpeedFactor = 1.08;
const diceSpinTurnLoss = 0.38;
const diceLongAxisSpinDamping = 0.12;
const diceSupportPivotSpinDamping = 0.02;
const diceFaceCollapseSpeed = 14;
const diceHardFaceCollapseSpeed = 28;
const maxAnimatedDice = 20;
const maxSeenRollIds = 200;
const panelUiStorageKey = "diceRoomPanelUi";
const minPanelOpacity = 0.3;
const defaultDiceAnimationScale = 0.75;
const minDiceAnimationScale = 0.45;
const maxDiceAnimationScale = 1.15;
const defaultRelayUrl = "wss://demiplane-dice-room-relay.foxbyron.workers.dev";
const extensionUiVersion = "0.1.85";
const pageBridgeMessageSource = "demiplane-dice-room-page";
const pageDiceRollResponseWaitMs = 1400;
const pageDiceRollResponseTtlMs = 8_000;
const activeToastByActor = new Map<string, HTMLElement>();
let collapsed = true;
let settingsOpen = false;
let panelOpacity = 0.94;
let diceAnimationScale = defaultDiceAnimationScale;
let panelPosition: { left: number; top: number } | undefined;
let uiLanguage: UiLanguage = "pt-BR";
let scanTimer: number | undefined;
let captureArmedUntil = 0;
let armedBaselineElements = new WeakSet<Element>();
let mutatedElementsSinceArm = new WeakSet<Element>();
let captureScanTimers: number[] = [];
let pendingDicePoolHint: DicePoolHint | undefined;
let pendingPageDiceRollStartedAt = 0;
let pendingPageDiceRollResponses: PageDiceRollResponse[] = [];
let seenRollIds = new Set<string>();
let initialSeenMigrationCutoff = 0;
const publishedElements = new WeakSet<Element>();

declare global {
  interface Window {
    __demiplaneDiceRoomLoaded?: boolean;
  }
}

let connectionState: ConnectionState = {
  status: "disconnected",
  detail: "Desconectado",
  players: []
};
let currentConfig: ExtensionConfig | undefined;
let diagnosticOpen = false;

type UiLanguage = "pt-BR" | "en";
type RollOutcome = "bestialFailure" | "messyCritical" | "criticalSuccess" | "success" | "failure";
type DicePoolHint = {
  regular?: number;
  hunger?: number;
  total?: number;
  sequence?: Array<Extract<DiceValue["kind"], "regular" | "hunger">>;
  capturedAt?: number;
};

type PageDiceRollResponse = {
  roll?: string;
  order?: number;
  values: number[];
  receivedAt: number;
};

type PageBridgeDiceRollMessage = {
  source: typeof pageBridgeMessageSource;
  kind: "dice-roll-api-response";
  payload?: {
    roll?: unknown;
    order?: unknown;
    values?: unknown;
  };
};

const messages = {
  "pt-BR": {
    historyCount: (count: number) => `${count} ${count === 1 ? "rolagem" : "rolagens"}`,
    unreadCount: (count: number) => `${count} ${count === 1 ? "nova" : "novas"}`,
    connected: "Conectado",
    connecting: "Conectando",
    disconnected: "Desconectado",
    error: "Erro",
    localMode: "Local",
    openHistory: "Mostrar historico de rolagens da sala",
    closeHistory: "Ocultar historico de rolagens da sala",
    openSettings: "Abrir configuracoes do painel",
    closeSettings: "Fechar configuracoes do painel",
    openDiagnostic: "Abrir diagnostico de conexao",
    roomMode: "Modo",
    createRoom: "Criar",
    joinRoom: "Entrar",
    hostRole: "Narrador",
    playersTooltipEmpty: "Nenhum jogador conectado",
    leaveHostedRoomConfirm: "Voce criou esta sala. Se sair agora, a sala sera desfeita para todos os jogadores. Sair mesmo assim?",
    tableRoom: "Mesa",
    roomHost: "Narrador",
    roomHostUnknown: "Aguardando narrador",
    roomCreatedByYou: "Voce criou esta mesa.",
    roomJoinedByYou: "Voce entrou nesta mesa.",
    connectedPlayers: (count: number) => `${count} ${count === 1 ? "pessoa conectada" : "pessoas conectadas"}`,
    waiting: "Aguardando rolagens",
    roomSettings: "Sala da mesa",
    playerName: "Nome do jogador",
    characterName: "Personagem",
    hideCharacterName: "Fazer rolagem como Narrador",
    channel: "Canal",
    password: "Senha",
    relayKey: "Chave do relay",
    save: "Salvar",
    connect: "Conectar",
    disconnect: "Desconectar",
    opacity: "Opacidade",
    language: "Idioma",
    showOwnRolls: "Mostrar minhas rolagens",
    showOwnRollsHint: "Normalmente o Demiplane ja mostra sua rolagem. Deixe desligado para ver so as rolagens da sala; interpretacoes especiais ainda aparecem.",
    enableDiceAnimation: "Animacao dos dados",
    enableDiceAnimationHint: "Mostra os dados caindo e quicando na ficha, com som leve.",
    diceAnimationSize: "Tamanho dos dados",
    sent: "enviado",
    received: "recebido",
    history: "historico",
    local: "local",
    tested: "testou",
    failed: "Falhou.",
    resultCaptured: "Resultado capturado.",
    result: "Resultado",
    total: "total",
    success: "sucesso",
    successes: "sucessos",
    diceDetails: "Detalhes dos dados",
    regularDie: "preto",
    hungerDie: "vermelho",
    unknownDie: "desconhecido",
    blankFace: "vazio",
    successFace: "ankh",
    criticalFace: "ankh especial",
    skullFace: "caveira vampirica",
    outcomeBestialFailure: "Falha bestial",
    outcomeMessyCritical: "Critico bestial",
    outcomeCriticalSuccess: "Critico",
    outcomeSuccess: "Sucesso",
    outcomeFailure: "Falha",
    activeConnection: "Conexao ativa",
    localConnection: "Modo local ativo",
    localConnectionHint: "A captura local esta funcionando. Conecte em uma sala quando quiser compartilhar rolagens com outros jogadores.",
    relay: "Relay",
    playersInRoom: "Jogadores na sala",
    missingConfig: "Informe nome do jogador e canal da mesa.",
    connectingRelay: "Conectando ao relay",
    tryingRelay: "Tentando entrar em",
    enteringRoom: "Entrando na sala...",
    invalidRelayMessage: "Relay enviou uma mensagem invalida.",
    relayUnavailable: "Relay indisponivel",
    missingRelayKey: "Informe a chave do relay ou use um relay proprio/local.",
    roomFull: "Sala cheia. O limite e de 20 jogadores.",
    roomClosed: "O narrador saiu e a sala foi desfeita.",
    roomHostExists: "Esta sala ja tem um narrador conectado.",
    runServer: "No terminal do projeto, rode",
    reconnectHint: "Depois aguarde a reconexao ou clique em Conectar no popup.",
    disconnectedDiagnostic: "Abra o popup da extensao e clique em Conectar. Relay configurado:"
  },
  en: {
    historyCount: (count: number) => `${count} ${count === 1 ? "roll" : "rolls"}`,
    unreadCount: (count: number) => `${count} new`,
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
    error: "Error",
    localMode: "Local",
    openHistory: "Show room roll history",
    closeHistory: "Hide room roll history",
    openSettings: "Open panel settings",
    closeSettings: "Close panel settings",
    openDiagnostic: "Open connection diagnostics",
    roomMode: "Mode",
    createRoom: "Create",
    joinRoom: "Join",
    hostRole: "Storyteller",
    playersTooltipEmpty: "No players connected",
    leaveHostedRoomConfirm: "You created this room. Leaving now will close it for every player. Leave anyway?",
    tableRoom: "Room",
    roomHost: "Storyteller",
    roomHostUnknown: "Waiting for Storyteller",
    roomCreatedByYou: "You created this room.",
    roomJoinedByYou: "You joined this room.",
    connectedPlayers: (count: number) => `${count} ${count === 1 ? "person connected" : "people connected"}`,
    waiting: "Waiting for rolls",
    roomSettings: "Table room",
    playerName: "Player name",
    characterName: "Character",
    hideCharacterName: "Roll as Storyteller",
    channel: "Channel",
    password: "Password",
    relayKey: "Relay key",
    save: "Save",
    connect: "Connect",
    disconnect: "Disconnect",
    opacity: "Opacity",
    language: "Language",
    showOwnRolls: "Show my own rolls",
    showOwnRollsHint: "Demiplane already shows your roll by default. Leave this off to see only room rolls; special interpretations still appear.",
    enableDiceAnimation: "Dice animation",
    enableDiceAnimationHint: "Shows dice falling and bouncing on the sheet, with light sound.",
    diceAnimationSize: "Dice size",
    sent: "sent",
    received: "received",
    history: "history",
    local: "local",
    tested: "rolled",
    failed: "Failed.",
    resultCaptured: "Result captured.",
    result: "Result",
    total: "total",
    success: "success",
    successes: "successes",
    diceDetails: "Dice details",
    regularDie: "black",
    hungerDie: "red",
    unknownDie: "unknown",
    blankFace: "blank",
    successFace: "ankh",
    criticalFace: "special ankh",
    skullFace: "vampiric skull",
    outcomeBestialFailure: "Bestial failure",
    outcomeMessyCritical: "Messy critical",
    outcomeCriticalSuccess: "Critical success",
    outcomeSuccess: "Success",
    outcomeFailure: "Failure",
    activeConnection: "Connection active",
    localConnection: "Local mode active",
    localConnectionHint: "Local capture is working. Connect to a room when you want to share rolls with other players.",
    relay: "Relay",
    playersInRoom: "Players in room",
    missingConfig: "Enter a player name and table channel.",
    connectingRelay: "Connecting to relay",
    tryingRelay: "Trying to join",
    enteringRoom: "Entering room...",
    invalidRelayMessage: "Relay sent an invalid message.",
    relayUnavailable: "Relay unavailable",
    missingRelayKey: "Enter the relay key or use your own/local relay.",
    roomFull: "Room is full. The limit is 20 players.",
    roomClosed: "The Storyteller left and the room was closed.",
    roomHostExists: "This room already has a Storyteller connected.",
    runServer: "In the project terminal, run",
    reconnectHint: "Then wait for reconnection or click Connect in the popup.",
    disconnectedDiagnostic: "Open the extension popup and click Connect. Configured relay:"
  }
} as const;

let panel: ReturnType<typeof createPanel> | undefined;
let liveLayer: ReturnType<typeof createLiveLayer> | undefined;
let diceAnimationLayer: ReturnType<typeof createDiceAnimationLayer> | undefined;
let diceAnimationBatchSequence = 0;
let audioContext: AudioContext | undefined;
const firstLoad = !window.__demiplaneDiceRoomLoaded;

if (firstLoad) {
  window.__demiplaneDiceRoomLoaded = true;
  void initializeContentScript();
}

async function initializeContentScript(): Promise<void> {
  window.addEventListener("message", handlePageBridgeMessage);
  await loadPanelUiState();
  liveLayer = createLiveLayer();
  try {
    diceAnimationLayer = createDiceAnimationLayer();
  } catch (error) {
    console.warn("Demiplane Dice Room: animacao 3D indisponivel.", error);
  }
  panel = createPanel();
  if (diceAnimationLayer) {
    document.documentElement.append(diceAnimationLayer.host);
  }
  document.documentElement.append(liveLayer.host);
  document.documentElement.append(panel.host);
  renderPanel();
  startObserver();
  baselineCurrentRolls();
  window.setTimeout(baselineCurrentRolls, 900);
  window.setTimeout(baselineCurrentRolls, 2200);
  document.addEventListener("pointerdown", handlePotentialRollAction, true);
  document.addEventListener("pointerdown", unlockDiceAudio, { capture: true, once: true });
  window.addEventListener("beforeunload", warnBeforeHostedRoomCloses);

  void sendRuntimeMessage<{ ok: true; state?: ConnectionState; recentRolls?: StoredRoll[]; config?: ExtensionConfig }>({
    kind: "content:ready"
  }).then((response) => {
    if (response?.config) {
      currentConfig = response.config;
    }

    if (response?.recentRolls) {
      replaceRolls(response.recentRolls);
    }

    if (response?.state) {
      connectionState = response.state;
      renderPanel();
    }
  });

  chrome.runtime.onMessage.addListener((message: BackgroundMessage) => {
    if (message.kind === "background:connection-state") {
      connectionState = message.state;
      renderPanel();
    }

    if (message.kind === "background:roll-event") {
      addRoll(message.roll, message.origin, message.delivery);
    }

    if (message.kind === "background:roll-history") {
      replaceRolls(message.rolls);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    const configKeys: Array<keyof ExtensionConfig> = [
      "serverUrl",
      "relayKey",
      "playerName",
      "characterName",
      "roomRole",
      "hideCharacterName",
      "channel",
      "password",
      "showOwnRolls",
      "enableDiceAnimation"
    ];

    if (!configKeys.some((key) => changes[key])) {
      return;
    }

    const previousConfig = currentConfig ?? defaultConfig;
    currentConfig = {
      ...previousConfig,
      serverUrl: changes.serverUrl ? String(changes.serverUrl.newValue ?? "") : previousConfig.serverUrl,
      relayKey: changes.relayKey ? String(changes.relayKey.newValue ?? "") : previousConfig.relayKey,
      playerName: changes.playerName ? String(changes.playerName.newValue ?? "") : previousConfig.playerName,
      characterName: changes.characterName ? String(changes.characterName.newValue ?? "") : previousConfig.characterName,
      roomRole: changes.roomRole ? (changes.roomRole.newValue === "host" ? "host" : "player") : previousConfig.roomRole,
      hideCharacterName: changes.hideCharacterName ? changes.hideCharacterName.newValue === true : previousConfig.hideCharacterName,
      channel: changes.channel ? String(changes.channel.newValue ?? "") : previousConfig.channel,
      password: changes.password ? String(changes.password.newValue ?? "") : previousConfig.password,
      showOwnRolls: changes.showOwnRolls ? changes.showOwnRolls.newValue === true : previousConfig.showOwnRolls,
      enableDiceAnimation: changes.enableDiceAnimation
        ? changes.enableDiceAnimation.newValue !== false
        : previousConfig.enableDiceAnimation
    };
    renderPanel();
  });
}

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    if (isCaptureArmed() && mutations.some((mutation) => isRelevantMutation(mutation))) {
      markMutatedElementsSinceArm(mutations);
      scheduleScan();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function scheduleScan(): void {
  if (!isCaptureArmed()) {
    return;
  }

  if (scanTimer) {
    clearTimeout(scanTimer);
  }

  scanTimer = setTimeout(() => {
    scanTimer = undefined;
    scanPage();
  }, 180);
}

function handlePageBridgeMessage(event: MessageEvent): void {
  if (event.source !== window || !isPageBridgeDiceRollMessage(event.data)) {
    return;
  }

  const values = normalizePageDiceRollValues(event.data.payload?.values);
  if (values.length === 0) {
    return;
  }

  pendingPageDiceRollResponses.push({
    roll: typeof event.data.payload?.roll === "string" ? event.data.payload.roll : undefined,
    order: typeof event.data.payload?.order === "number" ? event.data.payload.order : undefined,
    values,
    receivedAt: Date.now()
  });
  prunePageDiceRollResponses();

  if (isCaptureArmed()) {
    scheduleScan();
  }
}

function isPageBridgeDiceRollMessage(value: unknown): value is PageBridgeDiceRollMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<PageBridgeDiceRollMessage>;
  return message.source === pageBridgeMessageSource && message.kind === "dice-roll-api-response";
}

function normalizePageDiceRollValues(values: unknown): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => (typeof value === "number" ? value : Number.parseInt(String(value), 10)))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 100)
    .slice(0, 80);
}

function prunePageDiceRollResponses(): void {
  const cutoff = Date.now() - pageDiceRollResponseTtlMs;
  pendingPageDiceRollResponses = pendingPageDiceRollResponses.filter((response) => response.receivedAt >= cutoff);
}

function handlePotentialRollAction(event: PointerEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }

  if (isOwnPanelElement(event.target)) {
    return;
  }

  const rollAction = findRollActionElement(event.target);
  if (!rollAction) {
    return;
  }

  if (isRerollActionElement(rollAction)) {
    return;
  }

  pendingDicePoolHint = readCurrentDicePoolHint(rollAction);
  pendingPageDiceRollStartedAt = Date.now() - 50;
  pendingPageDiceRollResponses = [];
  armCapture(6000);
}

function isRerollActionElement(element: Element): boolean {
  const label = normalizeText(
    [element.textContent ?? "", element.getAttribute("aria-label") ?? "", element.getAttribute("title") ?? ""].join(" ")
  );
  return /\b(re-roll|reroll)\b/i.test(label);
}

function findRollActionElement(target: Element): Element | undefined {
  let current: Element | null = target;
  let depth = 0;

  while (current && depth < 6 && current !== document.body) {
    const label = normalizeText(
      [current.textContent ?? "", current.getAttribute("aria-label") ?? "", current.getAttribute("title") ?? ""].join(" ")
    );
    const context = getElementContext(current);
    const isButtonLike =
      current instanceof HTMLButtonElement ||
      current.getAttribute("role") === "button" ||
      current.tagName.toLowerCase() === "button";
    const isClickable =
      isButtonLike ||
      current.getAttribute("tabindex") !== null ||
      /button|click|roll|reroll|re-roll/i.test(context) ||
      (current instanceof HTMLElement && window.getComputedStyle(current).cursor === "pointer");
    const isSmallRollLabel = label.length <= 40;

    if ((isClickable || isSmallRollLabel) && /\b(re-roll|reroll|roll)\b/i.test(label)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return undefined;
}

function findDicePoolInteractionElement(target: Element): Element | undefined {
  let current: Element | null = target;
  let depth = 0;

  while (current && depth < 8 && current !== document.body) {
    const label = normalizeText(
      [current.textContent ?? "", current.getAttribute("aria-label") ?? "", current.getAttribute("title") ?? ""].join(" ")
    );
    const context = getElementContext(current);

    if (/(dice pool|add dice to roll|regular|hunger|fome)/i.test(`${label} ${context}`)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return undefined;
}

function getActiveDicePoolHint(): DicePoolHint | undefined {
  if (isCaptureArmed() && pendingDicePoolHint && Date.now() - (pendingDicePoolHint.capturedAt ?? 0) < 8_000) {
    return pendingDicePoolHint;
  }

  return undefined;
}

function readCurrentDicePoolHint(actionElement?: Element): DicePoolHint | undefined {
  const root = findDicePoolRoot(actionElement);
  const visualHint = root ? readDicePoolVisualHint(root) : undefined;
  if (visualHint && visualHint.total && visualHint.total > 0) {
    return visualHint;
  }

  return undefined;
}

function findDicePoolRoot(actionElement?: Element): Element | undefined {
  let current: Element | null = actionElement ?? null;
  let depth = 0;

  while (current && current !== document.body && depth < 10) {
    const text = normalizeText(readElementText(current));
    if (/\bdice pool\b/i.test(text) && /\broll\b/i.test(text)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  const candidates = Array.from(document.querySelectorAll("aside, section, div, form"))
    .filter((element) => {
      if (!(element instanceof Element) || !isVisibleElement(element)) {
        return false;
      }

      const text = normalizeText(readElementText(element));
      return /\bdice pool\b/i.test(text) && /\broll\b/i.test(text);
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { element, area: rect.width * rect.height };
    })
    .filter(({ area }) => area > 0)
    .sort((first, second) => first.area - second.area);

  return candidates[0]?.element;
}

function readDicePoolVisualHint(root: Element): DicePoolHint | undefined {
  const rootRect = root.getBoundingClientRect();
  const titleRects = collectVisibleTextRects(root, /\bdice pool\b/i);
  const controlRects = collectVisibleTextRects(root, /\b(add dice to roll|regular|hunger|fome|roll)\b/i);
  const top = titleRects.length > 0 ? Math.max(...titleRects.map((rect) => rect.bottom)) - 2 : rootRect.top;
  const lowerControls = controlRects.filter((rect) => rect.top > top + 8);
  const bottom =
    lowerControls.length > 0 ? Math.min(...lowerControls.map((rect) => rect.top)) - 2 : rootRect.bottom;
  const markers = collectDicePoolMarkerElements(root, top, bottom, rootRect);
  let regular = 0;
  let hunger = 0;
  const sequence: Array<Extract<DiceValue["kind"], "regular" | "hunger">> = [];
  const seenRects: DOMRect[] = [];

  const orderedMarkers = markers
    .map((marker) => ({ marker, rect: marker.getBoundingClientRect() }))
    .sort((first, second) => {
      const vertical = first.rect.top - second.rect.top;
      return Math.abs(vertical) > 8 ? vertical : first.rect.left - second.rect.left;
    });

  for (const { marker, rect } of orderedMarkers) {
    if (seenRects.some((seen) => rectsMostlyOverlap(seen, rect))) {
      continue;
    }

    const kind = inferDicePoolMarkerKind(root, marker);
    if (kind !== "regular" && kind !== "hunger") {
      continue;
    }

    seenRects.push(rect);
    sequence.push(kind);
    if (kind === "hunger") {
      hunger += 1;
    } else {
      regular += 1;
    }
  }

  const total = regular + hunger;
  return total > 0 ? { regular, hunger, total, sequence, capturedAt: Date.now() } : undefined;
}

function collectDicePoolMarkerElements(root: Element, top: number, bottom: number, rootRect: DOMRect): Element[] {
  return Array.from(root.querySelectorAll("*")).filter((marker) => {
    const rect = marker.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hasPoolSize = rect.width >= 7 && rect.height >= 7 && rect.width <= 38 && rect.height <= 38;
    const labelText = normalizeText(marker.textContent ?? "");
    return (
      marker instanceof Element &&
      isVisibleElement(marker) &&
      hasPoolSize &&
      labelText.length <= 2 &&
      centerX >= rootRect.left - 2 &&
      centerX <= rootRect.right + 2 &&
      centerY >= top &&
      centerY <= bottom
    );
  });
}

function inferDicePoolMarkerKind(root: Element, marker: Element): DiceValue["kind"] | undefined {
  const markerParts = collectDetailMarkerParts(root, marker);
  if (hasDominantRedFillColor(marker, markerParts) || hasStrongRedMarkerColor(marker, markerParts)) {
    return "hunger";
  }

  if (hasStrongLightMarkerColor(marker, markerParts)) {
    return "regular";
  }

  return undefined;
}

function rectsMostlyOverlap(first: DOMRect, second: DOMRect): boolean {
  const left = Math.max(first.left, second.left);
  const right = Math.min(first.right, second.right);
  const top = Math.max(first.top, second.top);
  const bottom = Math.min(first.bottom, second.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const overlap = width * height;
  const smallerArea = Math.max(1, Math.min(first.width * first.height, second.width * second.height));
  return overlap / smallerArea > 0.72;
}

function armCapture(durationMs = 6000): void {
  baselineCurrentRolls();
  armedBaselineElements = new WeakSet(collectRollCandidates().map(({ element }) => element));
  mutatedElementsSinceArm = new WeakSet<Element>();
  captureArmedUntil = Date.now() + durationMs;

  for (const timer of captureScanTimers) {
    clearTimeout(timer);
  }

  captureScanTimers = [160, 420, 900, 1600, 2800, 4300].map((delay) =>
    window.setTimeout(() => {
      scanPage();
    }, delay)
  );
}

function disarmCapture(): void {
  captureArmedUntil = 0;
  armedBaselineElements = new WeakSet<Element>();
  mutatedElementsSinceArm = new WeakSet<Element>();
  pendingDicePoolHint = undefined;
  pendingPageDiceRollStartedAt = 0;
  pendingPageDiceRollResponses = [];

  for (const timer of captureScanTimers) {
    clearTimeout(timer);
  }

  captureScanTimers = [];
}

function isCaptureArmed(): boolean {
  return Date.now() <= captureArmedUntil;
}

function isRelevantMutation(mutation: MutationRecord): boolean {
  if (mutation.type === "characterData") {
    return Boolean(mutation.target.parentElement);
  }

  if (mutation.type !== "childList") {
    return false;
  }

  return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
}

function markMutatedElementsSinceArm(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    if (mutation.target instanceof Element) {
      markElementAndAncestors(mutatedElementsSinceArm, mutation.target);
    }

    if (mutation.target.parentElement) {
      markElementAndAncestors(mutatedElementsSinceArm, mutation.target.parentElement);
    }

    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        markElementAndAncestors(mutatedElementsSinceArm, node);
      }
    }
  }
}

function markElementAndAncestors(target: WeakSet<Element>, element: Element): void {
  let current: Element | null = element;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    target.add(current);
    current = current.parentElement;
    depth += 1;
  }
}

function baselineCurrentRolls(): void {
  for (const { element, captured } of collectRollCandidates()) {
    elementSignatures.set(element, captured.signature);
  }
}

function scanPage(): void {
  if (!isCaptureArmed()) {
    return;
  }

  const candidates = collectRollCandidates();
  let bestCandidate: { element: Element; captured: CapturedRoll; score: number } | undefined;

  for (const { element, captured } of candidates) {
    const previousSignature = elementSignatures.get(element);
    const isBaselineElement = armedBaselineElements.has(element);
    const mutatedAfterArm = mutatedElementsSinceArm.has(element);

    if (publishedElements.has(element) && previousSignature === captured.signature && !mutatedAfterArm) {
      elementSignatures.set(element, captured.signature);
      continue;
    }

    if (isBaselineElement && previousSignature === captured.signature && !mutatedAfterArm) {
      continue;
    }

    const score = scoreRollCandidate(captured);
    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { element, captured, score };
    }
  }

  if (bestCandidate) {
    elementSignatures.set(bestCandidate.element, bestCandidate.captured.signature);
    publishCapturedRoll(bestCandidate.captured, bestCandidate.element);
    disarmCapture();
  }
}

function scoreRollCandidate(captured: CapturedRoll): number {
  const poolHint = getActiveDicePoolHint();
  let score = captured.dice.length * 20 + Math.min(captured.rawText.length, 800) / 20;

  if (hasRollDetailsText(captured.rawText)) {
    score += 1000;
  }

  if (poolHint?.total && captured.dice.length === poolHint.total) {
    score += 280;
  }

  if (typeof poolHint?.hunger === "number" && captured.dice.filter((die) => die.kind === "hunger").length === poolHint.hunger) {
    score += 220;
  }

  if (typeof captured.successes === "number" && calculateDiceSuccesses(captured.dice) === captured.successes) {
    score += 180;
  }

  return score;
}

function publishCapturedRoll(captured: CapturedRoll, sourceElement?: Element): void {
  if (!sourceElement && wasRecentlySeen(captured.signature)) {
    return;
  }

  if (sourceElement) {
    publishedElements.add(sourceElement);
  }

  seenSignatures.set(captured.signature, Date.now());
  pruneSeenSignatures();
  void sendRuntimeMessage({ kind: "content:captured-roll", roll: captured });
}

function collectRollCandidates(): Array<{ element: Element; captured: CapturedRoll }> {
  const elements = new Set<Element>();

  for (const selector of candidateSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!isOwnPanelElement(element)) {
        elements.add(element);
      }
    }
  }

  const validElements = [...elements].filter((element) => extractRoll(element));
  const smallestElements = validElements.filter(
    (element) =>
      !validElements.some((other) => other !== element && element.contains(other) && normalizeText(readElementText(other)).length > 0)
  );

  const candidates: Array<{ element: Element; captured: CapturedRoll }> = [];

  for (const element of smallestElements) {
    const captured = extractRoll(element);
    if (!captured) {
      continue;
    }

    candidates.push({ element, captured });
  }

  return candidates;
}

function extractRoll(element: Element): CapturedRoll | undefined {
  const rawText = normalizeText(readElementText(element)).slice(0, 4000);

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!looksLikeCompleteRoll(element, rawText, lines)) {
    return undefined;
  }

  const successes = parseNumber(rawText, /(?:successes|success|sucessos?|sucesso)\D{0,12}(\d{1,3})/i);
  const total = parseNumber(rawText, /(?:total|resultado)\D{0,12}(-?\d{1,4})/i);
  const rollTitle = parseRollTitle(rawText, lines, element);

  if (!rollTitle || successes === null) {
    return undefined;
  }

  const enriched = findRicherRollElement(element, rollTitle, successes);
  const sourceElement = enriched?.element ?? element;
  const sourceText = enriched?.rawText ?? rawText;
  const sourceLines = enriched?.lines ?? lines;
  const poolHint = getActiveDicePoolHint();
  if (poolHint?.total && !hasRollDetailsText(sourceText)) {
    return undefined;
  }

  if (shouldWaitForPageDiceRollResponses(poolHint)) {
    return undefined;
  }

  const dice = parseDice(sourceElement, sourceLines, successes, poolHint);
  const signature = hashText([rollTitle, successes, diceKey(dice), normalizeRollTextForSignature(sourceText, sourceLines)].join("|"));

  return {
    rollTitle,
    characterName: getCurrentSheetCharacterName(),
    successes,
    total,
    dice,
    rawText: sourceText,
    createdAt: new Date().toISOString(),
    signature
  };
}

function hasRollDetailsText(text: string): boolean {
  return /\b(details|detalhes)\b/i.test(text);
}

function getCurrentSheetCharacterName(): string | undefined {
  const exactName = getExactSheetCharacterName();
  if (exactName) {
    return exactName;
  }

  const candidates: string[] = [];

  const selector = [
    "h1",
    "h2",
    "[class*='character-name' i]",
    "[class*='characterName']",
    "[class*='character-header' i] [class*='name' i]",
    "[class*='sheet-header' i] [class*='name' i]"
  ].join(",");

  for (const element of document.querySelectorAll(selector)) {
    if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    if (rect.top > Math.max(260, window.innerHeight * 0.35)) {
      continue;
    }

    const candidate = normalizeCharacterNameCandidate(element.textContent || element.innerText || "");
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const titleCandidate = normalizeCharacterNameCandidate(document.title.replace(/\s+[-|].*$/u, ""));
  if (titleCandidate) {
    candidates.push(titleCandidate);
  }

  return candidates.find(Boolean);
}

function getExactSheetCharacterName(): string | undefined {
  const selectors = [".text-block.character-name .text-block__text", ".character-name .text-block__text"];

  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.top > Math.max(260, window.innerHeight * 0.35)) {
        continue;
      }

      const candidate = normalizeCharacterNameCandidate(element.textContent || "");
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

function normalizeCharacterNameCandidate(value: string): string | undefined {
  const candidate = normalizeText(value)
    .replace(/\s+/g, " ")
    .replace(/[≡☰]+/g, "")
    .trim();

  if (
    candidate.length < 2 ||
    candidate.length > 60 ||
    /^(ATTRIBUTES|BANE|CHARACTERS|CHRONICLES|COMPULSION|DEMIPLANE|GAME RULES|GROUPS|LIBRARY|NEXUS|ROLL|VAMPIRE)$/i.test(candidate) ||
    /(?:demiplane|nexus|vampire:\s*the masquerade|character sheet|dice room)/i.test(candidate)
  ) {
    return undefined;
  }

  return candidate;
}

function findRicherRollElement(
  element: Element,
  rollTitle: string,
  successes: number
): { element: Element; rawText: string; lines: string[] } | undefined {
  let best:
    | {
        element: Element;
        rawText: string;
        lines: string[];
        score: number;
      }
    | undefined;
  let current = element.parentElement;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    if (isOwnPanelElement(current)) {
      break;
    }

    const rawText = normalizeText(readElementText(current)).slice(0, 4000);
    const lines = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (isSameSingleRollBlock(current, rawText, lines, rollTitle, successes)) {
      const dice = parseDice(current, lines, successes);
      const score = dice.length * 10 + lines.length + Math.min(rawText.length, 600) / 600;
      if (!best || score > best.score) {
        best = { element: current, rawText, lines, score };
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  return best;
}

function isSameSingleRollBlock(
  element: Element,
  rawText: string,
  lines: string[],
  rollTitle: string,
  successes: number
): boolean {
  if (rawText.length < 6 || rawText.length > 4000 || isControlBlock(rawText)) {
    return false;
  }

  const candidateTitle = parseRollTitle(rawText, lines, element);
  if (candidateTitle !== rollTitle) {
    return false;
  }

  const uniqueTitles = getUniqueRollTitles(rawText);
  if (uniqueTitles.length > 1) {
    return false;
  }

  const successValues = getSuccessValues(rawText);
  if (successValues.length !== 1) {
    return false;
  }

  const candidateSuccesses = parseNumber(rawText, /(?:successes|success|sucessos?|sucesso)\D{0,12}(\d{1,3})/i);
  return candidateSuccesses === successes;
}

function looksLikeCompleteRoll(element: Element, text: string, lines: string[]): boolean {
  if (text.length < 6 || text.length > 4000) {
    return false;
  }

  if (isOwnPanelElement(element) || isControlBlock(text)) {
    return false;
  }

  const className = String(element.getAttribute("class") ?? "").toLowerCase();
  const hasHistoryClass = /dice-history|history-item/.test(className);
  const rollTitle = parseRollTitle(text, lines, element);
  const hasTitle = rollTitle !== undefined;
  const successValues = getSuccessValues(text);
  const hasSuccessValue = successValues.length === 1;
  const uniqueTitles = getUniqueRollTitles(text);
  const hasSingleTitle = !rollTitle || !isAttributeSkillTitle(rollTitle) ? uniqueTitles.length <= 1 : uniqueTitles.length === 1;

  return hasHistoryClass && hasTitle && hasSuccessValue && hasSingleTitle;
}

function isOwnPanelElement(element: Element): boolean {
  return (
    element.id === "demiplane-dice-room-panel" ||
    element.id === "demiplane-dice-room-live" ||
    element.id === "demiplane-dice-room-animation" ||
    Boolean(element.closest("#demiplane-dice-room-panel, #demiplane-dice-room-live, #demiplane-dice-room-animation"))
  );
}

function isControlBlock(text: string): boolean {
  return /(add dice to roll|dice pool|clear|regular\s+hunger|select dice to reroll|select dice to re-roll)/i.test(text);
}

function normalizeRollTextForSignature(text: string, lines: string[]): string {
  const title = parseRollTitle(text, lines) ?? "";
  const successes = text.match(/(?:successes|success|sucessos?|sucesso)\D{0,12}\d{1,3}\b/i)?.[0] ?? "";
  const details = text.match(/details[\s\S]{0,140}/i)?.[0] ?? "";
  return normalizeText(`${title}\n${successes}\n${details}`);
}

function readElementText(element: Element): string {
  if (element instanceof HTMLElement && element.innerText) {
    return element.innerText;
  }

  return element.textContent ?? "";
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function findTitle(lines: string[]): string | undefined {
  const ignored = /(successes|success|sucessos?|sucesso|details|detalhes|dice|dados?|total|resultado)/i;
  const title = lines.find((line) => line.length >= 3 && line.length <= 120 && !ignored.test(line));
  return title ?? lines.find((line) => line.length <= 120);
}

function parseRollTitle(text: string, lines: string[], element?: Element): string | undefined {
  const demiplaneTitle = element ? readDemiplaneRollTitle(element) : undefined;
  if (demiplaneTitle) {
    return demiplaneTitle;
  }

  const lineTitle = lines.find((line) => isAttributeSkillTitle(line));
  if (lineTitle) {
    return normalizeRollTitle(lineTitle);
  }

  const customLine = lines.find((line) => isCustomRollTitle(line));
  if (customLine) {
    return normalizeRollTitle(customLine);
  }

  const simpleLine = lines.find((line) => isSingleTraitRollTitle(line));
  if (simpleLine) {
    return normalizeRollTitle(simpleLine);
  }

  const rolledMatch = text.match(
    /\brolled[ \t]+([A-Z][A-Z '-]{1,50}(?:[ \t]*\+[ \t]*[A-Z][A-Z '-]{1,50}){0,5})([ \t]*\([ \t]*re-?roll[ \t]*\))?(?=$|\s|[.:])/i
  );
  if (rolledMatch) {
    const title = `${rolledMatch[1].trim()}${rolledMatch[2] ?? ""}`;
    if (isAttributeSkillTitle(title) || isSingleTraitRollTitle(title) || isCustomRollTitle(title)) {
      return normalizeRollTitle(title);
    }
  }

  const match = text.match(
    /(?:^|\n)[ \t]*([A-Z][A-Z '-]{1,50}(?:[ \t]*\+[ \t]*[A-Z][A-Z '-]{1,50}){1,5})([ \t]*\([ \t]*re-?roll[ \t]*\))?(?=$|\s|[.:])/i
  );
  if (!match) {
    return undefined;
  }

  return normalizeRollTitle(`${match[1].trim()}${match[2] ?? ""}`);
}

function readDemiplaneRollTitle(element: Element): string | undefined {
  const selectors = ".dice-history-name, .history-item-calculated__value.dice-history-name";
  const candidates: Element[] = [];

  if (element.matches(selectors)) {
    candidates.push(element);
  }

  candidates.push(...element.querySelectorAll(selectors));

  for (const candidate of candidates) {
    const title = normalizeText(candidate.textContent ?? "");
    if (isUsefulRollTitle(title)) {
      return normalizeRollTitle(title);
    }
  }

  return undefined;
}

function isAttributeSkillTitle(value: string): boolean {
  const title = stripRerollTitleSuffix(value);
  const parts = title.split("+").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 && parts.every(isTraitTitlePart);
}

function isCustomRollTitle(value: string): boolean {
  return /^custom(?:[ \t]*\([ \t]*re-?roll[ \t]*\))?$/i.test(value.trim());
}

function isSingleTraitRollTitle(value: string): boolean {
  const title = stripRerollTitleSuffix(value);
  if (!isTraitTitlePart(title) || isAttributeSkillTitle(title) || isCustomRollTitle(title)) {
    return false;
  }

  return !/^(ADD DICE TO ROLL|ATTRIBUTES|CLEAR|COTERIE|CUSTOM|DETAILS|DETAILED|DICE POOL|DISCIPLINES|EXPAND|FLAWS|GAME RULES|GROUPS|HEALTH|HUMANITY|HUNGER|INVENTORY|LIBRARY|LOCAL|MENTAL|MERITS|NOTES|PHYSICAL|RE-ROLL|REROLL|ROLL|SELECT DICE TO REROLL|SKILLS|SOCIAL|SUCCESSES?|SUCCESS|WILLPOWER)$/i.test(
    title
  );
}

function isTraitTitlePart(value: string): boolean {
  return /^[A-Z][A-Z '-]{1,50}$/i.test(value.trim());
}

function isUsefulRollTitle(value: string): boolean {
  const title = value.trim();
  return isAttributeSkillTitle(title) || isSingleTraitRollTitle(title) || isCustomRollTitle(title);
}

function getUniqueRollTitles(text: string): string[] {
  const titles: string[] = [];
  for (const line of text.split("\n")) {
    const lineMatch = line.match(
      /^[ \t]*([A-Z][A-Z '-]{1,50}(?:[ \t]*\+[ \t]*[A-Z][A-Z '-]{1,50}){1,5})([ \t]*\([ \t]*re-?roll[ \t]*\))?(?=$|\s|[.:])/i
    );
    if (lineMatch) {
      titles.push(normalizeRollTitle(`${lineMatch[1].trim()}${lineMatch[2] ?? ""}`));
    }
  }

  for (const match of text.matchAll(
    /\brolled[ \t]+([A-Z][A-Z '-]{1,50}(?:[ \t]*\+[ \t]*[A-Z][A-Z '-]{1,50}){1,5})([ \t]*\([ \t]*re-?roll[ \t]*\))?(?=$|\s|[.:])/gi
  )) {
    titles.push(normalizeRollTitle(`${match[1].trim()}${match[2] ?? ""}`));
  }

  return [...new Set(titles)];
}

function normalizeRollTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  return hasRerollTitleSuffix(title) ? `${stripRerollTitleSuffix(title)} (REROLL)` : title;
}

function stripRerollTitleSuffix(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[ \t]*\([ \t]*re-?roll[ \t]*\)$/i, "").trim();
}

function hasRerollTitleSuffix(value: string): boolean {
  return /[ \t]*\([ \t]*re-?roll[ \t]*\)$/i.test(value.trim());
}

function getSuccessValues(text: string): string[] {
  const matches = text.match(/(?:successes|success|sucessos?|sucesso)\D{0,12}\d{1,3}\b/gi) ?? [];
  return matches;
}

function parseNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function shouldWaitForPageDiceRollResponses(poolHint?: DicePoolHint): boolean {
  if (!isCaptureArmed() || pendingPageDiceRollStartedAt <= 0 || !poolHint?.sequence?.length) {
    return false;
  }

  if (Date.now() - pendingPageDiceRollStartedAt > pageDiceRollResponseWaitMs) {
    return false;
  }

  return getActivePageDiceRollValues().length < poolHint.sequence.length;
}

function buildDiceFromPageDiceRollResponses(successes?: number, poolHint?: DicePoolHint): DiceValue[] {
  if (!isCaptureArmed() || pendingPageDiceRollStartedAt <= 0 || !poolHint?.sequence?.length) {
    return [];
  }

  const values = getActivePageDiceRollValues();
  if (values.length === 0 || values.length !== poolHint.sequence.length) {
    return [];
  }

  if (typeof poolHint.total === "number" && values.length !== poolHint.total) {
    return [];
  }

  const dice = values.map((value, index): DiceValue => {
    const kind = poolHint.sequence?.[index] ?? "regular";
    return {
      kind,
      value,
      sides: value <= 10 ? 10 : undefined,
      face: getDieFaceFromValue(kind, value)
    };
  });

  if (typeof successes === "number" && calculateDiceSuccesses(dice) !== successes) {
    return [];
  }

  return dice;
}

function getActivePageDiceRollValues(): number[] {
  prunePageDiceRollResponses();

  if (pendingPageDiceRollStartedAt <= 0) {
    return [];
  }

  return pendingPageDiceRollResponses
    .filter((response) => response.receivedAt >= pendingPageDiceRollStartedAt)
    .sort((first, second) => {
      const firstOrder = first.order ?? Number.MAX_SAFE_INTEGER;
      const secondOrder = second.order ?? Number.MAX_SAFE_INTEGER;
      return firstOrder !== secondOrder ? firstOrder - secondOrder : first.receivedAt - second.receivedAt;
    })
    .flatMap((response) => response.values)
    .slice(0, 80);
}

function parseDice(
  element: Element,
  lines: string[],
  successes?: number,
  poolHint?: DicePoolHint
): DiceValue[] {
  const detailDice = parseDetailDiceFromDom(element);
  if (detailDice.length > 0) {
    return detailDice;
  }

  const pageDice = buildDiceFromPageDiceRollResponses(successes, poolHint);
  if (pageDice.length > 0) {
    return pageDice;
  }

  const dice = parseDiceFromText(lines);
  return reconcileDiceWithPoolHint(dice, poolHint);
}

function reconcileDiceWithPoolHint(dice: DiceValue[], poolHint?: DicePoolHint): DiceValue[] {
  if (!poolHint || typeof poolHint.hunger !== "number" || typeof poolHint.total !== "number" || dice.length === 0) {
    return dice;
  }

  const targetHungerDice = clampNumber(poolHint.hunger, 0, poolHint.total);
  if (dice.length !== poolHint.total) {
    dice = resizeDiceToPoolHint(dice, poolHint);
  }

  const currentHungerDice = dice.filter((die) => die.kind === "hunger").length;
  if (currentHungerDice === targetHungerDice) {
    return dice;
  }

  const reconciled = dice.map((die) => ({ ...die }));
  if (currentHungerDice < targetHungerDice) {
    let remaining = targetHungerDice - currentHungerDice;
    const candidates = getDiceKindConversionCandidates(reconciled, "hunger");
    for (const index of candidates) {
      reconciled[index] = convertDiceKind(reconciled[index], "hunger");
      remaining -= 1;
      if (remaining <= 0) {
        break;
      }
    }
  } else {
    let remaining = currentHungerDice - targetHungerDice;
    const candidates = getDiceKindConversionCandidates(reconciled, "regular");
    for (const index of candidates) {
      reconciled[index] = convertDiceKind(reconciled[index], "regular");
      remaining -= 1;
      if (remaining <= 0) {
        break;
      }
    }
  }

  return reconciled;
}

function resizeDiceToPoolHint(dice: DiceValue[], poolHint: DicePoolHint): DiceValue[] {
  const targetTotal = clampNumber(poolHint.total ?? dice.length, 0, 80);
  if (dice.length === targetTotal) {
    return dice;
  }

  if (dice.length > targetTotal) {
    return [...dice]
      .sort((first, second) => diceRemovalRank(resolveDiceFace(first)) - diceRemovalRank(resolveDiceFace(second)))
      .slice(0, targetTotal);
  }

  const resized = [...dice];
  while (resized.length < targetTotal) {
    const hungerCount = resized.filter((die) => die.kind === "hunger").length;
    const regularCount = resized.length - hungerCount;
    const needsHunger = typeof poolHint.hunger === "number" && hungerCount < poolHint.hunger;
    const needsRegular = typeof poolHint.regular === "number" && regularCount < poolHint.regular;
    const kind: DiceValue["kind"] = needsHunger && !needsRegular ? "hunger" : "regular";
    resized.push(createDiceValue(kind, "blank"));
  }

  return resized;
}

function diceRemovalRank(face: DiceFace): number {
  if (face === "blank") {
    return 3;
  }

  if (face === "skull") {
    return 2;
  }

  if (face === "success") {
    return 1;
  }

  return 0;
}

function getDiceKindConversionCandidates(dice: DiceValue[], targetKind: DiceValue["kind"]): number[] {
  return dice
    .map((die, index) => ({ die, index, face: resolveDiceFace(die) }))
    .filter(({ die }) => (targetKind === "hunger" ? die.kind !== "hunger" : die.kind === "hunger"))
    .sort((first, second) => {
      const faceRank =
        targetKind === "hunger"
          ? hungerPromotionFaceRank(first.face) - hungerPromotionFaceRank(second.face)
          : regularPromotionFaceRank(first.face) - regularPromotionFaceRank(second.face);
      return faceRank !== 0 ? faceRank : second.index - first.index;
    })
    .map(({ index }) => index);
}

function hungerPromotionFaceRank(face: DiceFace): number {
  if (face === "critical") {
    return 0;
  }

  if (face === "success") {
    return 1;
  }

  if (face === "blank") {
    return 2;
  }

  return 3;
}

function regularPromotionFaceRank(face: DiceFace): number {
  if (face === "blank") {
    return 0;
  }

  if (face === "success") {
    return 1;
  }

  if (face === "critical") {
    return 2;
  }

  return 3;
}

function convertDiceKind(die: DiceValue, targetKind: DiceValue["kind"]): DiceValue {
  let face = resolveDiceFace(die);
  if (targetKind === "regular" && face === "skull") {
    face = "blank";
  }

  return createDiceValue(targetKind, face);
}

function resolveDiceFace(die: DiceValue): DiceFace {
  if (die.face) {
    return die.face;
  }

  return getDieFaceFromValue(die.kind === "hunger" ? "hunger" : "regular", die.value) ?? "blank";
}

function calculateDiceSuccesses(dice: DiceValue[]): number {
  const successCount = dice.filter((die) => die.face === "success").length;
  const criticalCount = dice.filter((die) => die.face === "critical").length;
  return successCount + criticalCount + Math.floor(criticalCount / 2) * 2;
}

function parseDetailDiceFromDom(element: Element): DiceValue[] {
  const dice: DiceValue[] = [];

  for (const dieElement of collectDemiplaneDetailDieElements(element)) {
    const kind = inferDemiplaneDetailDieKind(dieElement);
    const face = inferDemiplaneDetailDieFace(dieElement);
    if (!kind || !face) {
      continue;
    }

    const count = readDemiplaneDetailDieCount(dieElement);
    if (count <= 0) {
      continue;
    }

    for (let index = 0; index < count; index += 1) {
      dice.push(createDiceValue(kind, face));
    }

    if (dice.length >= 80) {
      return dice.slice(0, 80);
    }
  }

  return dice;
}

function collectDemiplaneDetailDieElements(root: Element): Element[] {
  const selector = [
    ".history-item-result__die",
    ".dice-history-result-dice",
    "[class*='history-item-result__die--standard-']",
    "[class*='history-item-result__die--hunger-']"
  ].join(",");
  const rawElements = [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll(selector))
  ];
  const dieElements: Element[] = [];

  for (const element of rawElements) {
    const dieElement = element.closest(".history-item-result__die, .dice-history-result-dice") ?? element;
    if (dieElements.includes(dieElement)) {
      continue;
    }

    if (inferDemiplaneDetailDieKind(dieElement) && inferDemiplaneDetailDieFace(dieElement)) {
      dieElements.push(dieElement);
    }
  }

  return dieElements;
}

function readDemiplaneDetailDieCount(element: Element): number {
  const label = element.querySelector("[value='count'], .history-item-result__label");
  const text = label?.textContent ?? element.textContent ?? "";
  const match = text.match(/\b\d{1,2}\b/);
  if (!match) {
    return 0;
  }

  const count = Number.parseInt(match[0], 10);
  return Number.isFinite(count) ? clampNumber(count, 1, 80) : 0;
}

function inferDemiplaneDetailDieKind(element: Element): DiceValue["kind"] | undefined {
  const context = getDemiplaneDetailDieContext(element);

  if (
    /(history-item-result__die--hunger-|hunger[-_\s]+(?:[1-9]|10|fail|failure|success|critical|crit|special|skull|beast|bestial)(?:[-_\s]+roll)?|hunger\s+(?:[1-9]|10|failure|fail|success|critical|special|skull|beast|bestial)|hunger-(?:[1-9]|10|fail|success|critical|crit|special|skull|beast|bestial)-roll\.png|hunger-fail\.png|hunger-success\.png|hunger-skull\.png|vampiric[-_\s]+skull|vampiric\s+skull)/i.test(
      context
    )
  ) {
    return "hunger";
  }

  if (
    /(history-item-result__die--standard-|standard[-_\s]+(?:[1-9]|10|fail|failure|success|critical|crit|special)(?:[-_\s]+roll)?|standard\s+(?:[1-9]|10|failure|fail|success|critical|special)|standard-(?:[1-9]|10|fail|success|critical|crit|special)-roll\.png|standard-fail\.png|standard-success\.png)/i.test(
      context
    )
  ) {
    return "regular";
  }

  return undefined;
}

function collectVisibleTextRects(root: Element, pattern: RegExp): DOMRect[] {
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Text) || !node.parentElement || !isVisibleElement(node.parentElement)) {
      continue;
    }

    const text = normalizeText(node.textContent ?? "");
    if (!pattern.test(text)) {
      continue;
    }

    const rect = getTextRangeRect(node, 0, node.length);
    if (rect && rect.width > 0 && rect.height > 0) {
      rects.push(rect);
    }
  }

  return rects;
}

function getTextRangeRect(node: Text, start: number, end: number): DOMRect | undefined {
  const range = document.createRange();
  try {
    range.setStart(node, start);
    range.setEnd(node, end);
    return range.getBoundingClientRect();
  } catch {
    return undefined;
  } finally {
    range.detach();
  }
}

function inferDemiplaneDetailDieFace(element: Element): DiceFace | undefined {
  const context = getDemiplaneDetailDieContext(element);

  if (
    /(history-item-result__die--(?:standard|hunger)-(?:fail|failure)|(?:standard|hunger)[-_\s]+(?:fail|failure)|(?:standard|hunger)\s+failure|(?:standard|hunger)\s+fail|standard-fail\.png|hunger-fail\.png|history-item-result__die--standard-[1-5]\b|history-item-result__die--hunger-[2-5]\b|standard[-_\s]+[1-5](?:[-_\s]+roll)?|hunger[-_\s]+[2-5](?:[-_\s]+roll)?|standard-[1-5]-roll\.png|hunger-[2-5]-roll\.png)/i.test(
      context
    )
  ) {
    return "blank";
  }

  if (
    /(history-item-result__die--hunger-(?:1|skull|beast|bestial)\b|hunger[-_\s]+(?:1|skull|beast|bestial)(?:[-_\s]+roll)?|hunger\s+1|vampiric[-_\s]+skull|vampiric\s+skull|hunger-1-roll\.png|hunger-skull\.png|skull\.png)/i.test(
      context
    )
  ) {
    return "skull";
  }

  if (
    /(history-item-result__die--(?:standard|hunger)-(?:10|critical|crit|special)\b|(?:standard|hunger)[-_\s]+(?:10|critical|crit|special)(?:[-_\s]+roll)?|(?:standard|hunger)\s+(?:10|critical|special)|standard-10-roll\.png|hunger-10-roll\.png|special[-_\s]+ankh|fanged[-_\s]+ankh|ankh[-_\s]+fangs?|ankh[-_\s]+presas?|fangs?|presas?|critical\.png|crit\.png|special\.png)/i.test(
      context
    )
  ) {
    return "critical";
  }

  if (
    /(history-item-result__die--(?:standard|hunger)-(?:success|[6-9])\b|(?:standard|hunger)[-_\s]+(?:success|[6-9])(?:[-_\s]+roll)?|(?:standard|hunger)\s+(?:success|[6-9])|standard-success\.png|hunger-success\.png|standard-[6-9]-roll\.png|hunger-[6-9]-roll\.png)/i.test(
      context
    )
  ) {
    return "success";
  }

  return undefined;
}

function getDemiplaneDetailDieContext(element: Element): string {
  const childImageContext = Array.from(element.querySelectorAll("img"))
    .flatMap((image) => [
      image.getAttribute("alt") ?? "",
      image.getAttribute("src") ?? "",
      image.getAttribute("srcset") ?? ""
    ])
    .filter(Boolean)
    .join(" ");

  return `${getElementContext(element)} ${childImageContext}`;
}

function collectDetailMarkerParts(root: Element, marker: Element): Element[] {
  const markerRect = marker.getBoundingClientRect();
  const markerArea = Math.max(1, markerRect.width * markerRect.height);
  const elements = new Set<Element>([marker, ...Array.from(marker.querySelectorAll("*"))]);

  for (const current of Array.from(root.querySelectorAll("*"))) {
    if (!(current instanceof Element) || elements.has(current)) {
      continue;
    }

    const rect = current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const area = rect.width * rect.height;
    if (area > markerArea * 1.8) {
      continue;
    }

    const centerInside =
      rect.left + rect.width / 2 >= markerRect.left - 2 &&
      rect.left + rect.width / 2 <= markerRect.right + 2 &&
      rect.top + rect.height / 2 >= markerRect.top - 2 &&
      rect.top + rect.height / 2 <= markerRect.bottom + 2;
    const mostlyInside =
      rect.left >= markerRect.left - 2 &&
      rect.right <= markerRect.right + 2 &&
      rect.top >= markerRect.top - 2 &&
      rect.bottom <= markerRect.bottom + 2;

    if (centerInside || mostlyInside) {
      elements.add(current);
    }
  }

  return [...elements];
}

function hasStrongRedMarkerColor(element: Element, markerParts?: Element[]): boolean {
  const elements = markerParts ?? [element, ...Array.from(element.querySelectorAll("*"))];

  for (const current of elements) {
    if (!(current instanceof Element)) {
      continue;
    }

    const style = window.getComputedStyle(current);
    for (const color of [style.color, style.backgroundColor, style.borderColor, style.fill, style.stroke]) {
      const rgb = parseRgbColor(color);
      if (!rgb) {
        continue;
      }

      const [red, green, blue] = rgb;
      if (red > 120 && green < 95 && blue < 105 && red > green * 1.35 && red > blue * 1.35) {
        return true;
      }
    }
  }

  return false;
}

function hasDominantRedFillColor(element: Element, markerParts?: Element[]): boolean {
  const markerRect = element.getBoundingClientRect();
  const markerArea = Math.max(1, markerRect.width * markerRect.height);
  const elements = markerParts ?? [element, ...Array.from(element.querySelectorAll("*"))];

  for (const current of elements) {
    if (!(current instanceof Element)) {
      continue;
    }

    const style = window.getComputedStyle(current);
    const hasRedFill = [style.backgroundColor, style.fill].some((color) => {
      const rgb = parseRgbColor(color);
      if (!rgb) {
        return false;
      }

      const [red, green, blue] = rgb;
      return red > 120 && green < 95 && blue < 105 && red > green * 1.35 && red > blue * 1.35;
    });

    if (!hasRedFill) {
      continue;
    }

    const rect = current.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area >= markerArea * 0.4) {
      return true;
    }
  }

  return false;
}

function hasStrongLightMarkerColor(element: Element, markerParts?: Element[]): boolean {
  const elements = markerParts ?? [element, ...Array.from(element.querySelectorAll("*"))];

  for (const current of elements) {
    if (!(current instanceof Element)) {
      continue;
    }

    const style = window.getComputedStyle(current);
    for (const color of [style.color, style.backgroundColor, style.borderColor, style.fill, style.stroke]) {
      const rgb = parseRgbColor(color);
      if (!rgb) {
        continue;
      }

      const [red, green, blue] = rgb;
      if (red > 180 && green > 180 && blue > 180) {
        return true;
      }
    }
  }

  return false;
}

function parseDiceFromText(lines: string[]): DiceValue[] {
  const dice: DiceValue[] = [];

  for (const line of lines) {
    if (/(dice rolled|dados rolados|dados jogados|successes|sucessos?)/i.test(line)) {
      continue;
    }

    if (!/(dice|dado|dados|hunger|fome|regular)/i.test(line)) {
      continue;
    }

    const kind: DiceValue["kind"] = /(hunger|fome)/i.test(line) ? "hunger" : "regular";
    const matches = line.match(/\b(?:[1-9]|[1-9]\d)\b/g) ?? [];

    for (const match of matches) {
      const value = Number.parseInt(match, 10);
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        continue;
      }

      dice.push({
        kind,
        value,
        sides: value <= 10 ? 10 : undefined,
        face: getDieFaceFromValue(kind, value)
      });

      if (dice.length >= 80) {
        return dice;
      }
    }
  }

  return dice;
}

function isVisibleElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function getElementContext(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 4) {
    parts.push(current.tagName);

    for (const attribute of Array.from(current.attributes)) {
      if (attribute.name === "style" || attribute.name === "d") {
        continue;
      }

      parts.push(attribute.name, attribute.value);
    }

    current = current.parentElement;
    depth += 1;
  }

  return parts.join(" ");
}

function normalizeKindForFace(kind: DiceValue["kind"], face: DiceFace): DiceValue["kind"] {
  if (face === "skull") {
    return "hunger";
  }

  return kind;
}

function createDiceValue(kind: DiceValue["kind"], face: DiceFace): DiceValue {
  return {
    kind,
    value: representativeValueForFace(kind, face),
    sides: 10,
    face
  };
}

function representativeValueForFace(kind: DiceValue["kind"], face: DiceFace): number {
  if (face === "skull") {
    return 1;
  }

  if (face === "critical") {
    return 10;
  }

  if (face === "success") {
    return 6;
  }

  return kind === "hunger" ? 2 : 1;
}

function getDieFaceFromValue(kind: DiceValue["kind"], value: number): DiceFace | undefined {
  if (kind === "hunger" && value === 1) {
    return "skull";
  }

  if (value === 10) {
    return "critical";
  }

  if (value >= 6 && value <= 9) {
    return "success";
  }

  if (value >= 1 && value <= 5) {
    return "blank";
  }

  return undefined;
}

function parseRgbColor(color: string): [number, number, number] | undefined {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return undefined;
  }

  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), Number.parseInt(match[3], 10)];
}

function diceKey(dice: DiceValue[]): string {
  return dice.map((die) => `${die.kind}:${die.face ?? getDieFace(die)}:${die.value}`).join(",");
}

function wasRecentlySeen(signature: string): boolean {
  const seenAt = seenSignatures.get(signature);
  return typeof seenAt === "number" && Date.now() - seenAt < signatureTtlMs;
}

function pruneSeenSignatures(): void {
  const now = Date.now();
  for (const [signature, seenAt] of seenSignatures) {
    if (now - seenAt > signatureTtlMs) {
      seenSignatures.delete(signature);
    }
  }
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function addRoll(roll: RollEvent, origin: "local" | "remote", delivery: string): void {
  if (!isDisplayableRoll(roll)) {
    return;
  }

  if (rolls.some((item) => item.roll.id === roll.id)) {
    return;
  }

  rolls.unshift({ roll, origin, delivery });
  rolls.splice(20);
  renderPanel();

  if (delivery !== "history") {
    const shouldShowToast = shouldShowLiveRoll({ roll, origin, delivery });
    const animated = playDiceAnimation(roll, shouldShowToast ? () => showLiveRoll(roll, delivery) : undefined);
    if (shouldShowToast && !animated) {
      showLiveRoll(roll, delivery);
    }
  }
}

function replaceRolls(nextRolls: StoredRoll[]): void {
  rolls.splice(0, rolls.length);

  for (const item of nextRolls) {
    if (!isDisplayableRoll(item.roll)) {
      continue;
    }

    rolls.push({
      roll: item.roll,
      origin: item.origin,
      delivery: item.delivery
    });
  }

  rolls.splice(100);
  if (initialSeenMigrationCutoff > 0) {
    const cutoff = initialSeenMigrationCutoff;
    initialSeenMigrationCutoff = 0;
    const changed = markRollsSeen(
      getVisibleRolls().filter((item) => {
        const createdAt = Date.parse(item.roll.createdAt);
        return Number.isFinite(createdAt) && createdAt <= cutoff;
      })
    );
    if (changed) {
      void savePanelUiState();
    }
  }
  renderPanel();
}

function getVisibleRolls(): Array<{ roll: RollEvent; origin: "local" | "remote"; delivery: string }> {
  return rolls.filter(shouldShowRoll);
}

function getUnreadVisibleRolls(
  visibleRolls: Array<{ roll: RollEvent; origin: "local" | "remote"; delivery: string }>
): Array<{ roll: RollEvent; origin: "local" | "remote"; delivery: string }> {
  return visibleRolls.filter((item) => item.origin === "remote" && item.delivery !== "history" && !seenRollIds.has(item.roll.id));
}

function markRollsSeen(items: Array<{ roll: RollEvent; origin: "local" | "remote"; delivery: string }>): boolean {
  let changed = false;

  for (const item of items) {
    if (item.origin !== "remote" || seenRollIds.has(item.roll.id)) {
      continue;
    }

    seenRollIds.add(item.roll.id);
    changed = true;
  }

  if (seenRollIds.size > maxSeenRollIds) {
    seenRollIds = new Set(Array.from(seenRollIds).slice(-maxSeenRollIds));
    changed = true;
  }

  return changed;
}

function shouldShowRoll(item: { roll: RollEvent; origin: "local" | "remote"; delivery: string }): boolean {
  if (item.origin !== "local") {
    return true;
  }

  return shouldShowOwnRolls() || hasSpecialOutcome(item.roll);
}

function shouldShowLiveRoll(item: { roll: RollEvent; origin: "local" | "remote"; delivery: string }): boolean {
  return shouldShowRoll(item);
}

function shouldShowOwnRolls(): boolean {
  return currentConfig?.showOwnRolls === true;
}

function shouldAnimateDice(): boolean {
  return currentConfig?.enableDiceAnimation !== false;
}

function hasSpecialOutcome(roll: RollEvent): boolean {
  const outcome = getRollOutcome(roll);
  return outcome === "bestialFailure" || outcome === "messyCritical" || outcome === "criticalSuccess";
}

function isDisplayableRoll(roll: RollEvent): boolean {
  return (
    isUsefulRollTitle(roll.rollTitle) &&
    typeof roll.successes === "number" &&
    !isControlBlock(roll.rawText)
  );
}

function createPanel(): {
  host: HTMLDivElement;
  status: HTMLButtonElement;
  players: HTMLSpanElement;
  count: HTMLSpanElement;
  countLabel: HTMLSpanElement;
  list: HTMLOListElement;
  toggle: HTMLButtonElement;
  diagnostic: HTMLDivElement;
  panelRoot: HTMLElement;
  header: HTMLElement;
  settings: HTMLButtonElement;
  settingsPanel: HTMLDivElement;
  roomSummary: HTMLDivElement;
  roomForm: HTMLDivElement;
  storytellerRow: HTMLDivElement;
  roomChannelSummaryLabel: HTMLSpanElement;
  roomChannelSummary: HTMLElement;
  roomHostSummaryLabel: HTMLSpanElement;
  roomHostSummary: HTMLElement;
  roomPlayersSummaryLabel: HTMLSpanElement;
  roomPlayersSummary: HTMLElement;
  roomStatusSummary: HTMLParagraphElement;
  roomPlayersList: HTMLDivElement;
  summaryStorytellerRow: HTMLLabelElement;
  summaryHideCharacterNameInput: HTMLInputElement;
  summaryHideCharacterLabel: HTMLSpanElement;
  summaryDisconnectButton: HTMLButtonElement;
  hostRoomButton: HTMLButtonElement;
  joinRoomButton: HTMLButtonElement;
  playerNameInput: HTMLInputElement;
  hideCharacterNameInput: HTMLInputElement;
  channelInput: HTMLInputElement;
  passwordInput: HTMLInputElement;
  relayInput: HTMLInputElement;
  relayKeyInput: HTMLInputElement;
  saveRoomButton: HTMLButtonElement;
  connectRoomButton: HTMLButtonElement;
  disconnectRoomButton: HTMLButtonElement;
  opacityInput: HTMLInputElement;
  languageSelect: HTMLSelectElement;
  showOwnRollsInput: HTMLInputElement;
  diceAnimationInput: HTMLInputElement;
  diceSizeInput: HTMLInputElement;
} {
  const host = document.createElement("div");
  host.id = "demiplane-dice-room-panel";

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      :host([data-positioned="true"]) {
        right: auto;
        bottom: auto;
      }

      :host([data-collapsed="true"]) .list {
        display: none;
      }

      :host(:not([data-diagnostic="true"])) .diagnostic {
        display: none;
      }

      :host(:not([data-settings="true"])) .settings-panel {
        display: none;
      }

      :host([data-settings="true"]) .list {
        display: none;
      }

      :host([data-collapsed="true"]) .panel {
        width: min(300px, calc(100vw - 32px));
      }

      :host([data-settings="true"]) .panel {
        max-height: min(760px, calc(100vh - 32px));
      }

      * {
        box-sizing: border-box;
      }

      [hidden] {
        display: none !important;
      }

      .panel {
        width: min(360px, calc(100vw - 32px));
        max-height: min(520px, calc(100vh - 32px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(190, 202, 220, 0.22);
        border-radius: 8px;
        color: #f4f6fa;
        background: rgba(16, 19, 24, var(--panel-opacity, 0.94));
        box-shadow: 0 16px 50px rgba(0, 0, 0, 0.38);
        backdrop-filter: blur(14px);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border-bottom: 1px solid rgba(190, 202, 220, 0.14);
        padding: 10px 12px;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }

      .header:active {
        cursor: grabbing;
      }

      .title {
        display: grid;
        gap: 2px;
      }

      .title strong {
        font-size: 13px;
        line-height: 1.1;
      }

      .title span {
        color: #aeb8c7;
        font-size: 11px;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .header-actions button {
        position: relative;
      }

      .version-chip {
        color: #8e9aaa;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0;
        white-space: nowrap;
      }

      .players-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 22px;
        border: 1px solid rgba(190, 202, 220, 0.18);
        border-radius: 999px;
        padding: 0 7px;
        color: #cbd5e1;
        background: rgba(255, 255, 255, 0.045);
        font-size: 11px;
        font-weight: 850;
      }

      .status {
        border: 1px solid #343d4a;
        border-radius: 999px;
        padding: 4px 8px;
        color: #dbe2ee;
        background: #1d242d;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
      }

      button.status {
        font-family: inherit;
      }

      .icon-button,
      .toggle {
        width: 28px;
        height: 28px;
        border: 1px solid #343d4a;
        border-radius: 6px;
        color: #dbe2ee;
        background: #202730;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        line-height: 1;
      }

      .icon-button:hover,
      .toggle:hover {
        background: #2a3340;
      }

      .icon-button[data-tooltip]::after,
      .toggle[data-tooltip]::after {
        content: attr(data-tooltip);
        position: absolute;
        right: 0;
        top: calc(100% + 8px);
        z-index: 3;
        width: max-content;
        max-width: 220px;
        border: 1px solid rgba(190, 202, 220, 0.18);
        border-radius: 6px;
        padding: 6px 8px;
        color: #f4f6fa;
        background: rgba(18, 23, 30, 0.98);
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.34);
        font-size: 11px;
        font-weight: 750;
        line-height: 1.25;
        text-align: left;
        white-space: normal;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-3px);
        transition:
          opacity 120ms ease,
          transform 120ms ease;
      }

      .icon-button[data-tooltip]:hover::after,
      .icon-button[data-tooltip]:focus-visible::after,
      .toggle[data-tooltip]:hover::after,
      .toggle[data-tooltip]:focus-visible::after {
        opacity: 1;
        transform: translateY(0);
      }

      .status-connected {
        border-color: #2f7255;
        color: #bdf4d2;
        background: #183526;
      }

      .status-connecting {
        border-color: #7c6835;
        color: #ffe5a3;
        background: #332b16;
      }

      .status-local {
        border-color: #475569;
        color: #d8e0ec;
        background: #202733;
      }

      .status-error {
        border-color: #8a4648;
        color: #ffd0d0;
        background: #3a2022;
      }

      .list {
        min-height: 120px;
        max-height: 430px;
        margin: 0;
        padding: 8px;
        overflow: auto;
        list-style: none;
      }

      .diagnostic {
        border-top: 1px solid rgba(190, 202, 220, 0.14);
        padding: 10px 12px;
        color: #c9d2df;
        background: rgba(255, 255, 255, 0.025);
        font-size: 12px;
        line-height: 1.4;
      }

      .diagnostic strong {
        display: block;
        margin-bottom: 5px;
        color: #f2f5fb;
        font-size: 12px;
      }

      .diagnostic code {
        border: 1px solid rgba(190, 202, 220, 0.16);
        border-radius: 5px;
        padding: 1px 4px;
        color: #f5f7fb;
        background: rgba(0, 0, 0, 0.22);
        font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      }

      .settings-panel {
        min-height: 0;
        max-height: calc(100vh - 92px);
        overflow-y: auto;
        border-top: 1px solid rgba(190, 202, 220, 0.14);
        padding: 10px 12px;
        color: #c9d2df;
        background: rgba(255, 255, 255, 0.025);
        font-size: 12px;
        scrollbar-color: rgba(190, 202, 220, 0.42) rgba(255, 255, 255, 0.04);
        scrollbar-width: thin;
      }

      .settings-row {
        display: grid;
        gap: 6px;
      }

      .settings-row + .settings-row {
        margin-top: 10px;
      }

      .settings-title {
        margin: 0 0 8px;
        color: #f1f4f8;
        font-size: 11px;
        font-weight: 850;
        text-transform: uppercase;
      }

      .room-summary {
        display: grid;
        gap: 10px;
      }

      .room-summary-card {
        display: grid;
        gap: 8px;
        border: 1px solid rgba(190, 202, 220, 0.14);
        border-radius: 7px;
        padding: 9px;
        background: rgba(9, 12, 17, 0.42);
      }

      .summary-row {
        display: grid;
        grid-template-columns: minmax(72px, auto) 1fr;
        gap: 10px;
        align-items: baseline;
      }

      .summary-label {
        color: #8e9aaa;
        font-size: 10px;
        font-weight: 850;
        text-transform: uppercase;
      }

      .summary-value {
        min-width: 0;
        color: #f1f4f8;
        font-weight: 850;
        overflow-wrap: anywhere;
        text-align: right;
      }

      .summary-note {
        margin: 0;
        color: #aab4c4;
        font-size: 11px;
        line-height: 1.35;
      }

      .room-players-list {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .room-player-chip {
        border: 1px solid rgba(190, 202, 220, 0.16);
        border-radius: 999px;
        padding: 3px 7px;
        color: #dce5f2;
        background: rgba(255, 255, 255, 0.045);
        font-size: 11px;
        font-weight: 800;
      }

      .room-player-chip.host {
        border-color: rgba(80, 188, 126, 0.38);
        color: #bdf4d2;
        background: rgba(24, 53, 38, 0.68);
      }

      .room-player-chip small {
        color: inherit;
        opacity: 0.78;
        font-size: 10px;
      }

      .summary-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #dce5f2;
        font-weight: 850;
      }

      .summary-checkbox input {
        width: auto;
      }

      .summary-disconnect {
        min-height: 32px;
        border: 1px solid #68424a;
        border-radius: 6px;
        padding: 7px 9px;
        color: #ffe3e7;
        background: #352126;
        font: inherit;
        font-weight: 850;
        cursor: pointer;
      }

      .summary-disconnect:hover {
        background: #44262d;
      }

      .settings-divider {
        margin-top: 12px;
        border-top: 1px solid rgba(190, 202, 220, 0.12);
        padding-top: 10px;
      }

      .settings-row label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-weight: 800;
      }

      .settings-row input {
        width: 100%;
      }

      .settings-row input[type="text"],
      .settings-row input[type="password"],
      .settings-row input[type="url"] {
        border: 1px solid #343d4a;
        border-radius: 6px;
        padding: 6px 8px;
        color: #f4f6fa;
        background: #202730;
        font: inherit;
        outline: none;
      }

      .settings-row input[type="text"]:focus,
      .settings-row input[type="password"]:focus,
      .settings-row input[type="url"]:focus {
        border-color: #6da0ff;
        box-shadow: 0 0 0 2px rgba(109, 160, 255, 0.18);
      }

      .settings-row input[type="checkbox"] {
        width: auto;
      }

      .mode-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
      }

      .mode-actions button {
        min-height: 30px;
        border: 1px solid #384251;
        border-radius: 6px;
        padding: 6px 8px;
        color: #cbd5e1;
        background: #202730;
        font: inherit;
        font-weight: 850;
        cursor: pointer;
      }

      .mode-actions button.active {
        border-color: #2f7255;
        color: #bdf4d2;
        background: #183526;
      }

      .mode-actions button:disabled {
        cursor: default;
        opacity: 0.55;
      }

      .checkbox-row {
        justify-content: flex-start;
      }

      .settings-help {
        margin: 0;
        color: #8e9aaa;
        font-size: 11px;
        line-height: 1.35;
      }

      .settings-row select {
        width: 100%;
        border: 1px solid #343d4a;
        border-radius: 6px;
        padding: 6px 8px;
        color: #f4f6fa;
        background: #202730;
        font: inherit;
      }

      .settings-actions {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 7px;
        margin-top: 10px;
      }

      .settings-actions button {
        min-height: 30px;
        border: 1px solid #384251;
        border-radius: 6px;
        padding: 6px 8px;
        color: #f3f6fb;
        background: #252c36;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }

      .settings-actions button:hover {
        background: #303847;
      }

      .settings-actions button:disabled {
        cursor: default;
        opacity: 0.55;
      }

      .empty {
        display: grid;
        place-items: center;
        min-height: 96px;
        color: #8995a6;
        font-size: 12px;
      }

      .roll {
        border: 1px solid rgba(190, 202, 220, 0.13);
        border-radius: 7px;
        padding: 9px;
        background: rgba(255, 255, 255, 0.035);
      }

      .roll + .roll {
        margin-top: 7px;
      }

      .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #aeb8c7;
        font-size: 11px;
      }

      .player {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #e7ebf2;
        font-weight: 700;
      }

      .badge {
        flex: 0 0 auto;
        color: #9eabbc;
      }

      .roll-title {
        margin-top: 5px;
        overflow-wrap: anywhere;
        color: #f6f7fb;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.25;
      }

      .result {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 7px;
      }

      .chip {
        border: 1px solid rgba(190, 202, 220, 0.14);
        border-radius: 999px;
        padding: 3px 7px;
        color: #d8e0ec;
        background: rgba(255, 255, 255, 0.05);
        font-size: 11px;
        font-weight: 700;
      }

      .dice-row {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }

      .die {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 24px;
        border: 1px solid rgba(190, 202, 220, 0.16);
        border-radius: 6px;
        padding: 3px 6px;
        color: #e7ecf5;
        background: rgba(255, 255, 255, 0.045);
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
      }

      .die-gem {
        width: 10px;
        height: 10px;
        flex: 0 0 auto;
        border: 1px solid currentColor;
        transform: rotate(45deg);
      }

      .die-regular {
        color: #d5dce8;
        border-color: rgba(165, 177, 194, 0.34);
        background: rgba(17, 20, 25, 0.76);
      }

      .die-regular .die-gem {
        background: #1b2028;
      }

      .die-hunger {
        color: #ffd8dc;
        border-color: rgba(218, 55, 70, 0.46);
        background: rgba(61, 16, 22, 0.72);
      }

      .die-hunger .die-gem {
        background: #b91828;
      }

      .die-critical {
        box-shadow: 0 0 0 1px rgba(242, 215, 126, 0.18) inset;
      }

      .die-skull {
        color: #ffd0d5;
      }

      .outcome {
        margin-top: 7px;
        color: #f5d27a;
        font-size: 11px;
        font-weight: 850;
        text-transform: uppercase;
      }

      .raw {
        margin-top: 7px;
        color: #96a1b1;
        font-size: 11px;
        line-height: 1.35;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    </style>
    <section class="panel" aria-live="polite">
      <header class="header">
        <div class="title">
          <strong>Dice Room</strong>
          <span data-count-label><span data-count>0</span> rolagens</span>
        </div>
        <div class="header-actions">
          <button data-status class="status" type="button" title="Abrir diagnostico">Desconectado</button>
          <span class="version-chip" title="Versao da extensao">v${extensionUiVersion}</span>
          <span data-players class="players-chip" title="Jogadores na sala">0</span>
          <button data-settings-button class="icon-button" type="button" aria-label="Abrir configuracoes" data-tooltip="Abrir configuracoes">⚙</button>
          <button data-toggle class="toggle" type="button" aria-label="Abrir historico" data-tooltip="Abrir historico">^</button>
        </div>
      </header>
      <div data-diagnostic class="diagnostic"></div>
      <div data-settings-panel class="settings-panel">
        <p data-settings-room-label class="settings-title">Sala da mesa</p>
        <div data-room-summary class="room-summary" hidden>
          <div class="room-summary-card">
            <div class="summary-row">
              <span data-room-channel-summary-label class="summary-label">Mesa</span>
              <strong data-room-channel-summary class="summary-value"></strong>
            </div>
            <div class="summary-row">
              <span data-room-host-summary-label class="summary-label">Narrador</span>
              <strong data-room-host-summary class="summary-value"></strong>
            </div>
            <div class="summary-row">
              <span data-room-players-summary-label class="summary-label">Jogadores</span>
              <strong data-room-players-summary class="summary-value"></strong>
            </div>
            <p data-room-status-summary class="summary-note"></p>
            <div data-room-players-list class="room-players-list"></div>
            <label data-summary-storyteller-row class="summary-checkbox" hidden>
              <input data-summary-hide-character-name type="checkbox" />
              <span data-summary-hide-character-label>Fazer rolagem como Narrador</span>
            </label>
          </div>
          <button data-summary-disconnect class="summary-disconnect" type="button">Desconectar</button>
        </div>
        <div data-room-form class="room-form">
          <div class="settings-row">
            <label>
              <span data-settings-room-mode-label>Modo</span>
            </label>
            <div class="mode-actions">
              <button data-host-room type="button">Criar</button>
              <button data-join-room type="button">Entrar</button>
            </div>
          </div>
          <div class="settings-row">
            <label for="dice-room-player-name">
              <span data-settings-player-label>Nome do jogador</span>
            </label>
            <input id="dice-room-player-name" data-player-name type="text" autocomplete="name" />
          </div>
          <div data-storyteller-row class="settings-row">
            <label class="checkbox-row">
              <input data-hide-character-name type="checkbox" />
              <span data-settings-hide-character-label>Fazer rolagem como Narrador</span>
            </label>
          </div>
          <div class="settings-row">
            <label for="dice-room-channel">
              <span data-settings-channel-label>Canal</span>
            </label>
            <input id="dice-room-channel" data-channel type="text" autocomplete="off" />
          </div>
          <div class="settings-row">
            <label for="dice-room-password">
              <span data-settings-password-label>Senha</span>
            </label>
            <input id="dice-room-password" data-password type="password" autocomplete="current-password" />
          </div>
          <div class="settings-row">
            <label for="dice-room-relay">
              <span data-settings-relay-label>Relay</span>
            </label>
            <input id="dice-room-relay" data-relay type="url" autocomplete="off" />
          </div>
          <div class="settings-row">
            <label for="dice-room-relay-key">
              <span data-settings-relay-key-label>Chave do relay</span>
            </label>
            <input id="dice-room-relay-key" data-relay-key type="password" autocomplete="off" />
          </div>
          <div class="settings-actions">
            <button data-save-room type="button">Salvar</button>
            <button data-connect-room type="button">Conectar</button>
            <button data-disconnect-room type="button">Desconectar</button>
          </div>
        </div>
        <div class="settings-divider">
        <div class="settings-row">
          <label>
            <span data-settings-opacity-label>Opacidade</span>
            <span data-opacity-value></span>
          </label>
          <input data-opacity type="range" min="0.30" max="1" step="0.05" />
        </div>
        <div class="settings-row">
          <label for="dice-room-language">
            <span data-settings-language-label>Idioma</span>
          </label>
          <select id="dice-room-language" data-language>
            <option value="pt-BR">Português</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="settings-row">
          <label class="checkbox-row">
            <input data-show-own-rolls type="checkbox" />
            <span data-settings-show-own-label>Mostrar minhas rolagens</span>
          </label>
          <p data-settings-show-own-help class="settings-help"></p>
        </div>
        <div class="settings-row">
          <label class="checkbox-row">
            <input data-dice-animation type="checkbox" />
            <span data-settings-animation-label>Animacao dos dados</span>
          </label>
          <p data-settings-animation-help class="settings-help"></p>
        </div>
        <div class="settings-row">
          <label>
            <span data-settings-dice-size-label>Tamanho dos dados</span>
            <span data-dice-size-value></span>
          </label>
          <input data-dice-size type="range" min="0.45" max="1.15" step="0.05" />
        </div>
        </div>
      </div>
      <ol data-list class="list"></ol>
    </section>
  `;

  const panelRoot = shadow.querySelector(".panel");
  const header = shadow.querySelector(".header");
  const status = shadow.querySelector("[data-status]");
  const players = shadow.querySelector("[data-players]");
  const count = shadow.querySelector("[data-count]");
  const countLabel = shadow.querySelector("[data-count-label]");
  const list = shadow.querySelector("[data-list]");
  const toggle = shadow.querySelector("[data-toggle]");
  const diagnostic = shadow.querySelector("[data-diagnostic]");
  const settings = shadow.querySelector("[data-settings-button]");
  const settingsPanel = shadow.querySelector("[data-settings-panel]");
  const roomSummary = shadow.querySelector("[data-room-summary]");
  const roomForm = shadow.querySelector("[data-room-form]");
  const storytellerRow = shadow.querySelector("[data-storyteller-row]");
  const roomChannelSummaryLabel = shadow.querySelector("[data-room-channel-summary-label]");
  const roomChannelSummary = shadow.querySelector("[data-room-channel-summary]");
  const roomHostSummaryLabel = shadow.querySelector("[data-room-host-summary-label]");
  const roomHostSummary = shadow.querySelector("[data-room-host-summary]");
  const roomPlayersSummaryLabel = shadow.querySelector("[data-room-players-summary-label]");
  const roomPlayersSummary = shadow.querySelector("[data-room-players-summary]");
  const roomStatusSummary = shadow.querySelector("[data-room-status-summary]");
  const roomPlayersList = shadow.querySelector("[data-room-players-list]");
  const summaryStorytellerRow = shadow.querySelector("[data-summary-storyteller-row]");
  const summaryHideCharacterNameInput = shadow.querySelector("[data-summary-hide-character-name]");
  const summaryHideCharacterLabel = shadow.querySelector("[data-summary-hide-character-label]");
  const summaryDisconnectButton = shadow.querySelector("[data-summary-disconnect]");
  const hostRoomButton = shadow.querySelector("[data-host-room]");
  const joinRoomButton = shadow.querySelector("[data-join-room]");
  const opacityInput = shadow.querySelector("[data-opacity]");
  const playerNameInput = shadow.querySelector("[data-player-name]");
  const hideCharacterNameInput = shadow.querySelector("[data-hide-character-name]");
  const channelInput = shadow.querySelector("[data-channel]");
  const passwordInput = shadow.querySelector("[data-password]");
  const relayInput = shadow.querySelector("[data-relay]");
  const relayKeyInput = shadow.querySelector("[data-relay-key]");
  const saveRoomButton = shadow.querySelector("[data-save-room]");
  const connectRoomButton = shadow.querySelector("[data-connect-room]");
  const disconnectRoomButton = shadow.querySelector("[data-disconnect-room]");
  const languageSelect = shadow.querySelector("[data-language]");
  const showOwnRollsInput = shadow.querySelector("[data-show-own-rolls]");
  const diceAnimationInput = shadow.querySelector("[data-dice-animation]");
  const diceSizeInput = shadow.querySelector("[data-dice-size]");
  const opacityValue = shadow.querySelector("[data-opacity-value]");

  if (
    !(panelRoot instanceof HTMLElement) ||
    !(header instanceof HTMLElement) ||
    !(status instanceof HTMLButtonElement) ||
    !(players instanceof HTMLSpanElement) ||
    !(count instanceof HTMLSpanElement) ||
    !(countLabel instanceof HTMLSpanElement) ||
    !(list instanceof HTMLOListElement) ||
    !(toggle instanceof HTMLButtonElement) ||
    !(diagnostic instanceof HTMLDivElement) ||
    !(settings instanceof HTMLButtonElement) ||
    !(settingsPanel instanceof HTMLDivElement) ||
    !(roomSummary instanceof HTMLDivElement) ||
    !(roomForm instanceof HTMLDivElement) ||
    !(storytellerRow instanceof HTMLDivElement) ||
    !(roomChannelSummaryLabel instanceof HTMLSpanElement) ||
    !(roomChannelSummary instanceof HTMLElement) ||
    !(roomHostSummaryLabel instanceof HTMLSpanElement) ||
    !(roomHostSummary instanceof HTMLElement) ||
    !(roomPlayersSummaryLabel instanceof HTMLSpanElement) ||
    !(roomPlayersSummary instanceof HTMLElement) ||
    !(roomStatusSummary instanceof HTMLParagraphElement) ||
    !(roomPlayersList instanceof HTMLDivElement) ||
    !(summaryStorytellerRow instanceof HTMLLabelElement) ||
    !(summaryHideCharacterNameInput instanceof HTMLInputElement) ||
    !(summaryHideCharacterLabel instanceof HTMLSpanElement) ||
    !(summaryDisconnectButton instanceof HTMLButtonElement) ||
    !(hostRoomButton instanceof HTMLButtonElement) ||
    !(joinRoomButton instanceof HTMLButtonElement) ||
    !(opacityInput instanceof HTMLInputElement) ||
    !(playerNameInput instanceof HTMLInputElement) ||
    !(hideCharacterNameInput instanceof HTMLInputElement) ||
    !(channelInput instanceof HTMLInputElement) ||
    !(passwordInput instanceof HTMLInputElement) ||
    !(relayInput instanceof HTMLInputElement) ||
    !(relayKeyInput instanceof HTMLInputElement) ||
    !(saveRoomButton instanceof HTMLButtonElement) ||
    !(connectRoomButton instanceof HTMLButtonElement) ||
    !(disconnectRoomButton instanceof HTMLButtonElement) ||
    !(languageSelect instanceof HTMLSelectElement) ||
    !(showOwnRollsInput instanceof HTMLInputElement) ||
    !(diceAnimationInput instanceof HTMLInputElement) ||
    !(diceSizeInput instanceof HTMLInputElement) ||
    !(opacityValue instanceof HTMLSpanElement)
  ) {
    throw new Error("Painel nao foi inicializado corretamente.");
  }

  status.addEventListener("click", () => {
    diagnosticOpen = !diagnosticOpen;
    renderPanel();
  });

  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    if (!collapsed) {
      settingsOpen = false;
      markRollsSeen(getVisibleRolls());
    }
    renderPanel();
    void savePanelUiState();
  });

  settings.addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    if (settingsOpen) {
      collapsed = true;
    }
    renderPanel();
    void savePanelUiState();
  });

  hostRoomButton.addEventListener("click", () => {
    if (isRoomLocked()) {
      return;
    }

    currentConfig = {
      ...(currentConfig ?? defaultConfig),
      roomRole: "host",
      hideCharacterName: panel?.hideCharacterNameInput.checked ?? false
    };
    renderPanel();
    void savePanelRoomConfig();
  });

  joinRoomButton.addEventListener("click", () => {
    if (isRoomLocked()) {
      return;
    }

    currentConfig = {
      ...(currentConfig ?? defaultConfig),
      roomRole: "player",
      hideCharacterName: false
    };
    renderPanel();
    void savePanelRoomConfig();
  });

  saveRoomButton.addEventListener("click", () => {
    void savePanelRoomConfig();
  });

  connectRoomButton.addEventListener("click", () => {
    void savePanelRoomConfig().then(() => sendRuntimeMessage({ kind: "popup:connect" }));
  });

  disconnectRoomButton.addEventListener("click", () => {
    if (!confirmHostedRoomExit()) {
      return;
    }

    void sendRuntimeMessage({ kind: "popup:disconnect" });
  });

  summaryDisconnectButton.addEventListener("click", () => {
    if (!confirmHostedRoomExit()) {
      return;
    }

    void sendRuntimeMessage({ kind: "popup:disconnect" });
  });

  hideCharacterNameInput.addEventListener("change", () => {
    setStorytellerRollPreference(hideCharacterNameInput.checked);
  });

  summaryHideCharacterNameInput.addEventListener("change", () => {
    setStorytellerRollPreference(summaryHideCharacterNameInput.checked);
  });

  opacityInput.addEventListener("input", () => {
    panelOpacity = Number.parseFloat(opacityInput.value);
    opacityValue.textContent = `${Math.round(panelOpacity * 100)}%`;
    renderPanel();
  });

  opacityInput.addEventListener("change", () => {
    void savePanelUiState();
  });

  languageSelect.addEventListener("change", () => {
    uiLanguage = languageSelect.value === "en" ? "en" : "pt-BR";
    renderPanel();
    void savePanelUiState();
  });

  showOwnRollsInput.addEventListener("change", () => {
    currentConfig = {
      ...(currentConfig ?? defaultConfig),
      showOwnRolls: showOwnRollsInput.checked
    };
    renderPanel();
    void chrome.storage.local.set({ showOwnRolls: showOwnRollsInput.checked });
  });

  diceAnimationInput.addEventListener("change", () => {
    currentConfig = {
      ...(currentConfig ?? defaultConfig),
      enableDiceAnimation: diceAnimationInput.checked
    };
    renderPanel();
    void chrome.storage.local.set({ enableDiceAnimation: diceAnimationInput.checked });
  });

  diceSizeInput.addEventListener("input", () => {
    diceAnimationScale = clampNumber(Number.parseFloat(diceSizeInput.value), minDiceAnimationScale, maxDiceAnimationScale);
    renderPanel();
  });

  diceSizeInput.addEventListener("change", () => {
    void savePanelUiState();
  });

  installPanelDrag(host, header);

  return {
    host,
    status,
    players,
    count,
    countLabel,
    list,
    toggle,
    diagnostic,
    panelRoot,
    header,
    settings,
    settingsPanel,
    roomSummary,
    roomForm,
    storytellerRow,
    roomChannelSummaryLabel,
    roomChannelSummary,
    roomHostSummaryLabel,
    roomHostSummary,
    roomPlayersSummaryLabel,
    roomPlayersSummary,
    roomStatusSummary,
    roomPlayersList,
    summaryStorytellerRow,
    summaryHideCharacterNameInput,
    summaryHideCharacterLabel,
    summaryDisconnectButton,
    hostRoomButton,
    joinRoomButton,
    opacityInput,
    playerNameInput,
    hideCharacterNameInput,
    channelInput,
    passwordInput,
    relayInput,
    relayKeyInput,
    saveRoomButton,
    connectRoomButton,
    disconnectRoomButton,
    languageSelect,
    showOwnRollsInput,
    diceAnimationInput,
    diceSizeInput
  };
}

function renderPanel(): void {
  if (!panel) {
    return;
  }

  const visibleRolls = getVisibleRolls();
  if (!collapsed && markRollsSeen(visibleRolls)) {
    void savePanelUiState();
  }
  const unreadRolls = getUnreadVisibleRolls(visibleRolls);
  const displayStatus = getDisplayStatus(connectionState.status);
  panel.status.textContent = statusLabel(displayStatus);
  panel.status.className = `status status-${displayStatus}`;
  panel.status.title = t("openDiagnostic");
  panel.players.textContent = String(connectionState.players.length);
  panel.players.hidden = connectionState.status !== "connected";
  panel.players.title = formatPlayersTooltip(connectionState.players);
  panel.count.textContent = String(unreadRolls.length);
  panel.countLabel.textContent = t("unreadCount", unreadRolls.length);
  panel.countLabel.hidden = unreadRolls.length === 0;
  panel.countLabel.title = t("historyCount", visibleRolls.length);
  panel.host.dataset.collapsed = String(collapsed);
  panel.host.dataset.diagnostic = String(diagnosticOpen);
  panel.host.dataset.settings = String(settingsOpen);
  panel.host.dataset.positioned = String(Boolean(panelPosition));
  panel.host.style.setProperty("--panel-opacity", String(panelOpacity));
  const config = currentConfig ?? defaultConfig;
  const activePanelElement = panel.host.shadowRoot?.activeElement;
  if (activePanelElement !== panel.playerNameInput) {
    panel.playerNameInput.value = config.playerName;
  }
  if (activePanelElement !== panel.channelInput) {
    panel.channelInput.value = config.channel;
  }
  if (activePanelElement !== panel.passwordInput) {
    panel.passwordInput.value = config.password;
  }
  if (activePanelElement !== panel.relayInput) {
    panel.relayInput.value = config.serverUrl;
  }
  if (activePanelElement !== panel.relayKeyInput) {
    panel.relayKeyInput.value = config.relayKey;
  }
  const roomLocked = isRoomLocked();
  const isHost = config.roomRole === "host";
  const roomConnected = connectionState.status === "connected";
  panel.roomSummary.hidden = !roomConnected;
  panel.roomForm.hidden = roomConnected;
  panel.storytellerRow.hidden = roomConnected || !isHost;
  panel.summaryStorytellerRow.hidden = !roomConnected || !isHost;
  panel.hostRoomButton.classList.toggle("active", isHost);
  panel.joinRoomButton.classList.toggle("active", !isHost);
  panel.hostRoomButton.disabled = roomLocked;
  panel.joinRoomButton.disabled = roomLocked;
  panel.channelInput.disabled = roomLocked;
  panel.passwordInput.disabled = roomLocked;
  panel.relayInput.disabled = roomLocked;
  panel.relayKeyInput.disabled = roomLocked;
  panel.hideCharacterNameInput.disabled = roomLocked || !isHost;
  panel.hideCharacterNameInput.checked = isHost && config.hideCharacterName;
  panel.summaryHideCharacterNameInput.disabled = !roomConnected || !isHost;
  panel.summaryHideCharacterNameInput.checked = isHost && config.hideCharacterName;
  if (!isHost) {
    panel.hideCharacterNameInput.checked = false;
    panel.summaryHideCharacterNameInput.checked = false;
  }
  panel.connectRoomButton.disabled = connectionState.status === "connecting" || connectionState.status === "connected";
  panel.disconnectRoomButton.disabled = connectionState.status === "disconnected";
  panel.opacityInput.value = String(panelOpacity);
  panel.languageSelect.value = uiLanguage;
  panel.showOwnRollsInput.checked = shouldShowOwnRolls();
  panel.diceAnimationInput.checked = shouldAnimateDice();
  panel.diceSizeInput.value = String(diceAnimationScale);
  panel.toggle.textContent = collapsed ? "^" : "v";
  panel.toggle.removeAttribute("title");
  panel.toggle.dataset.tooltip = collapsed ? t("openHistory") : t("closeHistory");
  panel.toggle.setAttribute("aria-label", collapsed ? t("openHistory") : t("closeHistory"));
  panel.settings.removeAttribute("title");
  panel.settings.dataset.tooltip = settingsOpen ? t("closeSettings") : t("openSettings");
  panel.settings.setAttribute("aria-label", settingsOpen ? t("closeSettings") : t("openSettings"));
  panel.diagnostic.innerHTML = renderDiagnostic();
  const roomLabel = panel.host.shadowRoot?.querySelector("[data-settings-room-label]");
  if (roomLabel instanceof HTMLParagraphElement) {
    roomLabel.textContent = t("roomSettings");
  }
  renderRoomSummary();
  const roomModeLabel = panel.host.shadowRoot?.querySelector("[data-settings-room-mode-label]");
  if (roomModeLabel instanceof HTMLSpanElement) {
    roomModeLabel.textContent = t("roomMode");
  }
  panel.hostRoomButton.textContent = t("createRoom");
  panel.joinRoomButton.textContent = t("joinRoom");
  const playerLabel = panel.host.shadowRoot?.querySelector("[data-settings-player-label]");
  if (playerLabel instanceof HTMLSpanElement) {
    playerLabel.textContent = t("playerName");
  }
  const hideCharacterLabel = panel.host.shadowRoot?.querySelector("[data-settings-hide-character-label]");
  if (hideCharacterLabel instanceof HTMLSpanElement) {
    hideCharacterLabel.textContent = t("hideCharacterName");
  }
  panel.summaryHideCharacterLabel.textContent = t("hideCharacterName");
  const channelLabel = panel.host.shadowRoot?.querySelector("[data-settings-channel-label]");
  if (channelLabel instanceof HTMLSpanElement) {
    channelLabel.textContent = t("channel");
  }
  const passwordLabel = panel.host.shadowRoot?.querySelector("[data-settings-password-label]");
  if (passwordLabel instanceof HTMLSpanElement) {
    passwordLabel.textContent = t("password");
  }
  const relayLabel = panel.host.shadowRoot?.querySelector("[data-settings-relay-label]");
  if (relayLabel instanceof HTMLSpanElement) {
    relayLabel.textContent = t("relay");
  }
  const relayKeyLabel = panel.host.shadowRoot?.querySelector("[data-settings-relay-key-label]");
  if (relayKeyLabel instanceof HTMLSpanElement) {
    relayKeyLabel.textContent = t("relayKey");
  }
  panel.saveRoomButton.textContent = t("save");
  panel.connectRoomButton.textContent = t("connect");
  panel.disconnectRoomButton.textContent = t("disconnect");
  panel.summaryDisconnectButton.textContent = t("disconnect");
  const opacityValue = panel.host.shadowRoot?.querySelector("[data-opacity-value]");
  if (opacityValue instanceof HTMLSpanElement) {
    opacityValue.textContent = `${Math.round(panelOpacity * 100)}%`;
  }
  const opacityLabel = panel.host.shadowRoot?.querySelector("[data-settings-opacity-label]");
  if (opacityLabel instanceof HTMLSpanElement) {
    opacityLabel.textContent = t("opacity");
  }
  const languageLabel = panel.host.shadowRoot?.querySelector("[data-settings-language-label]");
  if (languageLabel instanceof HTMLSpanElement) {
    languageLabel.textContent = t("language");
  }
  const showOwnRollsLabel = panel.host.shadowRoot?.querySelector("[data-settings-show-own-label]");
  if (showOwnRollsLabel instanceof HTMLSpanElement) {
    showOwnRollsLabel.textContent = t("showOwnRolls");
  }
  const showOwnRollsHelp = panel.host.shadowRoot?.querySelector("[data-settings-show-own-help]");
  if (showOwnRollsHelp instanceof HTMLParagraphElement) {
    showOwnRollsHelp.textContent = t("showOwnRollsHint");
  }
  const diceAnimationLabel = panel.host.shadowRoot?.querySelector("[data-settings-animation-label]");
  if (diceAnimationLabel instanceof HTMLSpanElement) {
    diceAnimationLabel.textContent = t("enableDiceAnimation");
  }
  const diceAnimationHelp = panel.host.shadowRoot?.querySelector("[data-settings-animation-help]");
  if (diceAnimationHelp instanceof HTMLParagraphElement) {
    diceAnimationHelp.textContent = t("enableDiceAnimationHint");
  }
  const diceSizeLabel = panel.host.shadowRoot?.querySelector("[data-settings-dice-size-label]");
  if (diceSizeLabel instanceof HTMLSpanElement) {
    diceSizeLabel.textContent = t("diceAnimationSize");
  }
  const diceSizeValue = panel.host.shadowRoot?.querySelector("[data-dice-size-value]");
  if (diceSizeValue instanceof HTMLSpanElement) {
    diceSizeValue.textContent = `${Math.round(diceAnimationScale * 100)}%`;
  }

  if (panelPosition) {
    const clamped = clampPanelPosition(panelPosition.left, panelPosition.top, panel.host);
    panelPosition = clamped;
    panel.host.style.left = `${clamped.left}px`;
    panel.host.style.top = `${clamped.top}px`;
  } else {
    panel.host.style.left = "";
    panel.host.style.top = "";
  }

  if (visibleRolls.length === 0) {
    panel.list.innerHTML = `<li class="empty">${escapeHtml(translateConnectionDetail(connectionState.detail) || t("waiting"))}</li>`;
    return;
  }

  panel.list.innerHTML = visibleRolls.map(renderRoll).join("");
}

function setStorytellerRollPreference(enabled: boolean): void {
  const config = currentConfig ?? defaultConfig;
  const nextValue = config.roomRole === "host" && enabled;
  currentConfig = {
    ...config,
    hideCharacterName: nextValue
  };

  if (panel) {
    panel.hideCharacterNameInput.checked = nextValue;
    panel.summaryHideCharacterNameInput.checked = nextValue;
  }

  renderPanel();
  void savePanelRoomConfig();
}

function renderRoomSummary(): void {
  if (!panel) {
    return;
  }

  const config = currentConfig ?? defaultConfig;
  const host = getRoomHost(connectionState.players);
  panel.roomChannelSummaryLabel.textContent = t("tableRoom");
  panel.roomHostSummaryLabel.textContent = t("roomHost");
  panel.roomPlayersSummaryLabel.textContent = t("playersInRoom");
  panel.roomChannelSummary.textContent = config.channel || connectionState.roomId || "-";
  panel.roomHostSummary.textContent = host ? formatPresenceDisplayName(host, "player") : t("roomHostUnknown");
  panel.roomPlayersSummary.textContent = t("connectedPlayers", connectionState.players.length);
  panel.roomStatusSummary.textContent = config.roomRole === "host" ? t("roomCreatedByYou") : t("roomJoinedByYou");
  panel.roomPlayersList.innerHTML =
    connectionState.players.length > 0
      ? connectionState.players.map(renderRoomPlayerChip).join("")
      : `<span class="room-player-chip">${escapeHtml(t("playersTooltipEmpty"))}</span>`;
}

function isRoomLocked(): boolean {
  return connectionState.status === "connected" || connectionState.status === "connecting";
}

function confirmHostedRoomExit(): boolean {
  const config = currentConfig ?? defaultConfig;
  if (config.roomRole !== "host" || connectionState.status !== "connected") {
    return true;
  }

  return window.confirm(t("leaveHostedRoomConfirm"));
}

function warnBeforeHostedRoomCloses(event: BeforeUnloadEvent): void {
  const config = currentConfig ?? defaultConfig;
  if (config.roomRole !== "host" || connectionState.status !== "connected") {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
}

function formatPlayersTooltip(players: ConnectionState["players"]): string {
  if (players.length === 0) {
    return t("playersTooltipEmpty");
  }

  return players
    .map((player) => {
      const displayName = formatPresenceDisplayName(player, "character");
      const roleSuffix = player.roomRole === "host" ? ` (${t("hostRole")})` : "";
      return `${displayName}${roleSuffix}`;
    })
    .join("\n");
}

function getRoomHost(players: ConnectionState["players"]): ConnectionState["players"][number] | undefined {
  return players.find((player) => player.roomRole === "host");
}

function formatPresenceDisplayName(
  player: ConnectionState["players"][number],
  preference: "player" | "character"
): string {
  const preferred = preference === "player" ? player.playerName : player.characterName;
  const fallback = preference === "player" ? player.characterName : player.playerName;
  return preferred || fallback || t("playersTooltipEmpty");
}

function renderRoomPlayerChip(player: ConnectionState["players"][number]): string {
  const name = formatPresenceDisplayName(player, "character");
  const roleSuffix = player.roomRole === "host" ? ` ${t("hostRole")}` : "";
  const className = player.roomRole === "host" ? "room-player-chip host" : "room-player-chip";
  return `<span class="${className}">${escapeHtml(name)}${roleSuffix ? ` <small>${escapeHtml(roleSuffix)}</small>` : ""}</span>`;
}

async function savePanelRoomConfig(): Promise<void> {
  if (!panel) {
    return;
  }

  const nextConfig: ExtensionConfig = {
    ...(currentConfig ?? defaultConfig),
    serverUrl: panel.relayInput.value.trim(),
    playerName: panel.playerNameInput.value.trim(),
    characterName: "",
    roomRole: panel.hostRoomButton.classList.contains("active") ? "host" : "player",
    hideCharacterName: panel.hostRoomButton.classList.contains("active") && panel.hideCharacterNameInput.checked,
    channel: panel.channelInput.value.trim(),
    password: panel.passwordInput.value,
    relayKey: panel.relayKeyInput.value.trim(),
    showOwnRolls: panel.showOwnRollsInput.checked,
    enableDiceAnimation: panel.diceAnimationInput.checked
  };

  currentConfig = nextConfig;
  renderPanel();

  const response = await sendRuntimeMessage<{ ok: true; config?: ExtensionConfig; state?: ConnectionState }>({
    kind: "popup:save-config",
    config: nextConfig
  });

  if (response?.config) {
    currentConfig = response.config;
  }

  if (response?.state) {
    connectionState = response.state;
  }

  renderPanel();
}

function installPanelDrag(host: HTMLDivElement, handle: HTMLElement): void {
  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        startLeft: number;
        startTop: number;
        moved: boolean;
      }
    | undefined;

  handle.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest("button, input")) {
      return;
    }

    const rect = host.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false
    };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const nextLeft = drag.startLeft + event.clientX - drag.startX;
    const nextTop = drag.startTop + event.clientY - drag.startY;
    const clamped = clampPanelPosition(nextLeft, nextTop, host);
    panelPosition = clamped;
    host.dataset.positioned = "true";
    host.style.left = `${clamped.left}px`;
    host.style.top = `${clamped.top}px`;
    drag.moved = true;
  });

  handle.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    handle.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      void savePanelUiState();
    }
    drag = undefined;
  });

  window.addEventListener("resize", () => {
    if (!panelPosition) {
      return;
    }

    panelPosition = clampPanelPosition(panelPosition.left, panelPosition.top, host);
    renderPanel();
    void savePanelUiState();
  });
}

function clampPanelPosition(left: number, top: number, host: HTMLElement): { left: number; top: number } {
  const rect = host.getBoundingClientRect();
  const width = rect.width || 300;
  const height = rect.height || 80;
  const margin = 8;

  return {
    left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin)),
    top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin))
  };
}

async function loadPanelUiState(): Promise<void> {
  const stored = await chrome.storage.local.get(panelUiStorageKey);

  const value = stored[panelUiStorageKey] as
    | {
        collapsed?: unknown;
        settingsOpen?: unknown;
        opacity?: unknown;
        diceAnimationScale?: unknown;
        position?: unknown;
        language?: unknown;
        seenRollIds?: unknown;
      }
    | undefined;

  collapsed = value?.collapsed !== false;
  settingsOpen = value?.settingsOpen === true;
  panelOpacity = typeof value?.opacity === "number" ? clampNumber(value.opacity, minPanelOpacity, 1) : 0.94;
  diceAnimationScale =
    typeof value?.diceAnimationScale === "number"
      ? clampNumber(value.diceAnimationScale, minDiceAnimationScale, maxDiceAnimationScale)
      : defaultDiceAnimationScale;
  uiLanguage = value?.language === "en" ? "en" : "pt-BR";
  if (Array.isArray(value?.seenRollIds)) {
    seenRollIds = new Set(value.seenRollIds.filter((id): id is string => typeof id === "string").slice(-maxSeenRollIds));
  } else {
    seenRollIds = new Set();
    initialSeenMigrationCutoff = Date.now();
  }

  if (isPanelPosition(value?.position)) {
    panelPosition = value.position;
  }
}

async function savePanelUiState(): Promise<void> {
  await chrome.storage.local.set({
    [panelUiStorageKey]: {
      collapsed,
      settingsOpen,
      opacity: panelOpacity,
      diceAnimationScale,
      position: panelPosition,
      language: uiLanguage,
      seenRollIds: Array.from(seenRollIds).slice(-maxSeenRollIds)
    }
  });
}

function isPanelPosition(value: unknown): value is { left: number; top: number } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { left?: unknown }).left === "number" &&
    typeof (value as { top?: unknown }).top === "number"
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
    return `${t("connectingRelay")}...`;
  }
  if (value === "Entrando na sala...") {
    return t("enteringRoom");
  }
  if (value === "Relay enviou uma mensagem invalida.") {
    return t("invalidRelayMessage");
  }
  if (value === "Informe a chave do relay ou use um relay proprio/local.") {
    return t("missingRelayKey");
  }
  if (value === "Este relay exige uma chave de acesso.") {
    return t("missingRelayKey");
  }
  if (value === "Sala cheia. O limite e de 20 jogadores.") {
    return t("roomFull");
  }
  if (value === "O narrador saiu e a sala foi desfeita.") {
    return t("roomClosed");
  }
  if (value === "Esta sala ja tem um narrador conectado.") {
    return t("roomHostExists");
  }

  const closedMatch = value.match(/^Conexao com (.+) encerrada\. Tentando reconectar\.\.\.$/);
  if (closedMatch) {
    return `Connection to ${closedMatch[1]} closed. Trying to reconnect...`;
  }

  const failedMatch = value.match(/^Nao foi possivel conectar em (.+)\. Verifique se o relay esta rodando com npm run dev:server\.$/);
  if (failedMatch) {
    return `Could not connect to ${failedMatch[1]}. Check that the relay is running with npm run dev:server.`;
  }

  return value;
}

function renderDiagnostic(): string {
  const relay = currentConfig?.serverUrl ?? defaultRelayUrl;

  if (connectionState.status === "connected") {
    return `
      <strong>${escapeHtml(t("activeConnection"))}</strong>
      ${escapeHtml(t("relay"))}: <code>${escapeHtml(relay)}</code><br />
      ${escapeHtml(t("playersInRoom"))}: <code>${connectionState.players.length}</code>
    `;
  }

  if (connectionState.status === "connecting") {
    return `
      <strong>${escapeHtml(t("connectingRelay"))}</strong>
      ${escapeHtml(t("tryingRelay"))} <code>${escapeHtml(relay)}</code>.
    `;
  }

  if (connectionState.status === "error") {
    return `
      <strong>${escapeHtml(t("localConnection"))}</strong>
      ${escapeHtml(t("localConnectionHint"))}<br />
      ${escapeHtml(t("relayUnavailable"))}: ${escapeHtml(translateConnectionDetail(connectionState.detail))}<br />
      ${escapeHtml(t("runServer"))} <code>npm run host:relay</code>. ${escapeHtml(t("reconnectHint"))}
    `;
  }

  return `
    <strong>${escapeHtml(t("localConnection"))}</strong>
    ${escapeHtml(t("localConnectionHint"))}<br />
    ${escapeHtml(t("disconnectedDiagnostic"))} <code>${escapeHtml(relay)}</code>.
  `;
}

function createLiveLayer(): { host: HTMLDivElement; stack: HTMLDivElement } {
  const host = document.createElement("div");
  host.id = "demiplane-dice-room-live";

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        top: 92px;
        right: 16px;
        z-index: 2147483647;
        width: min(380px, calc(100vw - 32px));
        color-scheme: dark;
        pointer-events: none;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      .stack {
        display: grid;
        gap: 8px;
      }

      .toast {
        border: 1px solid rgba(103, 153, 255, 0.32);
        border-radius: 8px;
        padding: 12px;
        color: #f6f8fc;
        background: rgba(16, 20, 27, 0.94);
        box-shadow: 0 14px 42px rgba(0, 0, 0, 0.42);
        backdrop-filter: blur(14px);
        animation: roll-in 160ms ease-out, roll-out 360ms ease-in ${liveToastMs - 360}ms forwards;
      }

      .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #aeb8c7;
        font-size: 12px;
        font-weight: 800;
      }

      .body {
        margin-top: 5px;
        color: #f7f8fb;
        font-size: 14px;
        font-weight: 850;
        line-height: 1.28;
        overflow-wrap: anywhere;
      }

      .success {
        display: inline-flex;
        align-items: center;
        margin-top: 8px;
        border: 1px solid rgba(190, 202, 220, 0.18);
        border-radius: 999px;
        padding: 4px 8px;
        color: #e5ebf5;
        background: rgba(255, 255, 255, 0.055);
        font-size: 12px;
        font-weight: 850;
      }

      .dice-row {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }

      .die {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 24px;
        border: 1px solid rgba(190, 202, 220, 0.16);
        border-radius: 6px;
        padding: 3px 6px;
        color: #e7ecf5;
        background: rgba(255, 255, 255, 0.045);
        font-size: 11px;
        font-weight: 850;
        line-height: 1;
      }

      .die-gem {
        width: 10px;
        height: 10px;
        flex: 0 0 auto;
        border: 1px solid currentColor;
        transform: rotate(45deg);
      }

      .die-regular {
        color: #d5dce8;
        border-color: rgba(165, 177, 194, 0.34);
        background: rgba(17, 20, 25, 0.76);
      }

      .die-regular .die-gem {
        background: #1b2028;
      }

      .die-hunger {
        color: #ffd8dc;
        border-color: rgba(218, 55, 70, 0.46);
        background: rgba(61, 16, 22, 0.72);
      }

      .die-hunger .die-gem {
        background: #b91828;
      }

      .die-critical {
        box-shadow: 0 0 0 1px rgba(242, 215, 126, 0.18) inset;
      }

      .die-skull {
        color: #ffd0d5;
      }

      .outcome {
        margin-top: 7px;
        color: #f5d27a;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }

      @keyframes roll-in {
        from {
          opacity: 0;
          transform: translateY(-8px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes roll-out {
        to {
          opacity: 0;
          transform: translateY(-8px) scale(0.98);
        }
      }
    </style>
    <div data-stack class="stack" aria-live="polite"></div>
  `;

  const stack = shadow.querySelector("[data-stack]");
  if (!(stack instanceof HTMLDivElement)) {
    throw new Error("Camada de rolagens ao vivo nao foi inicializada corretamente.");
  }

  return { host, stack };
}

type DiceAnimationLayer = {
  host: HTMLDivElement;
  stage: HTMLDivElement;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  activeDice: Set<AnimatedDie>;
  d10Model: D10Model;
  desiredResultNormal: THREE.Vector3;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  batchCompletionCallbacks: Map<number, () => void>;
  drag?: DiceDragState;
  animationFrame: number;
  lastFrame: number;
};

type D10Model = {
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry;
  faceAnchors: FaceAnchor[];
  vertices: THREE.Vector3[];
};

type FaceAnchor = {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  horizontal: THREE.Vector3;
  vertical: THREE.Vector3;
  labelCorners: Array<{ x: number; y: number }>;
};

type AnimatedDie = {
  group: THREE.Group;
  value: number;
  kind: DiceValue["kind"];
  face: DiceFace;
  radius: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angularVelocity: THREE.Vector3;
  rollEnergy: number;
  rollEnergyLoss: number;
  nextToppleAt: number;
  birth: number;
  batchId: number;
  settled: boolean;
  stableSince: number;
  settleAnchor?: FaceAnchor;
  supportAnchor?: FaceAnchor;
  resultRevealed: boolean;
  revealStart: number;
  resultLabel?: THREE.Mesh;
  resultAnchor?: FaceAnchor;
  fadeStarted: boolean;
  fadeStart: number;
  dragging: boolean;
};

type DiceDragState = {
  die: AnimatedDie;
  pointerId: number;
  planeZ: number;
  offsetX: number;
  offsetY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
};

const resultLabelBaseOffset = 0.055;
const resultLabelRevealLift = 0.055;
const resultLabelCanvasWidth = 384;
const resultLabelCanvasHeight = 256;
const ankhIconImage = createAssetImage("assets/ankh.png");
const skullIconImage = createAssetImage("assets/skull.png");
const fangedAnkhIconImage = createAssetImage("assets/ankh-fangs.png");

function createDiceAnimationLayer(): DiceAnimationLayer {
  const host = document.createElement("div");
  host.id = "demiplane-dice-room-animation";

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483600;
        pointer-events: none;
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      .stage {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
    </style>
    <div data-stage class="stage" aria-hidden="true"></div>
  `;

  const stage = shadow.querySelector("[data-stage]");
  if (!(stage instanceof HTMLDivElement)) {
    throw new Error("Camada de animacao dos dados nao foi inicializada corretamente.");
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2200);
  camera.position.set(0, -245, 760);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.append(renderer.domElement);

  const hemiLight = new THREE.HemisphereLight(0xd6d9df, 0x151018, 1.6);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(-210, -260, 520);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -560;
  keyLight.shadow.camera.right = 560;
  keyLight.shadow.camera.top = 420;
  keyLight.shadow.camera.bottom = -420;
  keyLight.shadow.normalBias = 0.025;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xb30d1d, 1.3);
  rimLight.position.set(360, 180, 260);
  scene.add(rimLight);

  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1200),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.56 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.z = 0;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  const d10Model = createD10Geometry();
  const layer: DiceAnimationLayer = {
    host,
    stage,
    scene,
    camera,
    renderer,
    activeDice: new Set<AnimatedDie>(),
    d10Model,
    desiredResultNormal: new THREE.Vector3(0, 0, 1),
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    batchCompletionCallbacks: new Map<number, () => void>(),
    animationFrame: 0,
    lastFrame: performance.now()
  };

  resizeDiceAnimationLayer(layer);
  window.addEventListener("resize", () => {
    resizeDiceAnimationLayer(layer);
  });
  bindDiceDragEvents(layer);

  return layer;
}

function playDiceAnimation(roll: RollEvent, onComplete?: () => void): boolean {
  if (!shouldAnimateDice() || !diceAnimationLayer || roll.dice.length === 0) {
    return false;
  }

  const layer = diceAnimationLayer;
  const dice = roll.dice.slice(0, maxAnimatedDice);
  const batchId = (diceAnimationBatchSequence += 1);
  if (onComplete) {
    let fallbackTimer = 0;
    let completed = false;
    const complete = () => {
      if (completed) {
        return;
      }
      completed = true;
      window.clearTimeout(fallbackTimer);
      layer.batchCompletionCallbacks.delete(batchId);
      onComplete();
    };
    fallbackTimer = window.setTimeout(() => {
      complete();
    }, diceHardSettleMs + diceAnimationMs + diceFadeMs + 2500);
    layer.batchCompletionCallbacks.set(batchId, complete);
  }
  const animatedDice = dice.map((die, index) => createAnimatedDie(die, index, dice.length, batchId, layer));
  for (const die of animatedDice) {
    layer.activeDice.add(die);
    layer.scene.add(die.group);
  }
  playDiceRollSound(animatedDice.length);
  ensureDiceAnimationLoop();
  return true;
}

function ensureDiceAnimationLoop(): void {
  if (!diceAnimationLayer || diceAnimationLayer.animationFrame) {
    return;
  }

  diceAnimationLayer.lastFrame = performance.now();
  diceAnimationLayer.animationFrame = requestAnimationFrame(tickDiceAnimation);
}

function tickDiceAnimation(now: number): void {
  if (!diceAnimationLayer) {
    return;
  }

  const dt = Math.min(0.034, Math.max(0.001, (now - diceAnimationLayer.lastFrame) / 1000));
  diceAnimationLayer.lastFrame = now;
  updateAnimatedDice(diceAnimationLayer, now, dt);
  diceAnimationLayer.renderer.render(diceAnimationLayer.scene, diceAnimationLayer.camera);

  if (diceAnimationLayer.activeDice.size > 0) {
    diceAnimationLayer.animationFrame = requestAnimationFrame(tickDiceAnimation);
    return;
  }

  diceAnimationLayer.animationFrame = 0;
}

function createAnimatedDie(die: DiceValue, index: number, total: number, batchId: number, layer: DiceAnimationLayer): AnimatedDie {
  const radius = getAnimatedDieRadius(total);
  const group = createDieMesh(die, radius, layer);
  const bounds = getWorldBounds();
  const angle = (Math.PI * 2 * index) / Math.max(1, total) + (Math.random() - 0.5) * 0.9;
  const launchRadius = 16 + Math.random() * 76;
  const spread = 90 + Math.random() * 190;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = bounds.top + (bounds.bottom - bounds.top) * 0.34;
  const groundZ = getGroundZ(radius);
  const startX = clampNumber(centerX + Math.cos(angle) * launchRadius, bounds.left + radius, bounds.right - radius);
  const startY = clampNumber(centerY + Math.sin(angle) * launchRadius, bounds.top + radius, bounds.bottom - radius);
  const startZ = groundZ + 120 + Math.random() * 110;

  group.position.set(startX, startY, startZ);
  group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

  return {
    group,
    value: die.value,
    kind: die.kind,
    face: getDieFace(die),
    x: startX,
    y: startY,
    z: startZ,
    vx: Math.cos(angle) * spread + (Math.random() - 0.5) * 90,
    vy: Math.sin(angle) * spread + (Math.random() - 0.5) * 90,
    vz: -430 - Math.random() * 260,
    angularVelocity: createBiasedInitialAngularVelocity(),
    rollEnergy: 1.8 + Math.random() * 3.8,
    rollEnergyLoss: 0.82 + Math.random() * 0.48,
    nextToppleAt: 0,
    radius,
    birth: performance.now(),
    batchId,
    settled: false,
    stableSince: 0,
    supportAnchor: undefined,
    resultRevealed: false,
    revealStart: 0,
    fadeStarted: false,
    fadeStart: 0,
    dragging: false
  };
}

function createDieMesh(die: DiceValue, radius: number, layer: DiceAnimationLayer): THREE.Group {
  const group = new THREE.Group();
  group.scale.setScalar(radius);

  const palette = getDiePalette(die.kind);
  const material = new THREE.MeshStandardMaterial({
    color: palette.body,
    emissive: palette.emissive,
    emissiveIntensity: palette.emissiveIntensity,
    roughness: 0.48,
    metalness: 0.16,
    flatShading: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(layer.d10Model.geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0.64
  });
  const edges = new THREE.LineSegments(layer.d10Model.edgeGeometry, edgeMaterial);
  edges.scale.setScalar(1.006);
  group.add(edges);

  return group;
}

function applyDieAngularVelocity(die: AnimatedDie, dt: number): void {
  const spin = die.angularVelocity.length();
  if (spin < 0.0001) {
    return;
  }

  const rotation = new THREE.Quaternion().setFromAxisAngle(die.angularVelocity.clone().normalize(), spin * dt);
  die.group.quaternion.premultiply(rotation).normalize();
}

function updateAnimatedDice(layer: DiceAnimationLayer, now: number, dt: number): void {
  const bounds = getWorldBounds();

  for (const die of [...layer.activeDice]) {
    if (!die.settled) {
      die.vz -= 2250 * dt;
      die.z += die.vz * dt;
      die.x += die.vx * dt;
      die.y += die.vy * dt;
      applyDieAngularVelocity(die, dt);
      const groundZ = getDieGroundZ(die, layer);

      if (die.x < bounds.left + die.radius) {
        die.x = bounds.left + die.radius;
        die.vx = Math.abs(die.vx) * 0.5;
        die.angularVelocity.z *= -0.58;
        playDiceImpactSound(0.08);
      }

      if (die.x > bounds.right - die.radius) {
        die.x = bounds.right - die.radius;
        die.vx = -Math.abs(die.vx) * 0.5;
        die.angularVelocity.z *= -0.58;
        playDiceImpactSound(0.08);
      }

      if (die.y < bounds.top + die.radius) {
        die.y = bounds.top + die.radius;
        die.vy = Math.abs(die.vy) * 0.5;
        die.angularVelocity.x *= -0.58;
      }

      if (die.y > bounds.bottom - die.radius) {
        die.y = bounds.bottom - die.radius;
        die.vy = -Math.abs(die.vy) * 0.5;
        die.angularVelocity.x *= -0.58;
      }

      if (die.z <= groundZ) {
        die.z = groundZ;
        if (Math.abs(die.vz) > 120) {
          playDiceImpactSound(clampNumber(Math.abs(die.vz) / 2300, 0.06, 0.24));
        }
        die.vz = Math.abs(die.vz) * 0.18;
        die.vx *= 0.78;
        die.vy *= 0.78;
        die.angularVelocity.multiplyScalar(0.86);
      }

      applyGroundRollingVelocity(die, groundZ, dt);
      applyGroundSpinTranslation(die, groundZ, dt);
      const stableOnGround = stabilizeDieOnGround(die, layer, now, dt);
      const isGrounded = die.z <= groundZ + 1;
      if (isGrounded) {
        dampenGroundPivotSpin(die, layer, dt);
      }
      const planeDrag = isGrounded ? Math.pow(stableOnGround ? 0.28 : 0.62, dt) : Math.pow(0.58, dt);
      die.vx *= planeDrag;
      die.vy *= planeDrag;
      die.angularVelocity.multiplyScalar(Math.pow(isGrounded ? stableOnGround ? 0.58 : 0.9 : 0.72, dt));

      if (die.z <= groundZ + 1 && (Math.abs(die.vz) < 90 || now - die.birth > diceHardSettleMs)) {
        beginSettleAnimatedDie(die, layer, now);
      }
    }

    if (die.resultLabel) {
      renderDieResultReveal(die, now);
    }

    die.group.position.set(die.x, die.y, die.z);

    const resultAge = die.resultRevealed ? now - die.revealStart : 0;
    if (die.resultRevealed && !die.fadeStarted && resultAge > diceAnimationMs - diceFadeLeadMs) {
      fadeAnimatedDie(die, now);
    }

    if (die.fadeStarted) {
      renderDieFade(die, now);
    }

    if (die.resultRevealed && resultAge > diceAnimationMs) {
      const batchId = die.batchId;
      layer.scene.remove(die.group);
      disposeAnimatedDie(die.group, layer.d10Model);
      layer.activeDice.delete(die);
      completeDiceBatchIfDone(layer, batchId);
    }
  }

  resolveDieCollisions(layer);
  revealReadyDiceBatches(layer, now);
  for (const die of layer.activeDice) {
    die.group.position.set(die.x, die.y, die.z);
  }
}

function completeDiceBatchIfDone(layer: DiceAnimationLayer, batchId: number): void {
  if ([...layer.activeDice].some((die) => die.batchId === batchId)) {
    return;
  }

  const complete = layer.batchCompletionCallbacks.get(batchId);
  if (!complete) {
    return;
  }

  complete();
}

function createD10Geometry(): D10Model {
  const primalVertices: THREE.Vector3[] = [];
  const primalFaces: number[][] = [];
  const ringRadius = 1;
  const ringHeight = 0.78;

  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 5;
    primalVertices.push(new THREE.Vector3(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, ringHeight));
  }

  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + Math.PI / 5 + (Math.PI * 2 * index) / 5;
    primalVertices.push(new THREE.Vector3(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, -ringHeight));
  }

  primalFaces.push([0, 1, 2, 3, 4], [9, 8, 7, 6, 5]);
  for (let index = 0; index < 5; index += 1) {
    const next = (index + 1) % 5;
    primalFaces.push([index, index + 5, next]);
    primalFaces.push([next, index + 5, next + 5]);
  }

  const dualVertices = primalFaces.map((face) => createDualVertex(face, primalVertices));
  const dualFaces: THREE.Vector3[][] = [];
  for (let vertexIndex = 0; vertexIndex < primalVertices.length; vertexIndex += 1) {
    const adjacentFaces = primalFaces
      .map((face, faceIndex) => ({ face, faceIndex }))
      .filter(({ face }) => face.includes(vertexIndex))
      .map(({ faceIndex }) => faceIndex);
    const center = adjacentFaces
      .reduce((sum, faceIndex) => sum.add(dualVertices[faceIndex]), new THREE.Vector3())
      .multiplyScalar(1 / adjacentFaces.length);
    const normal = primalVertices[vertexIndex].clone().normalize();
    const basisX = new THREE.Vector3(0, 0, 1).cross(normal);
    if (basisX.lengthSq() < 0.001) {
      basisX.set(1, 0, 0);
    } else {
      basisX.normalize();
    }
    const basisY = new THREE.Vector3().crossVectors(normal, basisX).normalize();
    const orderedFaces = adjacentFaces.sort((first, second) => {
      const firstDelta = dualVertices[first].clone().sub(center);
      const secondDelta = dualVertices[second].clone().sub(center);
      return Math.atan2(firstDelta.dot(basisY), firstDelta.dot(basisX)) -
        Math.atan2(secondDelta.dot(basisY), secondDelta.dot(basisX));
    });
    const points = orderedFaces.map((faceIndex) => dualVertices[faceIndex].clone());
    if (getFaceNormal(points).dot(center) < 0) {
      points.reverse();
    }
    dualFaces.push(points);
  }

  const maxLength = Math.max(...dualFaces.flat().map((point) => point.length()));
  for (const face of dualFaces) {
    for (const point of face) {
      point.multiplyScalar(1.18 / maxLength);
    }
  }

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const edgeVertices: number[] = [];
  const faceAnchors: FaceAnchor[] = [];

  for (const face of dualFaces) {
    const base = vertices.length / 3;
    const normal = getFaceNormal(face);
    const center = face.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(0.25);
    vertices.push(...face.flatMap((point) => [point.x, point.y, point.z]));
    for (let vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {
      normals.push(normal.x, normal.y, normal.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);

    for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex += 1) {
      const start = face[edgeIndex];
      const end = face[(edgeIndex + 1) % face.length];
      edgeVertices.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }

    const vertical = getFaceMiddleToPoleAxis(face, center, normal);
    const horizontal = new THREE.Vector3().crossVectors(vertical, normal).normalize();
    const labelCorners = face.map((point) => {
      const delta = point.clone().sub(center);
      return {
        x: delta.dot(horizontal),
        y: delta.dot(vertical)
      };
    });
    faceAnchors.push({
      center,
      normal,
      horizontal,
      vertical,
      labelCorners
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);

  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgeVertices, 3));

  return { geometry, edgeGeometry, faceAnchors, vertices: dualFaces.flat().map((point) => point.clone()) };
}

function createDualVertex(face: number[], vertices: THREE.Vector3[]): THREE.Vector3 {
  const points = face.map((index) => vertices[index]);
  const normal = getFaceNormal(points);
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  if (normal.dot(center) < 0) {
    normal.multiplyScalar(-1);
  }
  const distance = normal.dot(points[0]);
  return normal.multiplyScalar(1 / distance);
}

function getFaceNormal(points: THREE.Vector3[]): THREE.Vector3 {
  const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  return normal.dot(center) < 0 ? normal.multiplyScalar(-1) : normal;
}

function getFaceMiddleToPoleAxis(face: THREE.Vector3[], center: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 {
  const topSign = center.z >= 0 ? 1 : -1;
  let pole = face[0];
  let poleScore = pole.z * topSign;
  for (let index = 1; index < face.length; index += 1) {
    const score = face[index].z * topSign;
    if (score > poleScore) {
      pole = face[index];
      poleScore = score;
    }
  }

  const axis = pole.clone().sub(center).projectOnPlane(normal);
  if (axis.lengthSq() < 0.001) {
    axis.copy(face[0]).sub(face[2]).projectOnPlane(normal);
  }
  return axis.normalize();
}

function createFaceLabel({
  value,
  kind,
  color,
  glow,
  anchor
}: {
  value: number;
  kind: DiceValue["kind"];
  color: string;
  glow: string;
  anchor: FaceAnchor;
}): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = resultLabelCanvasWidth;
  canvas.height = resultLabelCanvasHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Nao foi possivel criar textura dos dados.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.shadowColor = glow;
  context.shadowBlur = 12;
  context.strokeStyle = "rgba(0, 0, 0, 0.72)";
  context.lineWidth = 8;
  context.fillStyle = color;
  if (kind === "hunger") {
    drawHungerDieResult(context, value, color, glow);
  } else {
    drawRegularDieResult(context, value, color, glow);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return new THREE.Mesh(
    createFaceLabelGeometry(anchor),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    })
  );
}

function createFaceLabelGeometry(anchor: FaceAnchor): THREE.BufferGeometry {
  const xs = anchor.labelCorners.map((corner) => corner.x);
  const ys = anchor.labelCorners.map((corner) => corner.y);
  const usableWidth = Math.max(0.001, (Math.max(...xs) - Math.min(...xs)) * 0.9);
  const usableHeight = Math.max(0.001, (Math.max(...ys) - Math.min(...ys)) * 0.9);
  const aspectRatio = resultLabelCanvasWidth / resultLabelCanvasHeight;
  let height = Math.min(0.72, usableHeight);
  let width = height * aspectRatio;

  if (width > usableWidth) {
    width = usableWidth;
    height = width / aspectRatio;
  }

  return new THREE.PlaneGeometry(width, height);
}

function createAssetImage(path: string): HTMLImageElement {
  const image = new Image();
  image.decoding = "async";
  image.src = chrome.runtime.getURL(path);
  return image;
}

function drawRegularDieResult(
  context: CanvasRenderingContext2D,
  value: number,
  color: string,
  glow: string
): void {
  if (value < 6) {
    return;
  }

  drawAnkhResult(context, color, glow, value === 10);
}

function drawHungerDieResult(
  context: CanvasRenderingContext2D,
  value: number,
  color: string,
  glow: string
): void {
  if (value === 1) {
    drawIconResult(context, skullIconImage, color, glow, {
      maxWidth: 220,
      maxHeight: 220,
      fallback: () => drawSkullGlyphFallback(context, color)
    });
    return;
  }

  if (value >= 2 && value <= 5) {
    return;
  }

  if (value >= 6 && value <= 9) {
    drawAnkhResult(context, color, glow, false);
    return;
  }

  if (value === 10) {
    drawIconResult(context, fangedAnkhIconImage, color, glow, {
      maxWidth: 238,
      maxHeight: 238,
      fallback: () => drawAnkhGlyphFallback(context, color)
    });
  }
}

function drawAnkhResult(
  context: CanvasRenderingContext2D,
  color: string,
  glow: string,
  critical: boolean
): void {
  drawIconResult(context, ankhIconImage, color, glow, {
    maxWidth: 238,
    maxHeight: 230,
    fallback: () => drawAnkhGlyphFallback(context, color)
  });

  if (critical) {
    drawCriticalAnkhStars(context, color, glow);
  }
}

function drawIconResult(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  color: string,
  glow: string,
  options: {
    maxWidth: number;
    maxHeight: number;
    fallback: () => void;
  }
): void {
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    options.fallback();
    return;
  }

  const scale = Math.min(options.maxWidth / image.naturalWidth, options.maxHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (context.canvas.width - width) / 2;
  const y = (context.canvas.height - height) / 2;

  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
    drawTintedImage(context, image, x + dx, y + dy, width, height, "rgba(0, 0, 0, 0.72)");
  }

  context.save();
  context.shadowColor = glow;
  context.shadowBlur = 10;
  drawTintedImage(context, image, x, y, width, height, color);
  context.restore();
}

function drawTintedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
): void {
  const buffer = document.createElement("canvas");
  buffer.width = context.canvas.width;
  buffer.height = context.canvas.height;
  const bufferContext = buffer.getContext("2d");
  if (!bufferContext) {
    return;
  }

  bufferContext.drawImage(image, x, y, width, height);
  const imageData = bufferContext.getImageData(0, 0, buffer.width, buffer.height);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    const darkness = 1 - (pixels[index] + pixels[index + 1] + pixels[index + 2]) / (255 * 3);
    pixels[index + 3] = Math.round(255 * alpha * clampNumber(darkness * 1.35, 0, 1));
  }
  bufferContext.putImageData(imageData, 0, 0);
  bufferContext.globalCompositeOperation = "source-in";
  bufferContext.fillStyle = color;
  bufferContext.fillRect(0, 0, buffer.width, buffer.height);
  context.drawImage(buffer, 0, 0);
}

function drawAnkhGlyphFallback(context: CanvasRenderingContext2D, color: string): void {
  context.font = "900 230px Georgia, serif";
  context.strokeText("\u2625", resultLabelCanvasWidth / 2, resultLabelCanvasHeight / 2 + 8);
  context.fillStyle = color;
  context.fillText("\u2625", resultLabelCanvasWidth / 2, resultLabelCanvasHeight / 2 + 8);
}

function drawSkullGlyphFallback(context: CanvasRenderingContext2D, color: string): void {
  context.font = "900 178px Georgia, serif";
  context.strokeText("\u2620", resultLabelCanvasWidth / 2, resultLabelCanvasHeight / 2 + 3);
  context.fillStyle = color;
  context.fillText("\u2620", resultLabelCanvasWidth / 2, resultLabelCanvasHeight / 2 + 3);
}

function drawCriticalAnkhStars(
  context: CanvasRenderingContext2D,
  color: string,
  glow: string
): void {
  context.save();
  context.shadowColor = glow;
  context.shadowBlur = 8;
  context.font = "900 152px Georgia, serif";
  context.strokeStyle = "rgba(0, 0, 0, 0.72)";
  context.lineWidth = 9;
  context.fillStyle = color;
  for (const x of [102, 282]) {
    context.strokeText("*", x, 168);
    context.fillText("*", x, 168);
  }
  context.restore();
}

function revealDieResult(die: AnimatedDie, layer: DiceAnimationLayer, now: number): void {
  if (die.resultRevealed) {
    return;
  }

  const anchor = die.settleAnchor ?? getVisibleResultAnchor(die, layer);
  const palette = getDiePalette(die.kind);
  const label = createFaceLabel({
    value: die.value,
    kind: die.kind,
    color: palette.ink,
    glow: palette.inkGlow,
    anchor
  });

  label.renderOrder = 8;
  label.position.copy(anchor.center).addScaledVector(anchor.normal, resultLabelBaseOffset);
  alignObjectToFace(label, anchor);
  setObjectOpacity(label, 0);

  die.group.add(label);
  die.resultAnchor = anchor;
  die.resultLabel = label;
  die.revealStart = now;
  die.resultRevealed = true;
}

function alignObjectToFace(object: THREE.Object3D, anchor: FaceAnchor): void {
  const matrix = new THREE.Matrix4().makeBasis(anchor.horizontal, anchor.vertical, anchor.normal);
  object.quaternion.setFromRotationMatrix(matrix);
}

function getVisibleResultAnchor(die: AnimatedDie, layer: DiceAnimationLayer): FaceAnchor {
  let bestAnchor = layer.d10Model.faceAnchors[0];
  let bestScore = -Infinity;
  const targetNormal = getDieSettleNormal(die, layer);
  const cameraDirection = getDieCameraDirection(die, layer);

  for (const anchor of layer.d10Model.faceAnchors) {
    const score = getFaceRevealScore(die, anchor, targetNormal, cameraDirection);
    if (score > bestScore) {
      bestScore = score;
      bestAnchor = anchor;
    }
  }

  return bestAnchor;
}

function getFaceAnchorScore(die: AnimatedDie, anchor: FaceAnchor, targetNormal: THREE.Vector3): number {
  return anchor.normal.clone().applyQuaternion(die.group.quaternion).normalize().dot(targetNormal);
}

function getFaceRevealScore(
  die: AnimatedDie,
  anchor: FaceAnchor,
  targetNormal: THREE.Vector3,
  cameraDirection: THREE.Vector3
): number {
  const normal = anchor.normal.clone().applyQuaternion(die.group.quaternion).normalize();
  const topScore = normal.dot(targetNormal);
  const cameraScore = normal.dot(cameraDirection);
  return topScore + Math.max(0, cameraScore) * 0.22;
}

function getDieCameraDirection(die: AnimatedDie, layer: DiceAnimationLayer): THREE.Vector3 {
  return layer.camera.position.clone().sub(die.group.position).normalize();
}

function stabilizeDieOnGround(die: AnimatedDie, layer: DiceAnimationLayer, now: number, dt: number): boolean {
  const groundZ = getDieGroundZ(die, layer);
  if (die.dragging || die.z > groundZ + 2) {
    return false;
  }

  drainGroundRollEnergy(die, dt);
  const supportNormal = getDieSupportNormal();
  die.supportAnchor = getSupportAnchor(die, layer);
  die.settleAnchor = getVisibleResultAnchor(die, layer);
  const anchor = die.supportAnchor;
  const anchorScore = getFaceAnchorScore(die, anchor, supportNormal);
  if (anchorScore > diceRestFaceScore) {
    if (die.rollEnergy >= getToppleEnergyCost(die, anchorScore)) {
      die.stableSince = 0;
      maybeSpendEnergyForTopple(die, layer, anchorScore, now);
      return false;
    }
    if (!die.stableSince) {
      die.stableSince = now;
    }
    return true;
  }
  die.stableSince = 0;
  if (!maybeSpendEnergyForTopple(die, layer, anchorScore, now) && canDieCollapseOntoFace(die, anchorScore, now)) {
    collapseDieOntoSupportFace(die, layer, dt, false);
  }
  return false;
}

function drainGroundRollEnergy(die: AnimatedDie, dt: number): void {
  if (die.rollEnergy <= 0) {
    return;
  }

  const speed = Math.hypot(die.vx, die.vy);
  const spin = die.angularVelocity.length();
  const distanceCost = speed / Math.max(70, die.radius * 1.55);
  const spinCost = Math.max(0, spin - 0.9) * 0.11;
  die.rollEnergy = Math.max(0, die.rollEnergy - (distanceCost * 0.46 + spinCost) * dt * die.rollEnergyLoss);
}

function maybeSpendEnergyForTopple(
  die: AnimatedDie,
  layer: DiceAnimationLayer,
  anchorScore: number,
  now: number
): boolean {
  const cost = getToppleEnergyCost(die, anchorScore);
  if (die.rollEnergy < cost || now < die.nextToppleAt || getDieMotion(die) > 150) {
    return false;
  }

  const rollAxis = getEnergyToppleAxis(die, layer);
  if (!rollAxis) {
    return false;
  }

  die.rollEnergy = Math.max(0, die.rollEnergy - cost);
  die.nextToppleAt = now + 115 + Math.random() * 95;
  die.stableSince = 0;

  const impulse = clampNumber(diceToppleImpulse * (0.78 + Math.random() * 0.36), 4.4, 7.4);
  die.angularVelocity.addScaledVector(rollAxis, impulse);
  const travelImpulse = clampNumber(die.radius * (0.18 + Math.random() * 0.26), 7, 24);
  die.vx += -rollAxis.y * travelImpulse;
  die.vy += rollAxis.x * travelImpulse;
  return true;
}

function getToppleEnergyCost(die: AnimatedDie, anchorScore: number): number {
  const instabilityDiscount = clampNumber((stableFaceScore - anchorScore) / 0.48, 0, 0.42);
  return diceToppleEnergyCost * die.rollEnergyLoss * (1 - instabilityDiscount);
}

function canDieCollapseOntoFace(die: AnimatedDie, anchorScore: number, now: number): boolean {
  const spentEnergy = die.rollEnergy < getToppleEnergyCost(die, anchorScore);
  return spentEnergy && (getDieMotion(die) < diceSpentEnergySettleMotion || now - die.birth > diceVisualSettleMs);
}

function getEnergyToppleAxis(die: AnimatedDie, layer: DiceAnimationLayer): THREE.Vector3 | undefined {
  const speed = Math.hypot(die.vx, die.vy);
  if (speed > 20) {
    return biasDieRollAxis(new THREE.Vector3(die.vy, -die.vx, 0));
  }

  const angularAxis = new THREE.Vector3(die.angularVelocity.x, die.angularVelocity.y, 0);
  if (angularAxis.lengthSq() > 0.09) {
    return biasDieRollAxis(angularAxis);
  }

  const pivot = getLowestDieVertex(die, layer);
  const pivotAxis = new THREE.Vector3(pivot.y, -pivot.x, 0);
  if (pivotAxis.lengthSq() < 0.0001) {
    return undefined;
  }
  return biasDieRollAxis(pivotAxis);
}

function createBiasedInitialAngularVelocity(): THREE.Vector3 {
  return new THREE.Vector3(
    randomSigned(7.8, 12.8),
    randomSigned(0.08, 0.42),
    randomSigned(1.4, 3.4)
  );
}

function biasDieRollAxis(axis: THREE.Vector3): THREE.Vector3 | undefined {
  axis.x *= diceRollAxisXBias;
  axis.y *= diceRollAxisYBias;
  axis.z *= 0.28;
  if (axis.lengthSq() < 0.0001) {
    return undefined;
  }
  return axis.normalize();
}

function getLowestDieVertex(die: AnimatedDie, layer: DiceAnimationLayer): THREE.Vector3 {
  let lowest = layer.d10Model.vertices[0].clone().applyQuaternion(die.group.quaternion);
  for (let index = 1; index < layer.d10Model.vertices.length; index += 1) {
    const vertex = layer.d10Model.vertices[index].clone().applyQuaternion(die.group.quaternion);
    if (vertex.z < lowest.z) {
      lowest = vertex;
    }
  }
  return lowest;
}

function applyGroundRollingVelocity(die: AnimatedDie, groundZ: number, dt: number): void {
  if (die.dragging || die.z > groundZ + 1 || die.rollEnergy < diceToppleEnergyCost * 0.35) {
    return;
  }

  const speed = Math.hypot(die.vx, die.vy);
  if (speed < 8) {
    return;
  }

  const rollAxis = biasDieRollAxis(new THREE.Vector3(die.vy, -die.vx, 0));
  if (!rollAxis) {
    return;
  }

  const targetSpin = clampNumber(speed / Math.max(18, die.radius * 0.72), 0, 5.4);
  const currentSpin = die.angularVelocity.dot(rollAxis);
  if (currentSpin >= targetSpin) {
    return;
  }

  const blend = clampNumber(dt * 5, 0, 0.14);
  const spinDelta = (targetSpin - currentSpin) * blend;
  die.angularVelocity.addScaledVector(rollAxis, spinDelta);
  die.rollEnergy = Math.max(0, die.rollEnergy - Math.abs(spinDelta) * 0.018);
}

function applyGroundSpinTranslation(die: AnimatedDie, groundZ: number, dt: number): void {
  if (die.dragging || die.z > groundZ + 1) {
    return;
  }

  const rollSpin = new THREE.Vector3(die.angularVelocity.x, die.angularVelocity.y, 0);
  const spin = rollSpin.length();
  die.angularVelocity.z *= Math.pow(0.025, dt);
  if (spin < 0.35) {
    return;
  }

  if (die.rollEnergy < diceToppleEnergyCost * 0.25) {
    die.angularVelocity.x *= Math.pow(0.08, dt);
    die.angularVelocity.y *= Math.pow(0.08, dt);
    return;
  }

  const rollAxis = rollSpin.normalize();
  if (rollAxis.lengthSq() < 0.0001) {
    return;
  }

  const travelSpeed = clampNumber(spin * die.radius * diceGroundRollSpeedFactor, 0, 360);
  const targetVx = -rollAxis.y * travelSpeed;
  const targetVy = rollAxis.x * travelSpeed;
  const previousSpeed = Math.hypot(die.vx, die.vy);
  const blend = clampNumber(dt * 12.5, 0, 0.42);
  die.vx += (targetVx - die.vx) * blend;
  die.vy += (targetVy - die.vy) * blend;
  die.x += targetVx * dt * 0.72;
  die.y += targetVy * dt * 0.72;

  const angularTravel = spin * dt;
  const skidding = previousSpeed < travelSpeed * 0.55 ? 2.6 : 1.1;
  const spinLoss = Math.pow(diceSpinTurnLoss, (angularTravel * skidding) / (Math.PI * 2));
  die.angularVelocity.x *= spinLoss;
  die.angularVelocity.y *= spinLoss * Math.pow(diceLongAxisSpinDamping, dt);
  die.rollEnergy = Math.max(0, die.rollEnergy - angularTravel * 0.18 * skidding * die.rollEnergyLoss);
}

function dampenGroundPivotSpin(die: AnimatedDie, layer: DiceAnimationLayer, dt: number): void {
  if (die.dragging) {
    return;
  }

  const anchor = die.supportAnchor ?? getSupportAnchor(die, layer);
  const supportNormal = anchor.normal.clone().applyQuaternion(die.group.quaternion).normalize();
  const pivotSpin = die.angularVelocity.dot(supportNormal);
  if (Math.abs(pivotSpin) < 0.001) {
    return;
  }

  const keptSpin = pivotSpin * Math.pow(diceSupportPivotSpinDamping, dt);
  die.angularVelocity.addScaledVector(supportNormal, keptSpin - pivotSpin);
}

function getDieMotion(die: AnimatedDie): number {
  return Math.hypot(die.vx, die.vy) + Math.abs(die.vz) * 0.2 + die.angularVelocity.length() * 24;
}

function getSupportAnchor(die: AnimatedDie, layer: DiceAnimationLayer): FaceAnchor {
  let bestAnchor = layer.d10Model.faceAnchors[0];
  let bestScore = -Infinity;
  const targetNormal = getDieSupportNormal();

  for (const anchor of layer.d10Model.faceAnchors) {
    const score = getFaceAnchorScore(die, anchor, targetNormal);
    if (score > bestScore) {
      bestScore = score;
      bestAnchor = anchor;
    }
  }

  return bestAnchor;
}

function collapseDieOntoSupportFace(
  die: AnimatedDie,
  layer: DiceAnimationLayer,
  dt: number,
  hard: boolean
): boolean {
  if (die.dragging) {
    return false;
  }

  const anchor = die.supportAnchor ?? getSupportAnchor(die, layer);
  const supportNormal = getDieSupportNormal();
  const currentNormal = anchor.normal.clone().applyQuaternion(die.group.quaternion).normalize();
  const anchorScore = currentNormal.dot(supportNormal);
  if (anchorScore > diceRestFaceScore) {
    return true;
  }

  const delta = new THREE.Quaternion().setFromUnitVectors(currentNormal, supportNormal);
  const targetQuaternion = die.group.quaternion.clone().premultiply(delta).normalize();
  const collapseAmount = clampNumber(dt * (hard ? diceHardFaceCollapseSpeed : diceFaceCollapseSpeed), 0, hard ? 0.85 : 0.42);
  die.group.quaternion.slerp(targetQuaternion, collapseAmount).normalize();
  die.z = getDieGroundZ(die, layer);
  die.vx *= Math.pow(0.16, dt);
  die.vy *= Math.pow(0.16, dt);
  die.vz = 0;
  die.angularVelocity.multiplyScalar(Math.pow(0.08, dt));
  die.supportAnchor = anchor;
  die.settleAnchor = getVisibleResultAnchor(die, layer);
  return getFaceAnchorScore(die, anchor, supportNormal) > diceRestFaceScore;
}

function isDieFaceStable(die: AnimatedDie, layer: DiceAnimationLayer): boolean {
  const anchor = die.supportAnchor ?? getSupportAnchor(die, layer);
  const normal = anchor.normal.clone().applyQuaternion(die.group.quaternion).normalize();
  const anchorScore = normal.dot(getDieSupportNormal());
  return anchorScore > diceRestFaceScore;
}

function getDieSettleNormal(die: AnimatedDie, layer: DiceAnimationLayer): THREE.Vector3 {
  return layer.desiredResultNormal.clone();
}

function getDieSupportNormal(): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1);
}

function renderDieResultReveal(die: AnimatedDie, now: number): void {
  if (!die.resultLabel || !die.resultAnchor) {
    return;
  }

  const progress = clampNumber((now - die.revealStart) / resultLabelRevealMs, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  const labelScale = 0.74 + eased * 0.26;
  die.resultLabel.position
    .copy(die.resultAnchor.center)
    .addScaledVector(die.resultAnchor.normal, resultLabelBaseOffset + eased * resultLabelRevealLift);
  die.resultLabel.scale.setScalar(labelScale);
  setObjectOpacity(die.resultLabel, eased);
}

function setObjectOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child: THREE.Object3D) => {
    const material = (child as { material?: THREE.Material | THREE.Material[] }).material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of materials) {
      item.transparent = true;
      item.opacity = opacity;
    }
  });
}

function beginSettleAnimatedDie(die: AnimatedDie, layer: DiceAnimationLayer, now: number): void {
  if (die.settled) {
    return;
  }

  const age = now - die.birth;
  const motion = getDieMotion(die);
  const spentEnergy = die.rollEnergy < getToppleEnergyCost(die, stableFaceScore);
  const visuallySpent = age > diceVisualSettleMs && spentEnergy && motion < diceSpentEnergySettleMotion;
  const hardSettle = age > diceHardSettleMs;

  if (!isDieFaceStable(die, layer)) {
    if (hardSettle || visuallySpent) {
      collapseDieOntoSupportFace(die, layer, 1 / 60, hardSettle);
    }
    die.stableSince = 0;
    return;
  }
  die.settleAnchor = getVisibleResultAnchor(die, layer);

  const settleMotion = spentEnergy ?
    diceSpentEnergySettleMotion :
    diceSettleMotion;
  if (!hardSettle && motion > settleMotion) {
    return;
  }
  if ((hardSettle || visuallySpent) && (!die.stableSince || now - die.stableSince < diceStableHoldMs)) {
    die.stableSince = now - diceStableHoldMs;
  }
  if (!die.stableSince || now - die.stableSince < diceStableHoldMs) {
    return;
  }

  die.settled = true;
  die.z = Math.max(die.z, getDieGroundZ(die, layer));
  die.vx = 0;
  die.vy = 0;
  die.vz = 0;
  die.rollEnergy = 0;
  die.angularVelocity.set(0, 0, 0);
  playDiceImpactSound(0.045);
}

function revealReadyDiceBatches(layer: DiceAnimationLayer, now: number): void {
  const batches = new Map<number, AnimatedDie[]>();
  for (const die of layer.activeDice) {
    if (die.fadeStarted || die.resultRevealed) {
      continue;
    }
    const dice = batches.get(die.batchId) ?? [];
    dice.push(die);
    batches.set(die.batchId, dice);
  }

  for (const dice of batches.values()) {
    if (dice.length === 0 || dice.some((die) => !die.settled)) {
      continue;
    }
    for (const die of dice) {
      revealDieResult(die, layer, now);
    }
    scheduleDiceBatchCompletionAfterReveal(layer, dice[0].batchId);
  }
}

function scheduleDiceBatchCompletionAfterReveal(layer: DiceAnimationLayer, batchId: number): void {
  const complete = layer.batchCompletionCallbacks.get(batchId);
  if (!complete) {
    return;
  }

  window.setTimeout(() => {
    const stillPending = layer.batchCompletionCallbacks.get(batchId);
    if (stillPending) {
      stillPending();
    }
  }, resultLabelRevealMs + 80);
}

function fadeAnimatedDie(die: AnimatedDie, now: number): void {
  die.fadeStarted = true;
  die.fadeStart = now;
  die.group.traverse((child: THREE.Object3D) => {
    const material = (child as { material?: THREE.Material | THREE.Material[] }).material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of materials) {
      item.transparent = true;
    }
  });
}

function renderDieFade(die: AnimatedDie, now: number): void {
  const progress = clampNumber((now - die.fadeStart) / diceFadeMs, 0, 1);
  const opacity = Math.pow(1 - progress, 2.4);
  die.group.traverse((child: THREE.Object3D) => {
    const material = (child as { material?: THREE.Material | THREE.Material[] }).material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of materials) {
      item.opacity = opacity;
    }
  });
}

function disposeAnimatedDie(group: THREE.Group, d10Model: D10Model): void {
  const sharedGeometries = new Set<THREE.BufferGeometry>([
    d10Model.geometry,
    d10Model.edgeGeometry
  ]);

  group.traverse((child: THREE.Object3D) => {
    const geometry = (child as { geometry?: THREE.BufferGeometry }).geometry;
    if (geometry && !sharedGeometries.has(geometry)) {
      geometry.dispose();
    }

    const material = (child as { material?: THREE.Material | THREE.Material[] }).material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of materials) {
      const map = (item as THREE.Material & { map?: THREE.Texture }).map;
      if (map) {
        map.dispose();
      }
      item.dispose();
    }
  });
}

function getWorldBounds(): { left: number; right: number; top: number; bottom: number } {
  const aspect = Math.max(0.8, window.innerWidth / Math.max(1, window.innerHeight));
  const height = 480;
  const width = height * aspect;

  return {
    left: -width / 2 + 44,
    right: width / 2 - 44,
    top: -height / 2 + 28,
    bottom: height / 2 - 96
  };
}

function resizeDiceAnimationLayer(layer: DiceAnimationLayer): void {
  const width = Math.max(1, layer.stage.clientWidth || window.innerWidth);
  const height = Math.max(1, layer.stage.clientHeight || window.innerHeight);
  const worldHeight = diceCameraWorldHeight;
  const worldWidth = worldHeight * (width / height);
  layer.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  layer.renderer.setSize(width, height, false);
  layer.camera.left = -worldWidth / 2;
  layer.camera.right = worldWidth / 2;
  layer.camera.top = worldHeight / 2;
  layer.camera.bottom = -worldHeight / 2;
  layer.camera.updateProjectionMatrix();
}

function bindDiceDragEvents(layer: DiceAnimationLayer): void {
  window.addEventListener("pointerdown", (event) => {
    const die = getPointerDie(layer, event);
    if (!die) {
      return;
    }

    const point = getPointerWorldPoint(layer, event, die.z);
    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    die.dragging = true;
    die.stableSince = 0;
    die.vx = 0;
    die.vy = 0;
    die.vz = 0;
    die.angularVelocity.set(0, 0, 0);
    layer.drag = {
      die,
      pointerId: event.pointerId,
      planeZ: die.z,
      offsetX: die.x - point.x,
      offsetY: die.y - point.y,
      lastX: die.x,
      lastY: die.y,
      lastTime: performance.now()
    };
    ensureDiceAnimationLoop();
  }, true);

  window.addEventListener("pointermove", (event) => {
    if (!layer.drag || layer.drag.pointerId !== event.pointerId) {
      return;
    }

    const drag = layer.drag;
    const point = getPointerWorldPoint(layer, event, drag.planeZ);
    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const die = drag.die;
    const resultLocked = isDieResultLockedForDrag(die);
    const bounds = getWorldBounds();
    const now = performance.now();
    const nextX = clampNumber(point.x + drag.offsetX, bounds.left + die.radius, bounds.right - die.radius);
    const nextY = clampNumber(point.y + drag.offsetY, bounds.top + die.radius, bounds.bottom - die.radius);
    const elapsed = Math.max(0.016, (now - drag.lastTime) / 1000);
    die.x = nextX;
    die.y = nextY;
    die.z = drag.planeZ;
    die.vx = resultLocked ? 0 : clampNumber((nextX - drag.lastX) / elapsed, -900, 900);
    die.vy = resultLocked ? 0 : clampNumber((nextY - drag.lastY) / elapsed, -900, 900);
    die.vz = 0;
    die.rollEnergy = resultLocked ? 0 : die.rollEnergy;
    die.angularVelocity.set(0, 0, 0);
    die.group.position.set(die.x, die.y, die.z);
    drag.lastX = nextX;
    drag.lastY = nextY;
    drag.lastTime = now;
    resolveDieCollisions(layer);
    for (const activeDie of layer.activeDice) {
      activeDie.group.position.set(activeDie.x, activeDie.y, activeDie.z);
    }
  }, true);

  window.addEventListener("pointerup", (event) => {
    finishDiceDrag(layer, event);
  }, true);
  window.addEventListener("pointercancel", (event) => {
    finishDiceDrag(layer, event);
  }, true);
}

function finishDiceDrag(layer: DiceAnimationLayer, event: PointerEvent): void {
  if (!layer.drag || layer.drag.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const die = layer.drag.die;
  const resultLocked = isDieResultLockedForDrag(die);
  const dragSpeed = Math.hypot(die.vx, die.vy);
  die.dragging = false;
  die.stableSince = resultLocked ? performance.now() : 0;
  if (resultLocked) {
    die.vx = 0;
    die.vy = 0;
    die.vz = 0;
    die.rollEnergy = 0;
    die.angularVelocity.set(0, 0, 0);
  } else {
    die.rollEnergy = Math.max(die.rollEnergy, clampNumber(dragSpeed / 160, 0.8, 4.4));
    die.nextToppleAt = performance.now() + 90;
    die.vx *= 0.18;
    die.vy *= 0.18;
  }
  layer.drag = undefined;
}

function isDieResultLockedForDrag(die: AnimatedDie): boolean {
  return die.settled || die.resultRevealed;
}

function getPointerDie(layer: DiceAnimationLayer, event: PointerEvent): AnimatedDie | undefined {
  const dice = [...layer.activeDice].filter((die) => !die.fadeStarted);
  if (dice.length === 0) {
    return undefined;
  }

  setRaycasterFromPointer(layer, event);
  const intersections = layer.raycaster.intersectObjects(dice.map((die) => die.group), true);
  for (const hit of intersections) {
    const die = dice.find((candidate) => isObjectInsideGroup(hit.object, candidate.group));
    if (die) {
      return die;
    }
  }

  return undefined;
}

function getPointerWorldPoint(layer: DiceAnimationLayer, event: PointerEvent, z: number): THREE.Vector3 | undefined {
  setRaycasterFromPointer(layer, event);
  const point = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  return layer.raycaster.ray.intersectPlane(plane, point) ?? undefined;
}

function setRaycasterFromPointer(layer: DiceAnimationLayer, event: PointerEvent): void {
  const rect = layer.stage.getBoundingClientRect();
  layer.pointer.set(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
  );
  layer.raycaster.setFromCamera(layer.pointer, layer.camera);
}

function isObjectInsideGroup(object: THREE.Object3D, group: THREE.Group): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === group) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function resolveDieCollisions(layer: DiceAnimationLayer): void {
  const dice = [...layer.activeDice].filter((die) => !die.fadeStarted);

  for (let i = 0; i < dice.length; i += 1) {
    for (let j = i + 1; j < dice.length; j += 1) {
      const first = dice[i];
      const second = dice[j];
      if (Math.abs(first.z - second.z) > Math.max(first.radius, second.radius) * 2.45) {
        continue;
      }

      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy) || 1;
      const minDistance = (first.radius + second.radius) * 1.06;

      if (distance >= minDistance) {
        continue;
      }

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      const firstMobility = first.dragging ? 0 : first.settled ? 0.22 : 1;
      const secondMobility = second.dragging ? 0 : second.settled ? 0.22 : 1;
      const mobility = firstMobility + secondMobility;
      if (mobility <= 0) {
        continue;
      }
      const firstShift = (overlap * firstMobility) / mobility;
      const secondShift = (overlap * secondMobility) / mobility;
      first.x -= nx * firstShift;
      first.y -= ny * firstShift;
      second.x += nx * secondShift;
      second.y += ny * secondShift;

      const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      if (relativeVelocity < 0) {
        const impulse = -(1.42 * relativeVelocity) / mobility;
        if (!first.settled) {
          first.vx -= impulse * nx * firstMobility;
          first.vy -= impulse * ny * firstMobility;
          first.angularVelocity.z += impulse * 0.022;
          first.supportAnchor = undefined;
          first.stableSince = 0;
        }
        if (!second.settled) {
          second.vx += impulse * nx * secondMobility;
          second.vy += impulse * ny * secondMobility;
          second.angularVelocity.z -= impulse * 0.022;
          second.supportAnchor = undefined;
          second.stableSince = 0;
        }
        if (Math.abs(relativeVelocity) > 120) {
          playDiceImpactSound(clampNumber(Math.abs(relativeVelocity) / 3000, 0.04, 0.13));
        }
      }
    }
  }
}

function getAnimatedDieRadius(total: number): number {
  const crowding = Math.max(0, total - 10) * 0.45;
  return clampNumber((42 - crowding) * diceAnimationScale, 18, 54);
}

function getGroundZ(radius: number): number {
  return radius * 0.82;
}

function getDieGroundZ(die: AnimatedDie, layer: DiceAnimationLayer): number {
  let lowest = Infinity;
  for (const vertex of layer.d10Model.vertices) {
    lowest = Math.min(lowest, vertex.clone().applyQuaternion(die.group.quaternion).z);
  }
  return -lowest * die.radius;
}

function getDiePalette(kind: DiceValue["kind"]): {
  body: number;
  emissive: number;
  emissiveIntensity: number;
  edge: number;
  ink: string;
  inkGlow: string;
} {
  if (kind === "hunger") {
    return {
      body: 0x970b17,
      emissive: 0x230005,
      emissiveIntensity: 0.2,
      edge: 0x240004,
      ink: "#030305",
      inkGlow: "rgba(0, 0, 0, 0.55)"
    };
  }

  return {
    body: 0x040506,
    emissive: 0x080000,
    emissiveIntensity: 0.16,
    edge: 0x3d050b,
    ink: "#b20d1b",
    inkGlow: "rgba(178, 13, 27, 0.62)"
  };
}

function faceSymbolText(face: DiceFace): string {
  if (face === "skull") {
    return "\u2620";
  }
  if (face === "critical") {
    return "\u2625\u2726";
  }
  if (face === "success") {
    return "\u2625";
  }
  return "";
}

function randomSigned(min: number, max: number): number {
  const value = min + Math.random() * (max - min);
  return Math.random() > 0.5 ? value : -value;
}

function unlockDiceAudio(): void {
  const context = getAudioContext();
  void context?.resume();
}

function getAudioContext(): AudioContext | undefined {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextConstructor =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return undefined;
  }

  audioContext = new AudioContextConstructor();
  return audioContext;
}

function playDiceRollSound(diceCount: number): void {
  const context = getAudioContext();
  if (!context || !shouldAnimateDice()) {
    return;
  }

  void context.resume().catch(() => {});
  playDiceRattleSound(diceCount);
  const hits = Math.min(18, Math.max(6, diceCount * 3));
  for (let index = 0; index < hits; index += 1) {
    window.setTimeout(() => {
      playDiceImpactSound(0.02 + Math.random() * 0.045);
    }, 80 + Math.random() * 900);
  }
}

function playDiceRattleSound(diceCount: number): void {
  const context = getAudioContext();
  if (!context || context.state === "closed") {
    return;
  }

  const duration = clampNumber(0.28 + diceCount * 0.035, 0.3, 0.72);
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  let grain = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (index % Math.max(1, Math.floor(context.sampleRate / (180 + diceCount * 24))) === 0) {
      grain = Math.random() * 2 - 1;
    }
    const progress = index / data.length;
    const envelope = Math.sin(Math.PI * progress) * (1 - progress * 0.35);
    data[index] = (grain * 0.62 + (Math.random() * 2 - 1) * 0.38) * envelope;
  }

  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  highpass.type = "highpass";
  highpass.frequency.value = 260;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 2400 + Math.random() * 900;
  gain.gain.setValueAtTime(clampNumber(0.045 + diceCount * 0.006, 0.05, 0.12), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(context.destination);
  source.start();
  source.stop(context.currentTime + duration + 0.02);
}

function playDiceImpactSound(volume: number): void {
  const context = getAudioContext();
  if (!context || context.state === "closed" || !shouldAnimateDice()) {
    return;
  }

  const duration = 0.045 + Math.random() * 0.045;
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    const progress = index / data.length;
    const envelope = Math.pow(1 - progress, 2.2);
    data[index] = (Math.random() * 2 - 1) * envelope;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 750 + Math.random() * 1500;
  filter.Q.value = 5 + Math.random() * 6;
  thud.type = "triangle";
  thud.frequency.setValueAtTime(120 + Math.random() * 80, context.currentTime);
  thud.frequency.exponentialRampToValueAtTime(58, context.currentTime + duration);
  thudGain.gain.setValueAtTime(clampNumber(volume * 0.9, 0.01, 0.13), context.currentTime);
  thudGain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration * 1.25);
  gain.gain.setValueAtTime(clampNumber(volume, 0.015, 0.18), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  thud.connect(thudGain);
  thudGain.connect(context.destination);
  source.start();
  thud.start();
  source.stop(context.currentTime + duration + 0.01);
  thud.stop(context.currentTime + duration * 1.3);
}

function showLiveRoll(roll: RollEvent, delivery: string): void {
  if (!liveLayer || !isDisplayableRoll(roll)) {
    return;
  }

  const actorKey = roll.clientId || roll.characterName || roll.playerName;
  const existingToast = activeToastByActor.get(actorKey);
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("article");
  toast.className = "toast";
  toast.dataset.actorKey = actorKey;
  toast.innerHTML = `
    <div class="meta">
      <span>${escapeHtml(roll.characterName || roll.playerName)}</span>
      <span>${escapeHtml(deliveryLabel(delivery))}</span>
    </div>
    <div class="body">${escapeHtml(describeRoll(roll))}</div>
    ${typeof roll.successes === "number" ? `<span class="success">${escapeHtml(formatSuccesses(roll.successes))}</span>` : ""}
    ${renderDiceRow(roll.dice)}
    ${renderOutcome(roll)}
  `;

  activeToastByActor.set(actorKey, toast);
  liveLayer.stack.prepend(toast);

  while (liveLayer.stack.children.length > maxLiveToasts) {
    const child = liveLayer.stack.lastElementChild;
    if (child instanceof HTMLElement) {
      activeToastByActor.delete(child.dataset.actorKey ?? "");
      child.remove();
    }
  }

  setTimeout(() => {
    if (activeToastByActor.get(actorKey) === toast) {
      activeToastByActor.delete(actorKey);
    }
    toast.remove();
  }, liveToastMs);
}

function renderRoll(item: { roll: RollEvent; origin: "local" | "remote"; delivery: string }): string {
  const { roll } = item;
  const resultParts = [
    typeof roll.successes === "number" ? `<span class="chip">${escapeHtml(formatSuccesses(roll.successes))}</span>` : "",
    typeof roll.total === "number" ? `<span class="chip">${escapeHtml(t("total"))} ${roll.total}</span>` : "",
    roll.dice.length > 0 ? `<span class="chip">${escapeHtml(formatDiceSummary(roll.dice))}</span>` : ""
  ].filter(Boolean);

  return `
    <li class="roll">
      <div class="meta">
        <span class="player">${escapeHtml(roll.characterName || roll.playerName)}</span>
        <span class="badge">${escapeHtml(deliveryLabel(item.delivery))}</span>
      </div>
      <div class="roll-title">${escapeHtml(describeRoll(roll))}</div>
      ${resultParts.length > 0 ? `<div class="result">${resultParts.join("")}</div>` : ""}
      ${renderDiceRow(roll.dice)}
      ${renderOutcome(roll)}
    </li>
  `;
}

function renderDiceRow(dice: DiceValue[]): string {
  if (dice.length === 0) {
    return "";
  }

  return `<div class="dice-row" aria-label="${escapeHtml(t("diceDetails"))}">${dice.map(renderDie).join("")}</div>`;
}

function renderDie(die: DiceValue): string {
  const face = getDieFace(die);
  const kindClass = die.kind === "hunger" ? "die-hunger" : die.kind === "regular" ? "die-regular" : "die-unknown";
  const faceLabel = dieFaceLabel(face);
  const kindLabel = dieKindLabel(die.kind);
  return `
    <span class="die ${kindClass} die-${face}" aria-label="${escapeHtml(`${kindLabel}: ${faceLabel}`)}">
      <span class="die-gem" aria-hidden="true"></span>
      <span>${escapeHtml(faceSymbolText(face))}</span>
      <span>${escapeHtml(faceLabel)}</span>
    </span>
  `;
}

function formatDiceSummary(dice: DiceValue[]): string {
  const regular = dice.filter((die) => die.kind === "regular").length;
  const hunger = dice.filter((die) => die.kind === "hunger").length;
  const unknown = dice.length - regular - hunger;
  const parts = [
    regular > 0 ? `${regular} ${t("regularDie")}` : "",
    hunger > 0 ? `${hunger} ${t("hungerDie")}` : "",
    unknown > 0 ? `${unknown} ${t("unknownDie")}` : ""
  ].filter(Boolean);

  return `${dice.length}d10${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

function renderOutcome(roll: RollEvent): string {
  const outcome = getRollOutcome(roll);
  if (!outcome || outcome === "success" || outcome === "failure") {
    return "";
  }

  return `<div class="outcome">${escapeHtml(outcomeLabel(outcome))}</div>`;
}

type DisplayConnectionStatus = ConnectionState["status"] | "local";

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

function getDieFace(die: DiceValue): DiceFace {
  return die.face ?? getDieFaceFromValue(die.kind, die.value) ?? "blank";
}

function dieFaceLabel(face: DiceFace): string {
  if (face === "skull") {
    return t("skullFace");
  }
  if (face === "critical") {
    return t("criticalFace");
  }
  if (face === "success") {
    return t("successFace");
  }
  return t("blankFace");
}

function dieKindLabel(kind: DiceValue["kind"]): string {
  if (kind === "hunger") {
    return t("hungerDie");
  }
  if (kind === "regular") {
    return t("regularDie");
  }
  return t("unknownDie");
}

function getRollOutcome(roll: RollEvent): RollOutcome | undefined {
  if (typeof roll.successes !== "number") {
    return undefined;
  }

  const hungerOnes = roll.dice.filter(isHungerSkull).length;
  const tens = roll.dice.filter(isCriticalDie).length;
  const hungerTens = roll.dice.filter((die) => die.kind === "hunger" && isCriticalDie(die)).length;

  if (roll.successes <= 0) {
    return hungerOnes > 0 ? "bestialFailure" : "failure";
  }

  if (tens >= 2) {
    return hungerTens > 0 ? "messyCritical" : "criticalSuccess";
  }

  return "success";
}

function isHungerSkull(die: DiceValue): boolean {
  return die.face === "skull" || (die.kind === "hunger" && die.value === 1);
}

function isCriticalDie(die: DiceValue): boolean {
  return die.face === "critical" || die.value === 10;
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
  if (outcome === "success") {
    return t("outcomeSuccess");
  }
  return t("outcomeFailure");
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

    return `${formatSuccesses(roll.successes)}.${outcomeText}`;
  }

  if (typeof roll.total === "number") {
    return `${t("result")} ${roll.total}.`;
  }

  return t("resultCaptured");
}

function formatSuccesses(successes: number): string {
  return `${successes} ${successes === 1 ? t("success") : t("successes")}`;
}

function t<TKey extends keyof (typeof messages)["pt-BR"]>(
  key: TKey,
  ...args: (typeof messages)["pt-BR"][TKey] extends (...fnArgs: infer TArgs) => unknown ? TArgs : []
): string {
  const value = messages[uiLanguage][key];

  if (typeof value === "function") {
    return (value as (...fnArgs: unknown[]) => string)(...args);
  }

  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
