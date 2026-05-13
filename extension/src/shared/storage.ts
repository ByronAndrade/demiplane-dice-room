declare const __DICE_ROOM_DEFAULT_RELAY__: string;

export type ExtensionConfig = {
  serverUrl: string;
  playerName: string;
  characterName: string;
  channel: string;
  password: string;
  autoConnect: boolean;
  showOwnRolls: boolean;
  enableDiceAnimation: boolean;
};

export const defaultConfig: ExtensionConfig = {
  serverUrl: getDefaultRelayUrl(),
  playerName: "",
  characterName: "",
  channel: "",
  password: "",
  autoConnect: false,
  showOwnRolls: false,
  enableDiceAnimation: true
};

function getDefaultRelayUrl(): string {
  return __DICE_ROOM_DEFAULT_RELAY__ || "ws://localhost:8787";
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
    serverUrl: cleanString(value.serverUrl) || defaultConfig.serverUrl,
    playerName: cleanString(value.playerName),
    characterName: cleanString(value.characterName),
    channel: cleanString(value.channel),
    password: typeof value.password === "string" ? value.password : "",
    autoConnect: value.autoConnect === true,
    showOwnRolls: value.showOwnRolls === true,
    enableDiceAnimation: value.enableDiceAnimation !== false
  };
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
