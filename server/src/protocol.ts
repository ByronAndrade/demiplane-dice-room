import { z } from "zod";

export const protocolVersionSchema = z.literal(1);

export const helloMessageSchema = z.object({
  type: z.literal("hello"),
  version: protocolVersionSchema,
  clientId: z.string().trim().min(8).max(120),
  playerName: z.string().trim().min(1).max(80),
  characterName: z.string().trim().max(80).optional().default(""),
  roomRole: z.enum(["host", "player"]).optional().default("player"),
  channel: z.string().trim().min(1).max(120),
  password: z.string().max(240).optional().default("")
});

export const diceValueSchema = z.object({
  kind: z.enum(["regular", "hunger", "unknown"]).default("unknown"),
  value: z.number().int().min(1).max(100),
  sides: z.number().int().min(2).max(100).optional(),
  face: z.enum(["blank", "success", "critical", "skull"]).optional()
});

export const rollEventSchema = z.object({
  type: z.literal("roll"),
  version: protocolVersionSchema,
  id: z.string().trim().min(8).max(160),
  clientId: z.string().trim().min(8).max(120),
  playerName: z.string().trim().min(1).max(80),
  characterName: z.string().trim().max(80).optional(),
  source: z.literal("demiplane"),
  system: z.string().trim().min(1).max(40).default("vampire"),
  rollTitle: z.string().trim().min(1).max(160),
  successes: z.number().int().min(0).max(999).nullable().optional(),
  total: z.number().int().min(-9999).max(9999).nullable().optional(),
  dice: z.array(diceValueSchema).max(80).default([]),
  rawText: z.string().trim().min(1).max(4000),
  createdAt: z.string().datetime()
});

export const rollMessageSchema = z.object({
  type: z.literal("roll"),
  version: protocolVersionSchema,
  roll: rollEventSchema
});

export const sharedDiceControlEventSchema = z.object({
  action: z.enum(["grab", "move", "release"]),
  rollId: z.string().trim().min(8).max(160),
  dieIndex: z.number().int().min(0).max(79),
  sequence: z.number().int().min(0).max(999_999_999),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  z: z.number().min(0).max(1).optional(),
  actorClientId: z.string().trim().min(8).max(120).optional(),
  actorName: z.string().trim().min(1).max(80).optional(),
  createdAt: z.string().datetime()
});

export const diceControlMessageSchema = z.object({
  type: z.literal("dice_control"),
  version: protocolVersionSchema,
  event: sharedDiceControlEventSchema
});

export const approvePlayerMessageSchema = z.object({
  type: z.literal("approve_player"),
  version: protocolVersionSchema,
  clientId: z.string().trim().min(8).max(120)
});

export const rejectPlayerMessageSchema = z.object({
  type: z.literal("reject_player"),
  version: protocolVersionSchema,
  clientId: z.string().trim().min(8).max(120)
});

export const kickPlayerMessageSchema = z.object({
  type: z.literal("kick_player"),
  version: protocolVersionSchema,
  clientId: z.string().trim().min(8).max(120)
});

export const leaveRoomMessageSchema = z.object({
  type: z.literal("leave_room"),
  version: protocolVersionSchema
});

export const heartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
  version: protocolVersionSchema,
  createdAt: z.string().datetime()
});

export const viewStatusMessageSchema = z.object({
  type: z.literal("view_status"),
  version: protocolVersionSchema,
  active: z.boolean(),
  reportedAt: z.string().datetime()
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  helloMessageSchema,
  rollMessageSchema,
  diceControlMessageSchema,
  approvePlayerMessageSchema,
  rejectPlayerMessageSchema,
  kickPlayerMessageSchema,
  heartbeatMessageSchema,
  viewStatusMessageSchema,
  leaveRoomMessageSchema
]);

export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type RollEvent = z.infer<typeof rollEventSchema>;
export type SharedDiceControlEvent = z.infer<typeof sharedDiceControlEventSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type PresencePlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  roomRole?: "host" | "player";
  joinedAt: string;
  sheetStatus?: "active" | "offline";
  sheetSeenAt?: string;
};

export type PendingPlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  requestedAt: string;
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
      type: "dice_control";
      version: 1;
      roomId: string;
      event: SharedDiceControlEvent;
    }
  | {
      type: "error";
      version: 1;
      code: string;
      message: string;
      rollId?: string;
    };
