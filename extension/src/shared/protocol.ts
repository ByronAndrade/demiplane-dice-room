export const protocolVersion = 1;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type DiceValue = {
  kind: "regular" | "hunger" | "unknown";
  value: number;
  sides?: number;
};

export type PresencePlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  joinedAt: string;
};

export type ConnectionState = {
  status: ConnectionStatus;
  detail: string;
  roomId?: string;
  players: PresencePlayer[];
  connectedAt?: string;
};

export type CapturedRoll = {
  rollTitle: string;
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

export function createRoomSocketUrl(serverUrl: string, roomId: string): string {
  const url = new URL(serverUrl);
  url.searchParams.set("room", roomId);
  return url.toString();
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as { type?: unknown; version?: unknown };
  return typeof message.type === "string" && message.version === protocolVersion;
}
