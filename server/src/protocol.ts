import { z } from "zod";

export const protocolVersionSchema = z.literal(1);

export const helloMessageSchema = z.object({
  type: z.literal("hello"),
  version: protocolVersionSchema,
  clientId: z.string().trim().min(8).max(120),
  playerName: z.string().trim().min(1).max(80),
  characterName: z.string().trim().max(80).optional().default(""),
  channel: z.string().trim().min(1).max(120),
  password: z.string().max(240).optional().default("")
});

export const diceValueSchema = z.object({
  kind: z.enum(["regular", "hunger", "unknown"]).default("unknown"),
  value: z.number().int().min(1).max(100),
  sides: z.number().int().min(2).max(100).optional()
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

export const clientMessageSchema = z.discriminatedUnion("type", [
  helloMessageSchema,
  rollMessageSchema
]);

export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type RollEvent = z.infer<typeof rollEventSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type PresencePlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  joinedAt: string;
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
