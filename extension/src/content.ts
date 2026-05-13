import type {
  BackgroundMessage,
  CapturedRoll,
  ConnectionState,
  DiceValue,
  RollEvent,
  StoredRoll
} from "./shared/protocol";
import { defaultConfig, type ExtensionConfig } from "./shared/storage";

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
const diceAnimationMs = 6800;
const maxAnimatedDice = 20;
const panelUiStorageKey = "diceRoomPanelUi";
const activeToastByActor = new Map<string, HTMLElement>();
let collapsed = true;
let settingsOpen = false;
let panelOpacity = 0.94;
let panelPosition: { left: number; top: number } | undefined;
let uiLanguage: UiLanguage = "pt-BR";
let scanTimer: number | undefined;
let captureArmedUntil = 0;
let armedBaselineSignatures = new Set<string>();
let captureScanTimers: number[] = [];

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
type DiceFace = "blank" | "success" | "critical" | "skull";
type RollOutcome = "bestialFailure" | "messyCritical" | "criticalSuccess" | "success" | "failure";

const messages = {
  "pt-BR": {
    historyCount: (count: number) => `${count} ${count === 1 ? "rolagem" : "rolagens"}`,
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
    waiting: "Aguardando rolagens",
    opacity: "Opacidade",
    language: "Idioma",
    showOwnRolls: "Mostrar minhas rolagens",
    showOwnRollsHint: "Normalmente o Demiplane ja mostra sua rolagem. Deixe desligado para ver so as rolagens da sala; interpretacoes especiais ainda aparecem.",
    enableDiceAnimation: "Animacao dos dados",
    enableDiceAnimationHint: "Mostra os dados caindo e quicando na ficha, com som leve.",
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
    blankFace: "asterisco",
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
    runServer: "No terminal do projeto, rode",
    reconnectHint: "Depois aguarde a reconexao ou clique em Conectar no popup.",
    disconnectedDiagnostic: "Abra o popup da extensao e clique em Conectar. Relay configurado:"
  },
  en: {
    historyCount: (count: number) => `${count} ${count === 1 ? "roll" : "rolls"}`,
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
    waiting: "Waiting for rolls",
    opacity: "Opacity",
    language: "Language",
    showOwnRolls: "Show my own rolls",
    showOwnRollsHint: "Demiplane already shows your roll by default. Leave this off to see only room rolls; special interpretations still appear.",
    enableDiceAnimation: "Dice animation",
    enableDiceAnimationHint: "Shows dice falling and bouncing on the sheet, with light sound.",
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
    blankFace: "asterisk",
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
    runServer: "In the project terminal, run",
    reconnectHint: "Then wait for reconnection or click Connect in the popup.",
    disconnectedDiagnostic: "Open the extension popup and click Connect. Configured relay:"
  }
} as const;

let panel: ReturnType<typeof createPanel> | undefined;
let liveLayer: ReturnType<typeof createLiveLayer> | undefined;
let diceAnimationLayer: ReturnType<typeof createDiceAnimationLayer> | undefined;
let audioContext: AudioContext | undefined;
const firstLoad = !window.__demiplaneDiceRoomLoaded;

if (firstLoad) {
  window.__demiplaneDiceRoomLoaded = true;
  void initializeContentScript();
}

async function initializeContentScript(): Promise<void> {
  await loadPanelUiState();
  liveLayer = createLiveLayer();
  diceAnimationLayer = createDiceAnimationLayer();
  panel = createPanel();
  document.documentElement.append(diceAnimationLayer.host);
  document.documentElement.append(liveLayer.host);
  document.documentElement.append(panel.host);
  renderPanel();
  startObserver();
  baselineCurrentRolls();
  window.setTimeout(baselineCurrentRolls, 900);
  window.setTimeout(baselineCurrentRolls, 2200);
  document.addEventListener("pointerdown", handlePotentialRollAction, true);
  document.addEventListener("pointerdown", unlockDiceAudio, { capture: true, once: true });

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
    if (areaName !== "local" || (!changes.showOwnRolls && !changes.enableDiceAnimation)) {
      return;
    }

    currentConfig = {
      ...(currentConfig ?? defaultConfig),
      showOwnRolls: changes.showOwnRolls ? changes.showOwnRolls.newValue === true : currentConfig?.showOwnRolls === true,
      enableDiceAnimation: changes.enableDiceAnimation
        ? changes.enableDiceAnimation.newValue !== false
        : currentConfig?.enableDiceAnimation !== false
    };
    renderPanel();
  });
}

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    if (isCaptureArmed() && mutations.some((mutation) => isRelevantMutation(mutation))) {
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

function handlePotentialRollAction(event: PointerEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }

  if (!findRollActionElement(event.target)) {
    return;
  }

  armCapture();
}

function findRollActionElement(target: Element): Element | undefined {
  let current: Element | null = target;
  let depth = 0;

  while (current && depth < 6 && current !== document.body) {
    const label = normalizeText(
      [current.textContent ?? "", current.getAttribute("aria-label") ?? "", current.getAttribute("title") ?? ""].join(" ")
    );
    const isButtonLike =
      current instanceof HTMLButtonElement ||
      current.getAttribute("role") === "button" ||
      current.tagName.toLowerCase() === "button";
    const isSmallRollLabel = label.length <= 40;

    if ((isButtonLike || isSmallRollLabel) && /\b(re-roll|reroll|roll)\b/i.test(label)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return undefined;
}

function armCapture(): void {
  baselineCurrentRolls();
  armedBaselineSignatures = new Set(collectRollCandidates().map(({ captured }) => captured.signature));
  captureArmedUntil = Date.now() + 6000;

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
  armedBaselineSignatures = new Set<string>();

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

function baselineCurrentRolls(): void {
  for (const { element, captured } of collectRollCandidates()) {
    elementSignatures.set(element, captured.signature);
    seenSignatures.set(captured.signature, Date.now());
  }
}

function scanPage(): void {
  if (!isCaptureArmed()) {
    return;
  }

  const candidates = collectRollCandidates();

  for (const { element, captured } of candidates) {
    const previousSignature = elementSignatures.get(element);

    if (previousSignature === captured.signature || armedBaselineSignatures.has(captured.signature)) {
      elementSignatures.set(element, captured.signature);
      continue;
    }

    elementSignatures.set(element, captured.signature);
    publishCapturedRoll(captured);
    disarmCapture();
    return;
  }
}

function publishCapturedRoll(captured: CapturedRoll): void {
  if (wasRecentlySeen(captured.signature)) {
    return;
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
  const signatures = new Set<string>();

  for (const element of smallestElements) {
    const captured = extractRoll(element);
    if (!captured || signatures.has(captured.signature)) {
      continue;
    }

    signatures.add(captured.signature);
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
  const rollTitle = parseRollTitle(rawText, lines);

  if (!rollTitle || successes === null) {
    return undefined;
  }

  const enriched = findRicherRollElement(element, rollTitle, successes);
  const sourceElement = enriched?.element ?? element;
  const sourceText = enriched?.rawText ?? rawText;
  const sourceLines = enriched?.lines ?? lines;
  const dice = parseDice(sourceElement, sourceLines);
  const signature = hashText([rollTitle, successes, diceKey(dice), normalizeRollTextForSignature(sourceText, sourceLines)].join("|"));

  return {
    rollTitle,
    successes,
    total,
    dice,
    rawText: sourceText,
    createdAt: new Date().toISOString(),
    signature
  };
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

    if (isSameSingleRollBlock(rawText, lines, rollTitle, successes)) {
      const dice = parseDice(current, lines);
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

function isSameSingleRollBlock(rawText: string, lines: string[], rollTitle: string, successes: number): boolean {
  if (rawText.length < 6 || rawText.length > 4000 || isControlBlock(rawText)) {
    return false;
  }

  const candidateTitle = parseRollTitle(rawText, lines);
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
  const rollTitle = parseRollTitle(text, lines);
  const hasTitle = rollTitle !== undefined;
  const successValues = getSuccessValues(text);
  const hasSuccessValue = successValues.length === 1;
  const uniqueTitles = getUniqueRollTitles(text);
  const hasSingleTitle = !rollTitle || !isAttributeSkillTitle(rollTitle) ? uniqueTitles.length <= 1 : uniqueTitles.length === 1;

  return hasHistoryClass && hasTitle && hasSuccessValue && hasSingleTitle;
}

function isOwnPanelElement(element: Element): boolean {
  return element.id === "demiplane-dice-room-panel" || Boolean(element.closest("#demiplane-dice-room-panel"));
}

function isControlBlock(text: string): boolean {
  return /(add dice to roll|dice pool|clear|regular\s+hunger)/i.test(text);
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

function parseRollTitle(text: string, lines: string[]): string | undefined {
  const lineTitle = lines.find((line) => isAttributeSkillTitle(line));
  if (lineTitle) {
    return lineTitle.replace(/\s+/g, " ").trim();
  }

  const customLine = lines.find((line) => /^custom$/i.test(line));
  if (customLine) {
    return "CUSTOM";
  }

  const match = text.match(/\b([A-Z][A-Z '-]{2,50})[ \t]*\+[ \t]*([A-Z][A-Z '-]{2,50})\b/);
  if (!match) {
    return undefined;
  }

  return `${match[1].trim()} + ${match[2].trim()}`;
}

function isAttributeSkillTitle(value: string): boolean {
  return /^[A-Z][A-Z '-]{2,50}[ \t]*\+[ \t]*[A-Z][A-Z '-]{2,50}$/.test(value.trim());
}

function isUsefulRollTitle(value: string): boolean {
  const title = value.trim();
  return isAttributeSkillTitle(title) || /^custom$/i.test(title);
}

function getUniqueRollTitles(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Z '-]{2,50}[ \t]*\+[ \t]*[A-Z][A-Z '-]{2,50}\b/g) ?? [];
  return [...new Set(matches.map((match) => match.replace(/\s+/g, " ").trim()))];
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

function parseDice(element: Element, lines: string[]): DiceValue[] {
  const detailValues = parseDetailDiceValues(lines);
  if (detailValues.length > 0) {
    const domKinds = inferDiceKindsFromDom(element, detailValues.length);
    return detailValues.map((value, index) => ({
      kind: domKinds[index] ?? "unknown",
      value,
      sides: 10
    }));
  }

  return parseDiceFromText(lines);
}

function parseDetailDiceValues(lines: string[]): number[] {
  const values: number[] = [];
  let readingDetails = false;

  for (const line of lines) {
    if (/^(details|detalhes)\b/i.test(line)) {
      readingDetails = true;
      const remainder = line.replace(/^(details|detalhes)\b[:\s-]*/i, "");
      values.push(...parseDiceNumbers(remainder));
      continue;
    }

    if (!readingDetails) {
      continue;
    }

    if (/(dice pool|add dice to roll|clear|successes|sucessos?|re-roll|reroll)/i.test(line)) {
      continue;
    }

    values.push(...parseDiceNumbers(line));

    if (values.length >= 80) {
      return values.slice(0, 80);
    }
  }

  return values;
}

function parseDiceNumbers(text: string): number[] {
  const matches = text.match(/\b(?:10|[1-9])\b/g) ?? [];
  return matches.map((match) => Number.parseInt(match, 10)).filter((value) => Number.isFinite(value));
}

function parseDiceFromText(lines: string[]): DiceValue[] {
  const dice: DiceValue[] = [];

  for (const line of lines) {
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
        sides: value <= 10 ? 10 : undefined
      });

      if (dice.length >= 80) {
        return dice;
      }
    }
  }

  return dice;
}

function inferDiceKindsFromDom(element: Element, expectedCount: number): DiceValue["kind"][] {
  if (expectedCount <= 0) {
    return [];
  }

  const markerElements = collectDieMarkerElements(element);
  return markerElements.slice(0, expectedCount).map((marker) => inferDieKindFromElement(marker));
}

function collectDieMarkerElements(root: Element): Element[] {
  const allElements = [root, ...Array.from(root.querySelectorAll("*"))];
  const markers: Element[] = [];

  for (const element of allElements) {
    if (!isLikelyDieMarkerElement(element)) {
      continue;
    }

    if (markers.some((marker) => marker.contains(element))) {
      continue;
    }

    markers.push(element);
  }

  return markers;
}

function isLikelyDieMarkerElement(element: Element): boolean {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  const context = getElementContext(element);
  const hasDiceContext = /(die|dice|dado|hunger|fome|regular|skull|ankh|blood|detail|result|icon)/i.test(context);
  const isMedia = tagName === "img" || tagName === "svg" || tagName === "path" || tagName === "use";

  if (!hasDiceContext && !isMedia) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const hasSmallVisibleBox = rect.width >= 4 && rect.height >= 4 && rect.width <= 52 && rect.height <= 52;
  return hasSmallVisibleBox || isMedia;
}

function inferDieKindFromElement(element: Element): DiceValue["kind"] {
  const context = getElementContext(element);

  if (/(hunger|fome|blood|skull|red|vermelh)/i.test(context)) {
    return "hunger";
  }

  if (/(regular|normal|black|preto|grey|gray)/i.test(context)) {
    return "regular";
  }

  const colorKind = inferKindFromComputedColors(element);
  return colorKind ?? "regular";
}

function getElementContext(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 4) {
    parts.push(
      current.tagName,
      current.getAttribute("class") ?? "",
      current.getAttribute("aria-label") ?? "",
      current.getAttribute("title") ?? "",
      current.getAttribute("alt") ?? "",
      current.getAttribute("src") ?? ""
    );
    current = current.parentElement;
    depth += 1;
  }

  return parts.join(" ");
}

function inferKindFromComputedColors(element: Element): DiceValue["kind"] | undefined {
  const colors = new Set<string>();
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 3) {
    const style = window.getComputedStyle(current);
    colors.add(style.color);
    colors.add(style.backgroundColor);
    colors.add(style.borderColor);
    colors.add(style.fill);
    colors.add(style.stroke);
    current = current.parentElement;
    depth += 1;
  }

  for (const color of colors) {
    const rgb = parseRgbColor(color);
    if (!rgb) {
      continue;
    }

    const [red, green, blue] = rgb;
    if (red > 120 && green < 95 && blue < 105 && red > green * 1.35 && red > blue * 1.35) {
      return "hunger";
    }
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
  return dice.map((die) => `${die.kind}:${die.value}`).join(",");
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

  if (delivery !== "history" && shouldShowRoll({ roll, origin, delivery })) {
    showLiveRoll(roll, delivery);
    playDiceAnimation(roll);
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
  renderPanel();
}

function getVisibleRolls(): Array<{ roll: RollEvent; origin: "local" | "remote"; delivery: string }> {
  return rolls.filter(shouldShowRoll);
}

function shouldShowRoll(item: { roll: RollEvent; origin: "local" | "remote"; delivery: string }): boolean {
  if (item.origin !== "local") {
    return true;
  }

  return shouldShowOwnRolls() || hasSpecialOutcome(item.roll);
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
  count: HTMLSpanElement;
  countLabel: HTMLSpanElement;
  list: HTMLOListElement;
  toggle: HTMLButtonElement;
  diagnostic: HTMLDivElement;
  panelRoot: HTMLElement;
  header: HTMLElement;
  settings: HTMLButtonElement;
  settingsPanel: HTMLDivElement;
  opacityInput: HTMLInputElement;
  languageSelect: HTMLSelectElement;
  showOwnRollsInput: HTMLInputElement;
  diceAnimationInput: HTMLInputElement;
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

      :host([data-collapsed="true"]) .panel {
        width: min(300px, calc(100vw - 32px));
      }

      * {
        box-sizing: border-box;
      }

      .panel {
        width: min(360px, calc(100vw - 32px));
        max-height: min(520px, calc(100vh - 32px));
        display: grid;
        grid-template-rows: auto 1fr;
        overflow: visible;
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
        border-top: 1px solid rgba(190, 202, 220, 0.14);
        padding: 10px 12px;
        color: #c9d2df;
        background: rgba(255, 255, 255, 0.025);
        font-size: 12px;
      }

      .settings-row {
        display: grid;
        gap: 6px;
      }

      .settings-row + .settings-row {
        margin-top: 10px;
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

      .settings-row input[type="checkbox"] {
        width: auto;
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
          <button data-settings-button class="icon-button" type="button" aria-label="Abrir configuracoes" data-tooltip="Abrir configuracoes">⚙</button>
          <button data-toggle class="toggle" type="button" aria-label="Abrir historico" data-tooltip="Abrir historico">^</button>
        </div>
      </header>
      <div data-diagnostic class="diagnostic"></div>
      <div data-settings-panel class="settings-panel">
        <div class="settings-row">
          <label>
            <span data-settings-opacity-label>Opacidade</span>
            <span data-opacity-value></span>
          </label>
          <input data-opacity type="range" min="0.45" max="1" step="0.05" />
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
      </div>
      <ol data-list class="list"></ol>
    </section>
  `;

  const panelRoot = shadow.querySelector(".panel");
  const header = shadow.querySelector(".header");
  const status = shadow.querySelector("[data-status]");
  const count = shadow.querySelector("[data-count]");
  const countLabel = shadow.querySelector("[data-count-label]");
  const list = shadow.querySelector("[data-list]");
  const toggle = shadow.querySelector("[data-toggle]");
  const diagnostic = shadow.querySelector("[data-diagnostic]");
  const settings = shadow.querySelector("[data-settings-button]");
  const settingsPanel = shadow.querySelector("[data-settings-panel]");
  const opacityInput = shadow.querySelector("[data-opacity]");
  const languageSelect = shadow.querySelector("[data-language]");
  const showOwnRollsInput = shadow.querySelector("[data-show-own-rolls]");
  const diceAnimationInput = shadow.querySelector("[data-dice-animation]");
  const opacityValue = shadow.querySelector("[data-opacity-value]");

  if (
    !(panelRoot instanceof HTMLElement) ||
    !(header instanceof HTMLElement) ||
    !(status instanceof HTMLButtonElement) ||
    !(count instanceof HTMLSpanElement) ||
    !(countLabel instanceof HTMLSpanElement) ||
    !(list instanceof HTMLOListElement) ||
    !(toggle instanceof HTMLButtonElement) ||
    !(diagnostic instanceof HTMLDivElement) ||
    !(settings instanceof HTMLButtonElement) ||
    !(settingsPanel instanceof HTMLDivElement) ||
    !(opacityInput instanceof HTMLInputElement) ||
    !(languageSelect instanceof HTMLSelectElement) ||
    !(showOwnRollsInput instanceof HTMLInputElement) ||
    !(diceAnimationInput instanceof HTMLInputElement) ||
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
    host.dataset.collapsed = String(collapsed);
    toggle.textContent = collapsed ? "^" : "v";
    toggle.setAttribute("aria-label", collapsed ? "Abrir historico" : "Recolher historico");
    void savePanelUiState();
  });

  settings.addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    renderPanel();
    void savePanelUiState();
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

  installPanelDrag(host, header);

  return {
    host,
    status,
    count,
    countLabel,
    list,
    toggle,
    diagnostic,
    panelRoot,
    header,
    settings,
    settingsPanel,
    opacityInput,
    languageSelect,
    showOwnRollsInput,
    diceAnimationInput
  };
}

function renderPanel(): void {
  if (!panel) {
    return;
  }

  const visibleRolls = getVisibleRolls();
  const displayStatus = getDisplayStatus(connectionState.status);
  panel.status.textContent = statusLabel(displayStatus);
  panel.status.className = `status status-${displayStatus}`;
  panel.status.title = t("openDiagnostic");
  panel.count.textContent = String(visibleRolls.length);
  panel.countLabel.textContent = t("historyCount", visibleRolls.length);
  panel.host.dataset.collapsed = String(collapsed);
  panel.host.dataset.diagnostic = String(diagnosticOpen);
  panel.host.dataset.settings = String(settingsOpen);
  panel.host.dataset.positioned = String(Boolean(panelPosition));
  panel.host.style.setProperty("--panel-opacity", String(panelOpacity));
  panel.opacityInput.value = String(panelOpacity);
  panel.languageSelect.value = uiLanguage;
  panel.showOwnRollsInput.checked = shouldShowOwnRolls();
  panel.diceAnimationInput.checked = shouldAnimateDice();
  panel.toggle.textContent = collapsed ? "^" : "v";
  panel.toggle.removeAttribute("title");
  panel.toggle.dataset.tooltip = collapsed ? t("openHistory") : t("closeHistory");
  panel.toggle.setAttribute("aria-label", collapsed ? t("openHistory") : t("closeHistory"));
  panel.settings.removeAttribute("title");
  panel.settings.dataset.tooltip = settingsOpen ? t("closeSettings") : t("openSettings");
  panel.settings.setAttribute("aria-label", settingsOpen ? t("closeSettings") : t("openSettings"));
  panel.diagnostic.innerHTML = renderDiagnostic();
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
  const stored = await chrome.storage.local.get({
    [panelUiStorageKey]: {
      collapsed: true,
      settingsOpen: false,
      opacity: 0.94,
      position: undefined,
      language: "pt-BR"
    }
  });

  const value = stored[panelUiStorageKey] as
    | {
        collapsed?: unknown;
        settingsOpen?: unknown;
        opacity?: unknown;
        position?: unknown;
        language?: unknown;
      }
    | undefined;

  collapsed = value?.collapsed !== false;
  settingsOpen = value?.settingsOpen === true;
  panelOpacity = typeof value?.opacity === "number" ? clampNumber(value.opacity, 0.45, 1) : 0.94;
  uiLanguage = value?.language === "en" ? "en" : "pt-BR";

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
      position: panelPosition,
      language: uiLanguage
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
  const relay = currentConfig?.serverUrl ?? "ws://localhost:8787";

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

function createDiceAnimationLayer(): { host: HTMLDivElement; stage: HTMLDivElement } {
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

      .anim-die {
        --die-shape: polygon(50% 0, 70% 9%, 92% 30%, 100% 50%, 82% 78%, 50% 100%, 18% 78%, 0 50%, 8% 30%, 30% 9%);
        --die-body: #08090c;
        --die-body-deep: #010203;
        --die-body-light: #1f242c;
        --die-ink: #b20d1b;
        --die-ink-glow: rgba(178, 13, 27, 0.36);
        --die-ridge: rgba(255, 255, 255, 0.2);
        --die-ridge-dark: rgba(0, 0, 0, 0.52);
        --die-glint: rgba(255, 255, 255, 0.2);
        position: absolute;
        left: 0;
        top: 0;
        isolation: isolate;
        width: var(--die-size, 54px);
        height: var(--die-size, 54px);
        color: var(--die-ink, #f2f5fb);
        transform-origin: center;
        transform-style: preserve-3d;
        will-change: transform, opacity;
        pointer-events: none;
        user-select: none;
        filter: drop-shadow(var(--table-shadow-x, 10px) var(--table-shadow-y, 18px) var(--table-shadow-blur, 18px) rgba(0, 0, 0, var(--table-shadow-alpha, 0.36)));
      }

      .anim-die::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        clip-path: var(--die-shape);
        background:
          radial-gradient(circle at 35% 18%, var(--die-glint), transparent 18%),
          linear-gradient(145deg, var(--die-body-light) 0 18%, transparent 38%),
          conic-gradient(
            from -18deg at 50% 50%,
            rgba(255, 255, 255, 0.18) 0deg 36deg,
            rgba(0, 0, 0, 0.12) 36deg 72deg,
            rgba(255, 255, 255, 0.08) 72deg 108deg,
            rgba(0, 0, 0, 0.28) 108deg 144deg,
            rgba(255, 255, 255, 0.1) 144deg 180deg,
            rgba(0, 0, 0, 0.2) 180deg 216deg,
            rgba(255, 255, 255, 0.07) 216deg 252deg,
            rgba(0, 0, 0, 0.3) 252deg 288deg,
            rgba(255, 255, 255, 0.14) 288deg 324deg,
            rgba(0, 0, 0, 0.18) 324deg 360deg
          ),
          linear-gradient(165deg, var(--die-body-light), var(--die-body) 48%, var(--die-body-deep));
        box-shadow:
          inset -16px -18px 24px rgba(0, 0, 0, 0.42),
          inset 10px 8px 18px rgba(255, 255, 255, 0.1);
      }

      .anim-die::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 1;
        clip-path: var(--die-shape);
        background:
          linear-gradient(90deg, transparent 49.2%, var(--die-ridge) 49.2% 50.8%, transparent 50.8%),
          linear-gradient(58deg, transparent 49.3%, var(--die-ridge) 49.3% 50.7%, transparent 50.7%),
          linear-gradient(122deg, transparent 49.3%, var(--die-ridge-dark) 49.3% 50.7%, transparent 50.7%),
          linear-gradient(28deg, transparent 49.4%, rgba(255, 255, 255, 0.12) 49.4% 50.6%, transparent 50.6%),
          linear-gradient(152deg, transparent 49.4%, rgba(0, 0, 0, 0.42) 49.4% 50.6%, transparent 50.6%);
        box-shadow:
          inset 0 0 0 2px rgba(0, 0, 0, 0.56),
          inset 0 0 0 3px rgba(255, 255, 255, 0.08);
        pointer-events: none;
      }

      .anim-hunger {
        --die-body: #970b17;
        --die-body-deep: #3a0207;
        --die-body-light: #c51a28;
        --die-ink: #050507;
        --die-ink-glow: rgba(0, 0, 0, 0.38);
        --die-ridge: rgba(255, 205, 210, 0.26);
        --die-ridge-dark: rgba(20, 0, 2, 0.55);
        --die-glint: rgba(255, 180, 185, 0.24);
      }

      .anim-regular {
        --die-body: #08090c;
        --die-body-deep: #010203;
        --die-body-light: #232832;
        --die-ink: #b20d1b;
        --die-ink-glow: rgba(178, 13, 27, 0.36);
        --die-ridge: rgba(255, 255, 255, 0.2);
        --die-ridge-dark: rgba(0, 0, 0, 0.55);
        --die-glint: rgba(255, 255, 255, 0.18);
      }

      .anim-face {
        position: absolute;
        inset: 19% 22% 20%;
        z-index: 2;
        display: grid;
        grid-template-rows: 1fr auto;
        place-items: center;
        color: var(--die-ink);
        font-weight: 950;
        line-height: 1;
        text-shadow:
          0 1px 0 rgba(255, 255, 255, 0.08),
          0 0 9px var(--die-ink-glow);
      }

      .anim-value {
        display: block;
        font-size: calc(var(--die-size, 54px) * 0.4);
        letter-spacing: 0;
        font-weight: 900;
      }

      .anim-symbol {
        display: block;
        margin-top: 1px;
        min-height: calc(var(--die-size, 54px) * 0.16);
        font-size: calc(var(--die-size, 54px) * 0.15);
        font-weight: 900;
        opacity: 0.9;
      }

      .anim-settled {
        pointer-events: auto;
        cursor: grab;
      }

      .anim-settled:active {
        cursor: grabbing;
      }

      .anim-fading {
        opacity: 0;
        transition: opacity 650ms ease;
      }
    </style>
    <div data-stage class="stage" aria-hidden="true"></div>
  `;

  const stage = shadow.querySelector("[data-stage]");
  if (!(stage instanceof HTMLDivElement)) {
    throw new Error("Camada de animacao dos dados nao foi inicializada corretamente.");
  }

  return { host, stage };
}

type AnimatedDie = {
  element: HTMLDivElement;
  value: number;
  kind: DiceValue["kind"];
  face: DiceFace;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  rotation: number;
  spin: number;
  size: number;
  radius: number;
  birth: number;
  settled: boolean;
  dragging: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
};

function playDiceAnimation(roll: RollEvent): void {
  if (!shouldAnimateDice() || !diceAnimationLayer || roll.dice.length === 0) {
    return;
  }

  const dice = roll.dice.slice(0, maxAnimatedDice);
  const animatedDice = dice.map((die, index) => createAnimatedDie(die, index, dice.length));
  diceAnimationLayer.stage.append(...animatedDice.map((die) => die.element));
  playDiceRollSound(animatedDice.length);

  let animationFrame = 0;
  let lastFrame = performance.now();

  const frame = (now: number) => {
    const dt = Math.min(0.034, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    updateAnimatedDice(animatedDice, now, dt);

    if (animatedDice.some((die) => die.element.isConnected)) {
      animationFrame = requestAnimationFrame(frame);
    }
  };

  animationFrame = requestAnimationFrame(frame);

  window.setTimeout(() => {
    for (const die of animatedDice) {
      die.element.classList.add("anim-fading");
    }
  }, Math.max(1200, diceAnimationMs - 700));

  window.setTimeout(() => {
    cancelAnimationFrame(animationFrame);
    for (const die of animatedDice) {
      die.element.remove();
    }
  }, diceAnimationMs);
}

function createAnimatedDie(die: DiceValue, index: number, total: number): AnimatedDie {
  const element = document.createElement("div");
  const kind = die.kind === "hunger" ? "hunger" : "regular";
  const face = getDieFace(die);
  const size = clampNumber(60 + Math.random() * 18 - Math.max(0, total - 10) * 0.9, 44, 78);
  const centerX = window.innerWidth * 0.48;
  const centerY = window.innerHeight * 0.44;
  const angle = (Math.PI * 2 * index) / Math.max(1, total) + (Math.random() - 0.5) * 0.9;
  const startRadius = 12 + Math.random() * 70;
  const spread = 110 + Math.random() * 230;
  const startX = clampNumber(centerX + Math.cos(angle) * startRadius - size / 2, 16, window.innerWidth - size - 16);
  const startY = clampNumber(centerY + Math.sin(angle) * startRadius - size / 2, 92, window.innerHeight - size - 120);

  element.className = `anim-die anim-${kind} anim-${face}`;
  element.style.setProperty("--die-size", `${size}px`);
  const symbol = faceSymbolMarkup(face);
  element.innerHTML = `
    <span class="anim-face">
      <span class="anim-value">${escapeHtml(String(die.value))}</span>
      <span class="anim-symbol">${symbol}</span>
    </span>
  `;

  const animatedDie: AnimatedDie = {
    element,
    value: die.value,
    kind: die.kind,
    face,
    x: startX,
    y: startY,
    vx: Math.cos(angle) * spread + (Math.random() - 0.5) * 90,
    vy: Math.sin(angle) * spread + (Math.random() - 0.5) * 90,
    z: 360 + Math.random() * 260,
    vz: -360 - Math.random() * 260,
    rotation: Math.random() * 360,
    spin: (Math.random() > 0.5 ? 1 : -1) * (560 + Math.random() * 820),
    size,
    radius: size * 0.46,
    birth: performance.now(),
    settled: false,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0
  };

  installDieDrag(animatedDie);
  renderAnimatedDie(animatedDie);
  return animatedDie;
}

function updateAnimatedDice(dice: AnimatedDie[], now: number, dt: number): void {
  const bounds = getAnimationBounds();

  for (const die of dice) {
    if (!die.element.isConnected || die.dragging) {
      continue;
    }

    if (!die.settled) {
      die.vz -= 1850 * dt;
      die.z += die.vz * dt;
      die.x += die.vx * dt;
      die.y += die.vy * dt;
      die.rotation += die.spin * dt;

      if (die.x < bounds.left) {
        die.x = bounds.left;
        die.vx = Math.abs(die.vx) * 0.68;
        die.spin *= -0.64;
        playDiceImpactSound(0.08);
      }

      if (die.x + die.size > bounds.right) {
        die.x = bounds.right - die.size;
        die.vx = -Math.abs(die.vx) * 0.68;
        die.spin *= -0.64;
        playDiceImpactSound(0.08);
      }

      if (die.y < bounds.top) {
        die.y = bounds.top;
        die.vy = Math.abs(die.vy) * 0.68;
        die.spin *= -0.64;
      }

      if (die.y + die.size > bounds.bottom) {
        die.y = bounds.bottom - die.size;
        die.vy = -Math.abs(die.vy) * 0.68;
        die.spin *= -0.64;
      }

      if (die.z <= 0) {
        die.z = 0;
        if (Math.abs(die.vz) > 120) {
          playDiceImpactSound(clampNumber(Math.abs(die.vz) / 2400, 0.07, 0.22));
        }
        die.vz = Math.abs(die.vz) * 0.36;
        die.vx *= 0.82;
        die.vy *= 0.82;
        die.spin *= 0.7;
      }

      const planeDrag = die.z <= 0.5 ? Math.pow(0.18, dt) : Math.pow(0.76, dt);
      die.vx *= planeDrag;
      die.vy *= planeDrag;
      die.spin *= Math.pow(die.z <= 0.5 ? 0.22 : 0.82, dt);

      if (
        now - die.birth > 2300 &&
        die.z <= 1 &&
        Math.abs(die.vz) < 80 &&
        Math.hypot(die.vx, die.vy) < 65 &&
        Math.abs(die.spin) < 120
      ) {
        settleAnimatedDie(die);
      }

      if (now - die.birth > 3900) {
        settleAnimatedDie(die);
      }
    }
  }

  resolveDieCollisions(dice);

  for (const die of dice) {
    clampAnimatedDieToViewport(die, bounds);
    renderAnimatedDie(die);
  }
}

function getAnimationBounds(): { left: number; right: number; top: number; bottom: number } {
  return {
    left: 12,
    right: window.innerWidth - 12,
    top: 84,
    bottom: window.innerHeight - 96
  };
}

function clampAnimatedDieToViewport(
  die: AnimatedDie,
  bounds: { left: number; right: number; top: number; bottom: number }
): void {
  die.x = clampNumber(die.x, bounds.left, Math.max(bounds.left, bounds.right - die.size));
  die.y = clampNumber(die.y, bounds.top, Math.max(bounds.top, bounds.bottom - die.size));
}

function resolveDieCollisions(dice: AnimatedDie[]): void {
  for (let i = 0; i < dice.length; i += 1) {
    for (let j = i + 1; j < dice.length; j += 1) {
      const first = dice[i];
      const second = dice[j];
      if ((first.settled && second.settled) || Math.abs(first.z - second.z) > 140) {
        continue;
      }

      const firstCenterX = first.x + first.size / 2;
      const firstCenterY = first.y + first.size / 2;
      const secondCenterX = second.x + second.size / 2;
      const secondCenterY = second.y + second.size / 2;
      const dx = secondCenterX - firstCenterX;
      const dy = secondCenterY - firstCenterY;
      const distance = Math.hypot(dx, dy) || 1;
      const minDistance = first.radius + second.radius;

      if (distance >= minDistance) {
        continue;
      }

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      const firstCanMove = !first.dragging && !first.settled;
      const secondCanMove = !second.dragging && !second.settled;
      const firstShare = firstCanMove && secondCanMove ? 0.5 : firstCanMove ? 1 : 0;
      const secondShare = firstCanMove && secondCanMove ? 0.5 : secondCanMove ? 1 : 0;

      first.x -= nx * overlap * firstShare;
      first.y -= ny * overlap * firstShare;
      second.x += nx * overlap * secondShare;
      second.y += ny * overlap * secondShare;

      const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      if (relativeVelocity < 0) {
        const impulse = -(1.15 * relativeVelocity) / 2;
        if (firstCanMove) {
          first.vx -= impulse * nx;
          first.vy -= impulse * ny;
          first.spin += impulse * 1.8;
        }
        if (secondCanMove) {
          second.vx += impulse * nx;
          second.vy += impulse * ny;
          second.spin -= impulse * 1.8;
        }
        if (Math.abs(relativeVelocity) > 120) {
          playDiceImpactSound(clampNumber(Math.abs(relativeVelocity) / 3200, 0.04, 0.12));
        }
      }
    }
  }
}

function settleAnimatedDie(die: AnimatedDie): void {
  if (die.settled) {
    return;
  }

  die.settled = true;
  die.vx = 0;
  die.vy = 0;
  die.z = 0;
  die.vz = 0;
  die.spin = 0;
  die.rotation = Math.round(die.rotation / 18) * 18;
  die.element.classList.add("anim-settled");
  playDiceImpactSound(0.05);
}

function renderAnimatedDie(die: AnimatedDie): void {
  const heightRatio = clampNumber(die.z / 520, 0, 1);
  const liftScale = die.settled ? 1.04 : 1 + heightRatio * 0.58 + Math.sin(die.rotation / 42) * 0.035;
  const tilt = die.settled ? 0 : 12 + heightRatio * 24 + Math.sin(die.rotation / 35) * 8;
  const shadowAlpha = clampNumber(0.43 - heightRatio * 0.24, 0.16, 0.43);
  const shadowBlur = 14 + heightRatio * 34;
  const shadowY = 16 + heightRatio * 34;
  const shadowX = 5 + heightRatio * 15;

  die.element.style.setProperty("--table-shadow-alpha", String(shadowAlpha));
  die.element.style.setProperty("--table-shadow-blur", `${shadowBlur}px`);
  die.element.style.setProperty("--table-shadow-y", `${shadowY}px`);
  die.element.style.setProperty("--table-shadow-x", `${shadowX}px`);
  die.element.style.transform = `translate3d(${die.x}px, ${die.y}px, 0) rotateX(${tilt}deg) rotateY(${tilt / 3}deg) rotateZ(${die.rotation}deg) scale(${liftScale})`;
}

function installDieDrag(die: AnimatedDie): void {
  die.element.addEventListener("pointerdown", (event) => {
    if (!die.settled) {
      return;
    }

    die.dragging = true;
    die.dragOffsetX = event.clientX - die.x;
    die.dragOffsetY = event.clientY - die.y;
    die.element.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  die.element.addEventListener("pointermove", (event) => {
    if (!die.dragging) {
      return;
    }

    const bounds = getAnimationBounds();
    die.x = clampNumber(event.clientX - die.dragOffsetX, bounds.left, bounds.right - die.size);
    die.y = clampNumber(event.clientY - die.dragOffsetY, bounds.top, bounds.bottom - die.size);
    renderAnimatedDie(die);
    event.preventDefault();
    event.stopPropagation();
  });

  die.element.addEventListener("pointerup", (event) => {
    if (!die.dragging) {
      return;
    }

    die.dragging = false;
    die.element.releasePointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
}

function faceSymbolMarkup(face: DiceFace): string {
  if (face === "skull") {
    return "&#9760;";
  }
  if (face === "critical") {
    return "&#9765;&#10022;";
  }
  if (face === "success") {
    return "&#9765;";
  }
  return "&#10038;";
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
    roll.dice.length > 0 ? `<span class="chip">${roll.dice.map((die) => die.value).join(", ")}</span>` : ""
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
    <span class="die ${kindClass} die-${face}" aria-label="${escapeHtml(`${kindLabel} ${die.value}: ${faceLabel}`)}">
      <span class="die-gem" aria-hidden="true"></span>
      <span>${die.value}</span>
      <span>${escapeHtml(faceLabel)}</span>
    </span>
  `;
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
  if (die.kind === "hunger" && die.value === 1) {
    return "skull";
  }

  if (die.value === 10) {
    return "critical";
  }

  if (die.value >= 6 && die.value <= 9) {
    return "success";
  }

  return "blank";
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
