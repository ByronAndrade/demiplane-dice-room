declare const __DICE_ROOM_DEFAULT_RELAY__: string;
declare const __DICE_ROOM_DEFAULT_RELAY_KEY__: string;

const legacyDefaultRelayUrl = "ws://localhost:8787";
const defaultRelayUrl = getDefaultRelayUrl();
const defaultRelayKey = getDefaultRelayKey();

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
  serverUrl: defaultRelayUrl,
  relayKey: defaultRelayKey,
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

function getDefaultRelayKey(): string {
  return __DICE_ROOM_DEFAULT_RELAY_KEY__ || "";
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

export async function getHostRoomKey(roomId: string): Promise<string> {
  const cleanRoomId = cleanString(roomId);
  if (!cleanRoomId) {
    return "";
  }

  const stored = await chrome.storage.local.get({ hostRoomKeys: {} });
  const hostRoomKeys = isStringRecord(stored.hostRoomKeys) ? stored.hostRoomKeys : {};
  const existing = hostRoomKeys[cleanRoomId];
  if (typeof existing === "string" && existing.length >= 32) {
    return existing;
  }

  const hostRoomKey = createSecret();
  await chrome.storage.local.set({
    hostRoomKeys: {
      ...hostRoomKeys,
      [cleanRoomId]: hostRoomKey
    }
  });
  return hostRoomKey;
}

function normalizeConfig(value: Partial<ExtensionConfig>): ExtensionConfig {
  const serverUrl = normalizeServerUrl(value.serverUrl);

  return {
    serverUrl,
    relayKey: normalizeRelayKey(value.relayKey, serverUrl),
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

  if (serverUrl === legacyDefaultRelayUrl && defaultRelayUrl !== legacyDefaultRelayUrl) {
    return defaultRelayUrl;
  }

  return serverUrl;
}

function normalizeRelayKey(value: unknown, serverUrl: string): string {
  const relayKey = cleanString(value);
  if (relayKey) {
    return relayKey;
  }

  return serverUrl === defaultRelayUrl ? defaultRelayKey : "";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(([key, item]) => typeof key === "string" && typeof item === "string");
}

function createSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
