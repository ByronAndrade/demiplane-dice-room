export const protocolVersion = 1;

export type ConnectionStatus = "disconnected" | "connecting" | "pending" | "connected" | "error";

export type DiceFace = "blank" | "success" | "critical" | "skull";

export type DiceValue = {
  kind: "regular" | "hunger" | "unknown";
  value: number;
  sides?: number;
  face?: DiceFace;
};

export type PresencePlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  roomRole?: "host" | "player";
  hideCharacterName?: boolean;
  joinedAt: string;
};

export type PendingPlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  requestedAt: string;
};

export type ConnectionState = {
  status: ConnectionStatus;
  detail: string;
  roomId?: string;
  clientId?: string;
  players: PresencePlayer[];
  pendingPlayers?: PendingPlayer[];
  connectedAt?: string;
};

export type CapturedRoll = {
  rollTitle: string;
  characterName?: string;
  successes?: number | null;
  total?: number | null;
  dice: DiceValue[];
  rawText: string;
  createdAt: string;
  signature: string;
};

export type RollEvent = {
  type: "roll";
  version: 1;
  id: string;
  clientId: string;
  playerName: string;
  characterName?: string;
  source: "demiplane";
  system: string;
  rollTitle: string;
  successes?: number | null;
  total?: number | null;
  dice: DiceValue[];
  rawText: string;
  createdAt: string;
};

export type ServerMessage =
  | {
      type: "welcome";
      version: 1;
      roomId: string;
      clientId: string;
      players: PresencePlayer[];
      history: RollEvent[];
    }
  | {
      type: "presence";
      version: 1;
      roomId: string;
      players: PresencePlayer[];
    }
  | {
      type: "approval_required";
      version: 1;
      roomId: string;
      message: string;
    }
  | {
      type: "pending_players";
      version: 1;
      roomId: string;
      pendingPlayers: PendingPlayer[];
    }
  | {
      type: "heartbeat";
      version: 1;
      roomId: string;
      createdAt: string;
    }
  | {
      type: "roll";
      version: 1;
      roomId: string;
      roll: RollEvent;
    }
  | {
      type: "error";
      version: 1;
      code: string;
      message: string;
    };

export type ClientMessage =
  | { type: "hello"; version: 1; clientId: string; playerName: string; characterName?: string; roomRole: "host" | "player"; channel: string; password?: string }
  | { type: "roll"; version: 1; roll: RollEvent }
  | { type: "approve_player"; version: 1; clientId: string }
  | { type: "reject_player"; version: 1; clientId: string }
  | { type: "kick_player"; version: 1; clientId: string }
  | { type: "heartbeat"; version: 1; createdAt: string }
  | { type: "leave_room"; version: 1 };

export type BackgroundMessage =
  | {
      kind: "background:connection-state";
      state: ConnectionState;
    }
  | {
      kind: "background:roll-history";
      rolls: StoredRoll[];
    }
  | {
      kind: "background:roll-event";
      roll: RollEvent;
      origin: "local" | "remote";
      delivery: RollDelivery;
    };

export type RollDelivery = "local" | "sent" | "received" | "history";

export type StoredRoll = {
  roll: RollEvent;
  origin: "local" | "remote";
  delivery: RollDelivery;
};

export function createRollId(clientId: string, signature: string, createdAt: string): string {
  return `${clientId}:${createdAt}:${signature}`.slice(0, 150);
}

export async function createRoomId(channel: string, password = ""): Promise<string> {
  const input = `${channel.trim().toLowerCase()}\0${password}`;
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function createRoomSocketUrl(serverUrl: string, roomId: string, relayKey = ""): string {
  const url = new URL(serverUrl);
  url.searchParams.set("room", roomId);
  const trimmedRelayKey = relayKey.trim();
  if (trimmedRelayKey) {
    url.searchParams.set("key", trimmedRelayKey);
  }
  return url.toString();
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as { type?: unknown; version?: unknown };
  return typeof message.type === "string" && message.version === protocolVersion;
}
