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
const panelUiStorageKey = "diceRoomPanelUi";
const defaultDiceAnimationScale = 0.75;
const minDiceAnimationScale = 0.45;
const maxDiceAnimationScale = 1.15;
const extensionUiVersion = "0.1.59";
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
let captureScanTimers: number[] = [];
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

  if (isOwnPanelElement(event.target)) {
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

function armCapture(): void {
  baselineCurrentRolls();
  armedBaselineElements = new WeakSet(collectRollCandidates().map(({ element }) => element));
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
  armedBaselineElements = new WeakSet<Element>();

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
  }
}

function scanPage(): void {
  if (!isCaptureArmed()) {
    return;
  }

  const candidates = collectRollCandidates();

  for (const { element, captured } of candidates) {
    const previousSignature = elementSignatures.get(element);
    const isBaselineElement = armedBaselineElements.has(element);

    if (publishedElements.has(element) && previousSignature === captured.signature) {
      elementSignatures.set(element, captured.signature);
      continue;
    }

    if (isBaselineElement && previousSignature === captured.signature) {
      continue;
    }

    elementSignatures.set(element, captured.signature);
    publishCapturedRoll(captured, element);
    disarmCapture();
    return;
  }
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
  const dice = parseDice(sourceElement, sourceLines, sourceText, successes);
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
      const dice = parseDice(current, lines, rawText, successes);
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

function parseDice(element: Element, lines: string[], text?: string, successes?: number): DiceValue[] {
  const detailDice = parseDetailDiceFromDom(element, successes);
  const textDetailDice =
    typeof text === "string" && typeof successes === "number" ? parseDetailDiceFromText(text, successes) : [];

  if (textDetailDice.length > detailDice.length) {
    return textDetailDice;
  }

  if (detailDice.length > 0) {
    return detailDice;
  }

  if (textDetailDice.length > 0) {
    return textDetailDice;
  }

  return parseDiceFromText(lines);
}

function parseDetailDiceFromText(text: string, successes: number): DiceValue[] {
  const match = text.match(/\b(?:details|detalhes)\b([\s\S]{0,180})/i);
  if (!match) {
    return [];
  }

  const detailsText = match[1]
    .split(/\n\s*(?:dice pool|add dice|clear|roll|re-roll|reroll)\b/i)[0]
    .replace(/[^\d,\s]/g, " ");
  const counts = (detailsText.match(/\b\d{1,2}\b/g) ?? [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 80)
    .slice(0, 7);

  if (counts.length === 0) {
    return [];
  }

  const buckets = inferBucketsFromDetailCounts(counts, successes);
  const dice: DiceValue[] = [];
  for (let index = 0; index < counts.length && index < buckets.length; index += 1) {
    const bucket = buckets[index];
    for (let count = 0; count < counts[index] && dice.length < 80; count += 1) {
      dice.push(createDiceValue(bucket.kind, bucket.face));
    }
  }

  return dice;
}

function inferBucketsFromDetailCounts(
  counts: number[],
  successes: number
): Array<{ kind: DiceValue["kind"]; face: DiceFace }> {
  if (counts.length === 1) {
    return successes > 0 ? [{ kind: "regular", face: "success" }] : [{ kind: "regular", face: "blank" }];
  }

  if (counts.length === 2) {
    if (successes <= 0) {
      return [
        { kind: "regular", face: "blank" },
        { kind: "hunger", face: "blank" }
      ];
    }

    return [
      { kind: "regular", face: "blank" },
      { kind: "regular", face: "success" }
    ];
  }

  if (counts.length === 3) {
    const thirdCount = counts[2];
    if (successes === thirdCount) {
      return [
        { kind: "regular", face: "blank" },
        { kind: "hunger", face: "blank" },
        { kind: "regular", face: "success" }
      ];
    }

    return [
      { kind: "regular", face: "blank" },
      { kind: "regular", face: "success" },
      { kind: "regular", face: "critical" }
    ];
  }

  if (counts.length === 4) {
    const [, secondCount, thirdCount, fourthCount] = counts;
    if (successes === thirdCount + fourthCount) {
      return [
        { kind: "regular", face: "blank" },
        { kind: "hunger", face: "blank" },
        { kind: "regular", face: "success" },
        { kind: "hunger", face: "critical" }
      ];
    }

    if (successes === secondCount + thirdCount + fourthCount) {
      return [
        { kind: "regular", face: "blank" },
        { kind: "regular", face: "success" },
        { kind: "hunger", face: "success" },
        { kind: "hunger", face: "critical" }
      ];
    }

    return [
      { kind: "regular", face: "blank" },
      { kind: "regular", face: "success" },
      { kind: "regular", face: "critical" },
      { kind: "hunger", face: "skull" }
    ];
  }

  if (counts.length === 5) {
    const markedSuccessDice = counts[2] + counts[3] + counts[4];
    if (successes > markedSuccessDice) {
      return [
        { kind: "regular", face: "blank" },
        { kind: "hunger", face: "blank" },
        { kind: "regular", face: "success" },
        { kind: "regular", face: "critical" },
        { kind: "hunger", face: "critical" }
      ];
    }

    return [
      { kind: "regular", face: "blank" },
      { kind: "hunger", face: "blank" },
      { kind: "regular", face: "success" },
      { kind: "hunger", face: "success" },
      { kind: "hunger", face: "critical" }
    ];
  }

  if (counts.length === 6) {
    const noSkullSuccesses = counts[2] + counts[3] + counts[4] + counts[5];
    if (successes === noSkullSuccesses) {
      return [
        { kind: "regular", face: "blank" },
        { kind: "hunger", face: "blank" },
        { kind: "regular", face: "success" },
        { kind: "regular", face: "critical" },
        { kind: "hunger", face: "success" },
        { kind: "hunger", face: "critical" }
      ];
    }

    return [
      { kind: "regular", face: "blank" },
      { kind: "hunger", face: "blank" },
      { kind: "regular", face: "success" },
      { kind: "hunger", face: "success" },
      { kind: "hunger", face: "critical" },
      { kind: "hunger", face: "skull" }
    ];
  }

  return [
    { kind: "regular", face: "blank" },
    { kind: "hunger", face: "blank" },
    { kind: "regular", face: "success" },
    { kind: "regular", face: "critical" },
    { kind: "hunger", face: "success" },
    { kind: "hunger", face: "critical" },
    { kind: "hunger", face: "skull" }
  ];
}

type VisibleNumberText = {
  value: number;
  rect: DOMRect;
};

type DetailDieCandidate = {
  marker: Element;
  countText: VisibleNumberText;
  face?: DiceFace;
  red: boolean;
  filledRed: boolean;
  rect: DOMRect;
};

function parseDetailDiceFromDom(element: Element, successes?: number): DiceValue[] {
  const markers = collectDieMarkerElements(element);
  if (markers.length === 0) {
    return [];
  }

  const countTexts = collectVisibleNumberTexts(element);
  if (countTexts.length === 0) {
    return [];
  }

  const detailLabelRects = collectVisibleTextRects(element, /\b(details|detalhes)\b/i);
  const usedCounts = new Set<VisibleNumberText>();
  const candidates: DetailDieCandidate[] = [];

  for (const marker of markers) {
    const countText = findNearestDieCount(marker, countTexts, usedCounts);
    if (!countText) {
      continue;
    }

    const red = hasStrongRedMarkerColor(marker);
    const filledRed = hasDominantRedFillColor(marker);
    const face =
      inferDieFaceFromElement(marker) ??
      inferGraphicDetailDieFace(marker, filledRed) ??
      inferBlankDetailDieFace(marker, countText, detailLabelRects);
    const markerIsNearDetails = isNearDetailsRow(marker, countText, detailLabelRects);
    if (!face && !markerIsNearDetails) {
      continue;
    }

    usedCounts.add(countText);
    candidates.push({
      marker,
      countText,
      face,
      red,
      filledRed,
      rect: marker.getBoundingClientRect()
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  assignDetailFacesByRowOrder(candidates, successes);

  const dice: DiceValue[] = [];
  for (const candidate of candidates) {
    if (!candidate.face) {
      continue;
    }

    const kind = candidate.filledRed ? "hunger" : inferDieKindFromDetailMarker(candidate.marker, candidate.face);
    const count = clampNumber(candidate.countText.value, 1, 80 - dice.length);

    for (let index = 0; index < count; index += 1) {
      dice.push(createDiceValue(kind, candidate.face));
    }

    if (dice.length >= 80) {
      return dice.slice(0, 80);
    }
  }

  return dice;
}

function assignDetailFacesByRowOrder(candidates: DetailDieCandidate[], successes?: number): void {
  const sorted = [...candidates].sort((first, second) => {
    const vertical = first.rect.top - second.rect.top;
    return Math.abs(vertical) > 8 ? vertical : first.rect.left - second.rect.left;
  });

  for (const candidate of sorted) {
    if (!candidate.face && !candidate.red) {
      candidate.face = "blank";
    }
  }

  assignUnknownFacesBySuccessTotal(sorted, successes);

  const redCandidates = sorted.filter((candidate) => candidate.red && !candidate.filledRed && candidate.face !== "skull");
  const needsOrderedRegularFaces = redCandidates.length >= 2;
  redCandidates.forEach((candidate, index) => {
    if (!candidate.face || (needsOrderedRegularFaces && candidate.face === "success")) {
      candidate.face = needsOrderedRegularFaces && index === redCandidates.length - 1 ? "critical" : "success";
    }
  });
}

function assignUnknownFacesBySuccessTotal(candidates: DetailDieCandidate[], successes?: number): void {
  if (typeof successes !== "number" || successes < 0) {
    return;
  }

  let remainingSuccesses =
    successes -
    candidates
      .filter((candidate) => candidate.face === "success" || candidate.face === "critical")
      .reduce((total, candidate) => total + candidate.countText.value, 0);

  if (remainingSuccesses > 0) {
    for (const candidate of [...candidates].reverse()) {
      if (candidate.face || !candidate.red) {
        continue;
      }

      if (candidate.countText.value <= remainingSuccesses) {
        candidate.face = "success";
        remainingSuccesses -= candidate.countText.value;
      }

      if (remainingSuccesses <= 0) {
        break;
      }
    }
  }

  for (const candidate of candidates) {
    if (!candidate.face && candidate.filledRed) {
      candidate.face = "blank";
    }
  }
}

function inferDieKindFromDetailMarker(marker: Element, face: DiceFace): DiceValue["kind"] {
  if (face === "skull") {
    return "hunger";
  }

  const context = getElementContext(marker);
  return /(hunger|fome|blood|skull|vermelh)/i.test(context) ? "hunger" : "regular";
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

function collectVisibleNumberTexts(root: Element): VisibleNumberText[] {
  const values: VisibleNumberText[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Text) || !node.parentElement || !isVisibleElement(node.parentElement)) {
      continue;
    }

    const text = node.textContent ?? "";
    const matches = text.matchAll(/\b\d{1,2}\b/g);

    for (const match of matches) {
      const rawValue = match[0];
      const start = match.index ?? -1;
      if (start < 0) {
        continue;
      }

      const value = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(value) || value < 1 || value > 80) {
        continue;
      }

      const rect = getTextRangeRect(node, start, start + rawValue.length);
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      values.push({ value, rect });
    }
  }

  return values;
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

function findNearestDieCount(
  marker: Element,
  countTexts: VisibleNumberText[],
  usedCounts: Set<VisibleNumberText>
): VisibleNumberText | undefined {
  const markerRect = marker.getBoundingClientRect();
  const markerCenterY = markerRect.top + markerRect.height / 2;
  const maxVerticalDistance = Math.max(10, markerRect.height * 0.8);
  const maxHorizontalDistance = Math.max(40, markerRect.width * 2 + 28);
  let best: VisibleNumberText | undefined;
  let bestScore = Infinity;

  for (const countText of countTexts) {
    if (usedCounts.has(countText)) {
      continue;
    }

    const countCenterY = countText.rect.top + countText.rect.height / 2;
    const verticalDistance = Math.abs(countCenterY - markerCenterY);
    const horizontalDistance = countText.rect.left - markerRect.right;

    if (verticalDistance > maxVerticalDistance || horizontalDistance < -6 || horizontalDistance > maxHorizontalDistance) {
      continue;
    }

    const score = horizontalDistance + verticalDistance * 2;
    if (score < bestScore) {
      best = countText;
      bestScore = score;
    }
  }

  return best;
}

function inferBlankDetailDieFace(
  marker: Element,
  countText: VisibleNumberText,
  detailLabelRects: DOMRect[]
): DiceFace | undefined {
  if (detailLabelRects.length === 0 || !isNearDetailsRow(marker, countText, detailLabelRects)) {
    return undefined;
  }

  if (hasStrongRedMarkerColor(marker)) {
    return undefined;
  }

  return "blank";
}

function inferGraphicDetailDieFace(marker: Element, filledRed: boolean): DiceFace | undefined {
  if (!filledRed) {
    return undefined;
  }

  if (hasLargeLightInteriorShape(marker)) {
    return "skull";
  }

  if (hasInteriorInkShape(marker)) {
    return "success";
  }

  return "blank";
}

function isNearDetailsRow(marker: Element, countText: VisibleNumberText, detailLabelRects: DOMRect[]): boolean {
  const markerRect = marker.getBoundingClientRect();
  const markerCenterY = markerRect.top + markerRect.height / 2;

  return detailLabelRects.some((labelRect) => {
    const belowOrAligned = markerCenterY >= labelRect.top - 4;
    const closeVertically = markerCenterY <= labelRect.bottom + 58;
    const countAfterMarker = countText.rect.left >= markerRect.right - 6;
    const markerAfterLabel = markerRect.left >= labelRect.left - 8;
    return belowOrAligned && closeVertically && countAfterMarker && markerAfterLabel;
  });
}

function hasStrongRedMarkerColor(element: Element): boolean {
  const elements = [element, ...Array.from(element.querySelectorAll("*"))];

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

function hasDominantRedFillColor(element: Element): boolean {
  const markerRect = element.getBoundingClientRect();
  const markerArea = Math.max(1, markerRect.width * markerRect.height);
  const elements = [element, ...Array.from(element.querySelectorAll("*"))];

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

function hasLargeLightInteriorShape(element: Element): boolean {
  const markerRect = element.getBoundingClientRect();
  const markerArea = Math.max(1, markerRect.width * markerRect.height);
  const elements = Array.from(element.querySelectorAll("*"));

  for (const current of elements) {
    if (!(current instanceof Element)) {
      continue;
    }

    const style = window.getComputedStyle(current);
    const hasLightInk = [style.color, style.backgroundColor, style.fill, style.stroke].some((color) => {
      const rgb = parseRgbColor(color);
      if (!rgb) {
        return false;
      }

      const [red, green, blue] = rgb;
      return red > 180 && green > 180 && blue > 180;
    });

    if (!hasLightInk) {
      continue;
    }

    const rect = current.getBoundingClientRect();
    const insideMarker =
      rect.left >= markerRect.left - 1 &&
      rect.right <= markerRect.right + 1 &&
      rect.top >= markerRect.top - 1 &&
      rect.bottom <= markerRect.bottom + 1;
    const area = rect.width * rect.height;
    if (insideMarker && area >= markerArea * 0.06) {
      return true;
    }
  }

  return false;
}

function hasInteriorInkShape(element: Element): boolean {
  const markerRect = element.getBoundingClientRect();
  const markerArea = Math.max(1, markerRect.width * markerRect.height);
  const elements = Array.from(element.querySelectorAll("*"));

  for (const current of elements) {
    if (!(current instanceof Element)) {
      continue;
    }

    const style = window.getComputedStyle(current);
    const hasInk = [style.color, style.backgroundColor, style.fill, style.stroke].some((color) => {
      const rgb = parseRgbColor(color);
      if (!rgb) {
        return false;
      }

      const [red, green, blue] = rgb;
      const isDark = red < 90 && green < 90 && blue < 90;
      const isLight = red > 180 && green > 180 && blue > 180;
      return isDark || isLight;
    });

    if (!hasInk) {
      continue;
    }

    const rect = current.getBoundingClientRect();
    const insideMarker =
      rect.left >= markerRect.left - 1 &&
      rect.right <= markerRect.right + 1 &&
      rect.top >= markerRect.top - 1 &&
      rect.bottom <= markerRect.bottom + 1;
    const area = rect.width * rect.height;
    if (insideMarker && area >= markerArea * 0.025 && area <= markerArea * 0.45) {
      return true;
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
  const hasDiceContext = /(die|dice|dado|hunger|fome|regular|skull|ankh|blood|blank|critical|success|failure|detail|result|icon)/i.test(context);
  const isMedia = tagName === "img" || tagName === "svg" || tagName === "path" || tagName === "use";

  if (!hasDiceContext && !isMedia) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const hasSmallVisibleBox = rect.width >= 4 && rect.height >= 4 && rect.width <= 52 && rect.height <= 52;
  return hasSmallVisibleBox || isMedia;
}

function isVisibleElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function inferDieFaceFromElement(element: Element): DiceFace | undefined {
  const context = getElementContext(element);

  if (/(skull|caveira|bestial|beast|hunger[-_\s]?1|blood[-_\s]?1)/i.test(context)) {
    return "skull";
  }

  if (/(critical|crit|messy|special|double|two[-_\s]?ankh|double[-_\s]?ankh|regular[-_\s]?10|hunger[-_\s]?10|blood[-_\s]?10|face[-_\s]?10|result[-_\s]?10|d10[-_\s]?10)/i.test(context)) {
    return "critical";
  }

  if (/(ankh|success|sucesso|win|regular[-_\s]?[6-9]|hunger[-_\s]?[6-9]|blood[-_\s]?[6-9]|face[-_\s]?[6-9]|result[-_\s]?[6-9]|d10[-_\s]?[6-9])/i.test(context)) {
    return "success";
  }

  if (/(blank|fail|failure|asterisk|star|dot|empty|none|regular[-_\s]?[1-5]|hunger[-_\s]?[2-5]|blood[-_\s]?[2-5]|face[-_\s]?[1-5]|result[-_\s]?[1-5]|d10[-_\s]?[1-5])/i.test(context)) {
    return "blank";
  }

  return undefined;
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

      .version-chip {
        color: #8e9aaa;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0;
        white-space: nowrap;
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
          <span class="version-chip" title="Versao da extensao">v${extensionUiVersion}</span>
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
        <div class="settings-row">
          <label>
            <span data-settings-dice-size-label>Tamanho dos dados</span>
            <span data-dice-size-value></span>
          </label>
          <input data-dice-size type="range" min="0.45" max="1.15" step="0.05" />
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
  const diceSizeInput = shadow.querySelector("[data-dice-size]");
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
    diceAnimationInput,
    diceSizeInput
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
  panel.diceSizeInput.value = String(diceAnimationScale);
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
      diceAnimationScale: defaultDiceAnimationScale,
      position: undefined,
      language: "pt-BR"
    }
  });

  const value = stored[panelUiStorageKey] as
    | {
        collapsed?: unknown;
        settingsOpen?: unknown;
        opacity?: unknown;
        diceAnimationScale?: unknown;
        position?: unknown;
        language?: unknown;
      }
    | undefined;

  collapsed = value?.collapsed !== false;
  settingsOpen = value?.settingsOpen === true;
  panelOpacity = typeof value?.opacity === "number" ? clampNumber(value.opacity, 0.45, 1) : 0.94;
  diceAnimationScale =
    typeof value?.diceAnimationScale === "number"
      ? clampNumber(value.diceAnimationScale, minDiceAnimationScale, maxDiceAnimationScale)
      : defaultDiceAnimationScale;
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
      diceAnimationScale,
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

function playDiceAnimation(roll: RollEvent): void {
  if (!shouldAnimateDice() || !diceAnimationLayer || roll.dice.length === 0) {
    return;
  }

  const layer = diceAnimationLayer;
  const dice = roll.dice.slice(0, maxAnimatedDice);
  const batchId = (diceAnimationBatchSequence += 1);
  const animatedDice = dice.map((die, index) => createAnimatedDie(die, index, dice.length, batchId, layer));
  for (const die of animatedDice) {
    layer.activeDice.add(die);
    layer.scene.add(die.group);
  }
  playDiceRollSound(animatedDice.length);
  ensureDiceAnimationLoop();
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
      layer.scene.remove(die.group);
      disposeAnimatedDie(die.group, layer.d10Model);
      layer.activeDice.delete(die);
    }
  }

  resolveDieCollisions(layer);
  revealReadyDiceBatches(layer, now);
  for (const die of layer.activeDice) {
    die.group.position.set(die.x, die.y, die.z);
  }
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
  }
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
