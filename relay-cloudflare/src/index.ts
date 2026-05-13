import { DurableObject } from "cloudflare:workers";

const protocolVersion = 1;
const maxMessageBytes = 64 * 1024;
const maxRoomHistory = 100;
const historyStorageKey = "history";

type DiceValue = {
  kind: "regular" | "hunger" | "unknown";
  value: number;
  sides?: number;
};

type PresencePlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  joinedAt: string;
};

type RollEvent = {
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

type HelloMessage = {
  type: "hello";
  version: 1;
  clientId: string;
  playerName: string;
  characterName?: string;
  channel: string;
  password?: string;
};

type RollMessage = {
  type: "roll";
  version: 1;
  roll: RollEvent;
};

type ServerMessage =
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

type ClientSession = {
  roomId: string;
  joinedAt: string;
  clientId?: string;
  playerName?: string;
  characterName?: string;
  ready?: boolean;
};

export interface Env {
  DICE_ROOM_ROOMS: DurableObjectNamespace<DiceRoomDurableObject>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, relay: "cloudflare", websocket: true });
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return renderStatusPage(url);
    }

    const roomId = normalizeRoomId(url.searchParams.get("room"));
    if (!roomId) {
      return json(
        {
          ok: false,
          error: "missing_room",
          message: "A extensao precisa enviar o parametro ?room=... no WebSocket."
        },
        400
      );
    }

    const durableObjectId = env.DICE_ROOM_ROOMS.idFromName(roomId);
    return env.DICE_ROOM_ROOMS.get(durableObjectId).fetch(request);
  }
};

export class DiceRoomDurableObject extends DurableObject<Env> {
  private sessions = new Map<WebSocket, ClientSession>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    for (const socket of this.ctx.getWebSockets()) {
      const session = normalizeSession(socket.deserializeAttachment());
      if (session) {
        this.sessions.set(socket, session);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ ok: false, error: "websocket_required" }, 426);
    }

    const roomId = normalizeRoomId(new URL(request.url).searchParams.get("room"));
    if (!roomId) {
      return json({ ok: false, error: "missing_room" }, 400);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const session: ClientSession = {
      roomId,
      joinedAt: new Date().toISOString(),
      ready: false
    };

    server.serializeAttachment(session);
    this.ctx.acceptWebSocket(server);
    this.sessions.set(server, session);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      this.send(socket, errorMessage("invalid_message", "Mensagem precisa ser texto JSON."));
      return;
    }

    if (new TextEncoder().encode(message).byteLength > maxMessageBytes) {
      this.send(socket, errorMessage("message_too_large", "Mensagem maior que o limite aceito."));
      return;
    }

    const parsed = parseJson(message);
    if (!parsed.ok) {
      this.send(socket, errorMessage("invalid_json", "Mensagem nao e um JSON valido."));
      return;
    }

    if (isHelloMessage(parsed.value)) {
      await this.handleHello(socket, parsed.value);
      return;
    }

    const session = this.getReadySession(socket);
    if (!session) {
      this.send(socket, errorMessage("not_joined", "Envie hello antes de publicar rolagens."));
      return;
    }

    if (!isRollMessage(parsed.value)) {
      this.send(socket, errorMessage("invalid_message", "Mensagem fora do formato esperado."));
      return;
    }

    const roll = normalizeRoll(parsed.value.roll, session);
    if (!isUsefulRoll(roll)) {
      this.send(socket, errorMessage("ignored_roll", "Rolagem ignorada porque nao parece ser um resultado completo."));
      return;
    }

    await this.appendHistory(session.roomId, roll);
    this.broadcast(session.roomId, { type: "roll", version: 1, roomId: session.roomId, roll }, socket);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);
    socket.close(code, reason);

    if (session?.ready) {
      this.broadcastPresence(session.roomId);
    }
  }

  webSocketError(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);

    if (session?.ready) {
      this.broadcastPresence(session.roomId);
    }
  }

  private async handleHello(socket: WebSocket, hello: HelloMessage): Promise<void> {
    const current = this.sessions.get(socket);
    const roomId = current?.roomId;

    if (!roomId) {
      this.send(socket, errorMessage("missing_room", "Sala nao encontrada na conexao."));
      return;
    }

    const clientId = hello.clientId.trim();
    const playerName = hello.playerName.trim();
    const session: ClientSession = {
      roomId,
      joinedAt: current?.joinedAt || new Date().toISOString(),
      clientId,
      playerName,
      characterName: hello.characterName?.trim() || undefined,
      ready: true
    };

    this.sessions.set(socket, session);
    socket.serializeAttachment(session);

    this.send(socket, {
      type: "welcome",
      version: 1,
      roomId,
      clientId,
      players: this.getPlayers(roomId),
      history: await this.getHistory()
    });

    this.broadcastPresence(roomId);
  }

  private broadcastPresence(roomId: string): void {
    this.broadcast(roomId, {
      type: "presence",
      version: 1,
      roomId,
      players: this.getPlayers(roomId)
    });
  }

  private broadcast(roomId: string, message: ServerMessage, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) {
        continue;
      }

      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (session?.roomId !== roomId || !session.ready) {
        continue;
      }

      this.send(socket, message);
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.sessions.delete(socket);
    }
  }

  private getPlayers(roomId: string): PresencePlayer[] {
    const players: PresencePlayer[] = [];

    for (const socket of this.ctx.getWebSockets()) {
      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (!session?.ready || session.roomId !== roomId || !session.clientId || !session.playerName) {
        continue;
      }

      players.push({
        clientId: session.clientId,
        playerName: session.playerName,
        characterName: session.characterName,
        joinedAt: session.joinedAt
      });
    }

    return players;
  }

  private getReadySession(socket: WebSocket): Required<Pick<ClientSession, "roomId" | "joinedAt" | "clientId" | "playerName">> &
    ClientSession | undefined {
    const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
    if (!session?.ready || !session.clientId || !session.playerName) {
      return undefined;
    }

    return session as Required<Pick<ClientSession, "roomId" | "joinedAt" | "clientId" | "playerName">> & ClientSession;
  }

  private async appendHistory(roomId: string, roll: RollEvent): Promise<void> {
    const history = await this.getHistory();
    if (history.some((item) => item.id === roll.id)) {
      return;
    }

    const nextHistory = [...history, roll].slice(-maxRoomHistory);
    await this.ctx.storage.put(historyStorageKey, nextHistory);
  }

  private async getHistory(): Promise<RollEvent[]> {
    const history = await this.ctx.storage.get<RollEvent[]>(historyStorageKey);
    return Array.isArray(history) ? history.filter(isUsefulRoll) : [];
  }
}

function normalizeRoll(
  roll: RollEvent,
  session: Required<Pick<ClientSession, "clientId" | "playerName">> & ClientSession
): RollEvent {
  return {
    ...roll,
    clientId: session.clientId,
    playerName: session.playerName,
    characterName: roll.characterName || session.characterName
  };
}

function isHelloMessage(value: unknown): value is HelloMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<HelloMessage>;
  return (
    message.type === "hello" &&
    message.version === protocolVersion &&
    isBoundedString(message.clientId, 8, 120) &&
    isBoundedString(message.playerName, 1, 80) &&
    isBoundedString(message.channel, 1, 120) &&
    (message.characterName === undefined || isBoundedString(message.characterName, 0, 80)) &&
    (message.password === undefined || isBoundedString(message.password, 0, 240))
  );
}

function isRollMessage(value: unknown): value is RollMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<RollMessage>;
  return message.type === "roll" && message.version === protocolVersion && isRollEvent(message.roll);
}

function isRollEvent(value: unknown): value is RollEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const roll = value as Partial<RollEvent>;
  return (
    roll.type === "roll" &&
    roll.version === protocolVersion &&
    isBoundedString(roll.id, 8, 160) &&
    isBoundedString(roll.clientId, 8, 120) &&
    isBoundedString(roll.playerName, 1, 80) &&
    roll.source === "demiplane" &&
    isBoundedString(roll.system, 1, 40) &&
    isBoundedString(roll.rollTitle, 1, 160) &&
    isOptionalInteger(roll.successes, 0, 999) &&
    isOptionalInteger(roll.total, -9999, 9999) &&
    Array.isArray(roll.dice) &&
    roll.dice.length <= 80 &&
    roll.dice.every(isDiceValue) &&
    isBoundedString(roll.rawText, 1, 4000) &&
    typeof roll.createdAt === "string" &&
    !Number.isNaN(Date.parse(roll.createdAt))
  );
}

function isDiceValue(value: unknown): value is DiceValue {
  if (!value || typeof value !== "object") {
    return false;
  }

  const die = value as Partial<DiceValue>;
  const dieValue = die.value;
  const dieSides = die.sides;
  return (
    (die.kind === "regular" || die.kind === "hunger" || die.kind === "unknown") &&
    typeof dieValue === "number" &&
    Number.isInteger(dieValue) &&
    dieValue >= 1 &&
    dieValue <= 100 &&
    (dieSides === undefined || (typeof dieSides === "number" && Number.isInteger(dieSides) && dieSides >= 2 && dieSides <= 100))
  );
}

function isUsefulRoll(roll: RollEvent): boolean {
  return (
    isUsefulRollTitle(roll.rollTitle) &&
    typeof roll.successes === "number" &&
    !/(add dice to roll|dice pool|clear|regular\s+hunger)/i.test(roll.rawText)
  );
}

function isUsefulRollTitle(value: string): boolean {
  const title = value.trim();
  return /^[A-Z][A-Z '-]{2,50}[ \t]*\+[ \t]*[A-Z][A-Z '-]{2,50}$/.test(title) || /^custom$/i.test(title);
}

function normalizeRoomId(value: string | null): string | undefined {
  const roomId = value?.trim();
  return roomId && /^[a-f0-9]{32}$/.test(roomId) ? roomId : undefined;
}

function normalizeSession(value: unknown): ClientSession | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const session = value as Partial<ClientSession>;
  if (!isBoundedString(session.roomId, 32, 32) || !isBoundedString(session.joinedAt, 1, 80)) {
    return undefined;
  }

  return {
    roomId: session.roomId,
    joinedAt: session.joinedAt,
    clientId: typeof session.clientId === "string" ? session.clientId : undefined,
    playerName: typeof session.playerName === "string" ? session.playerName : undefined,
    characterName: typeof session.characterName === "string" ? session.characterName : undefined,
    ready: session.ready === true
  };
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function isOptionalInteger(value: unknown, min: number, max: number): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max)
  );
}

function errorMessage(code: string, message: string): ServerMessage {
  return { type: "error", version: 1, code, message };
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function renderStatusPage(url: URL): Response {
  const relayUrl = `wss://${url.host}`;
  return new Response(
    `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demiplane Dice Room Relay</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111418; color: #f3f6fb; }
      body { margin: 0; padding: 28px; background: #111418; }
      main { max-width: 720px; margin: 0 auto; border: 1px solid #303844; border-radius: 8px; padding: 22px; background: #171c23; }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { color: #b7c1d0; line-height: 1.55; }
      code { color: #f7f9fc; overflow-wrap: anywhere; }
      .status { display: inline-flex; border: 1px solid #2f7255; border-radius: 999px; padding: 6px 10px; color: #bdf4d2; background: #183526; font-weight: 800; }
    </style>
  </head>
  <body>
    <main>
      <span class="status">Relay online</span>
      <h1>Demiplane Dice Room Relay</h1>
      <p>Use este endereco no campo Relay da extensao:</p>
      <p><code>${escapeHtml(relayUrl)}</code></p>
      <p>A sala continua sendo definida pelo nome do canal e pela senha dentro da extensao.</p>
    </main>
  </body>
</html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" }
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
