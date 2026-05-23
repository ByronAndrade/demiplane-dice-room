declare const __DICE_ROOM_DEFAULT_RELAY__: string;

const legacyDefaultRelayUrl = "ws://localhost:8787";

export type ExtensionConfig = {
  serverUrl: string;
  relayKey: string;
  playerName: string;
  characterName: string;
  roomRole: "host" | "player";
  channel: string;
  password: string;
  autoConnect: boolean;
  showOwnRolls: boolean;
  enableDiceAnimation: boolean;
  enableSharedDice: boolean;
  hideCharacterName: boolean;
};

export const defaultConfig: ExtensionConfig = {
  serverUrl: getDefaultRelayUrl(),
  relayKey: "",
  playerName: "",
  characterName: "",
  roomRole: "player",
  channel: "",
  password: "",
  autoConnect: false,
  showOwnRolls: false,
  enableDiceAnimation: true,
  enableSharedDice: true,
  hideCharacterName: false
};

function getDefaultRelayUrl(): string {
  return __DICE_ROOM_DEFAULT_RELAY__ || legacyDefaultRelayUrl;
}

export async function getConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get(defaultConfig);
  return normalizeConfig(stored);
}

export async function saveConfig(config: ExtensionConfig): Promise<ExtensionConfig> {
  const normalized = normalizeConfig(config);
  await chrome.storage.local.set(normalized);
  return normalized;
}

export async function getClientId(): Promise<string> {
  const stored = await chrome.storage.local.get({ clientId: "" });

  if (typeof stored.clientId === "string" && stored.clientId.length >= 8) {
    return stored.clientId;
  }

  const clientId = crypto.randomUUID();
  await chrome.storage.local.set({ clientId });
  return clientId;
}

function normalizeConfig(value: Partial<ExtensionConfig>): ExtensionConfig {
  return {
    serverUrl: normalizeServerUrl(value.serverUrl),
    relayKey: cleanString(value.relayKey),
    playerName: cleanString(value.playerName),
    characterName: cleanString(value.characterName),
    roomRole: value.roomRole === "host" ? "host" : "player",
    channel: cleanString(value.channel),
    password: typeof value.password === "string" ? value.password : "",
    autoConnect: value.autoConnect === true,
    showOwnRolls: value.showOwnRolls === true,
    enableDiceAnimation: value.enableDiceAnimation !== false,
    enableSharedDice: value.enableSharedDice !== false,
    hideCharacterName: value.hideCharacterName === true
  };
}

function normalizeServerUrl(value: unknown): string {
  const serverUrl = cleanString(value);

  if (!serverUrl) {
    return defaultConfig.serverUrl;
  }

  if (serverUrl === legacyDefaultRelayUrl && defaultConfig.serverUrl !== legacyDefaultRelayUrl) {
    return defaultConfig.serverUrl;
  }

  return serverUrl;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
