import { DurableObject } from "cloudflare:workers";

const protocolVersion = 1;
const maxMessageBytes = 64 * 1024;
const maxRoomHistory = 100;
const maxRoomPlayers = 20;
const hostReconnectGraceMs = 120_000;
const historyStorageKey = "history";
const approvedStorageKey = "approvedPlayers";

type DiceValue = {
  kind: "regular" | "hunger" | "unknown";
  value: number;
  sides?: number;
  face?: "blank" | "success" | "critical" | "skull";
};

type PresencePlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  roomRole?: "host" | "player";
  joinedAt: string;
  sheetStatus?: "active" | "offline";
  sheetSeenAt?: string;
};

type PendingPlayer = {
  clientId: string;
  playerName: string;
  characterName?: string;
  requestedAt: string;
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
  roomRole?: "host" | "player";
  channel: string;
  password?: string;
};

type RollMessage = {
  type: "roll";
  version: 1;
  roll: RollEvent;
};

type PlayerControlMessage = {
  type: "approve_player" | "reject_player" | "kick_player";
  version: 1;
  clientId: string;
};

type LeaveRoomMessage = {
  type: "leave_room";
  version: 1;
};

type HeartbeatMessage = {
  type: "heartbeat";
  version: 1;
  createdAt: string;
};

type ViewStatusMessage = {
  type: "view_status";
  version: 1;
  active: boolean;
  reportedAt: string;
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
      rollId?: string;
    };

type ClientSession = {
  roomId: string;
  joinedAt: string;
  requestedAt?: string;
  clientId?: string;
  playerName?: string;
  characterName?: string;
  roomRole?: "host" | "player";
  ready?: boolean;
  sheetActive?: boolean;
  sheetSeenAt?: string;
};

export interface Env {
  DICE_ROOM_ROOMS: DurableObjectNamespace<DiceRoomDurableObject>;
  DICE_ROOM_RELAY_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        relay: "cloudflare",
        websocket: true,
        accessKeyRequired: Boolean(normalizeRelayKey(env.DICE_ROOM_RELAY_KEY)),
        roomLimit: maxRoomPlayers
      });
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return renderStatusPage(url);
    }

    const requiredRelayKey = normalizeRelayKey(env.DICE_ROOM_RELAY_KEY);
    if (requiredRelayKey && url.searchParams.get("key") !== requiredRelayKey) {
      return json(
        {
          ok: false,
          error: "relay_key_required",
          message: "Este relay exige uma chave de acesso."
        },
        403
      );
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
  private hostGraceTimer: ReturnType<typeof setTimeout> | undefined;
  private hostGraceClientId = "";

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

    if (isLeaveRoomMessage(parsed.value)) {
      void this.handleLeaveRoom(socket);
      return;
    }

    if (isHeartbeatMessage(parsed.value)) {
      return;
    }

    if (isViewStatusMessage(parsed.value)) {
      this.handleViewStatus(socket, parsed.value);
      return;
    }

    const session = this.getReadySession(socket);
    if (!session) {
      this.send(socket, errorMessage("not_joined", "Aguardando entrada na sala antes de publicar rolagens."));
      return;
    }

    if (isPlayerControlMessage(parsed.value)) {
      await this.handlePlayerControl(socket, session, parsed.value);
      return;
    }

    if (!isRollMessage(parsed.value)) {
      this.send(socket, errorMessage("invalid_message", "Mensagem fora do formato esperado."));
      return;
    }

    const roll = normalizeRoll(parsed.value.roll, session);
    if (!isUsefulRoll(roll)) {
      this.send(socket, errorMessage("ignored_roll", "Rolagem ignorada porque nao parece ser um resultado completo.", roll.id));
      return;
    }

    await this.appendHistory(session.roomId, roll);
    this.broadcast(session.roomId, { type: "roll", version: 1, roomId: session.roomId, roll });
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);
    socket.close(code, reason);

    if (session?.ready) {
      if (session.roomRole === "host") {
        this.scheduleHostGraceRoomClose(session.roomId, session.clientId || "");
        return;
      }

      this.broadcastPresence(session.roomId);
    } else if (session?.roomId && session.clientId) {
      this.sendPendingPlayers(session.roomId);
    }
  }

  webSocketError(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);

    if (session?.ready) {
      if (session.roomRole === "host") {
        this.scheduleHostGraceRoomClose(session.roomId, session.clientId || "");
        return;
      }

      this.broadcastPresence(session.roomId);
    } else if (session?.roomId && session.clientId) {
      this.sendPendingPlayers(session.roomId);
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
    const roomRole = hello.roomRole === "host" ? "host" : "player";
    const existingHostSocket = this.findHostSocket(roomId, socket);
    const existingHostSession = existingHostSocket ?
      this.sessions.get(existingHostSocket) ?? normalizeSession(existingHostSocket.deserializeAttachment()) :
      undefined;

    if (roomRole === "host" && existingHostSocket && existingHostSession?.clientId !== clientId) {
      this.send(socket, errorMessage("room_host_exists", "Esta sala ja tem um narrador conectado."));
      socket.close(1008, "room_host_exists");
      this.sessions.delete(socket);
      return;
    }

    if (
      roomRole === "host" &&
      !existingHostSocket &&
      this.hostGraceClientId &&
      this.hostGraceClientId !== clientId
    ) {
      this.send(socket, errorMessage("room_host_exists", "Esta sala aguarda o narrador original reconectar."));
      socket.close(1008, "room_host_exists");
      this.sessions.delete(socket);
      return;
    }

    const approvedPlayer = await this.isPlayerApproved(clientId);
    if (roomRole === "player" && !existingHostSocket && !approvedPlayer) {
      this.send(socket, errorMessage("room_not_found", "A sala ainda nao foi criada pelo narrador."));
      socket.close(1008, "room_not_found");
      this.sessions.delete(socket);
      return;
    }

    if (roomRole === "host") {
      this.clearHostGraceTimer();
    }

    this.replaceReadyPlayer(roomId, clientId, socket);
    const nextRoomPlayerCount = this.getReadyCount(roomId, socket);

    if (nextRoomPlayerCount >= maxRoomPlayers) {
      this.send(socket, errorMessage("room_full", `Sala cheia. O limite e de ${maxRoomPlayers} jogadores.`));
      socket.close(1008, "room_full");
      this.sessions.delete(socket);
      return;
    }

    if (roomRole === "player" && !approvedPlayer) {
      const pendingSession: ClientSession = {
        roomId,
        joinedAt: current?.joinedAt || new Date().toISOString(),
        requestedAt: new Date().toISOString(),
        clientId,
        playerName,
        characterName: hello.characterName?.trim() || undefined,
        roomRole,
        ready: false
      };

      this.replacePendingPlayer(roomId, clientId, socket);
      this.sessions.set(socket, pendingSession);
      socket.serializeAttachment(pendingSession);
      this.send(socket, {
        type: "approval_required",
        version: 1,
        roomId,
        message: "Aguardando aprovacao do narrador para entrar na sala."
      });
      this.sendPendingPlayers(roomId);
      return;
    }

    const session: ClientSession = {
      roomId,
      joinedAt: current?.joinedAt || new Date().toISOString(),
      clientId,
      playerName,
      characterName: hello.characterName?.trim() || undefined,
      roomRole,
      ready: true,
      sheetActive: false
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
    if (roomRole === "host") {
      this.sendPendingPlayers(roomId);
    }
  }

  private async handlePlayerControl(
    socket: WebSocket,
    hostSession: Required<Pick<ClientSession, "roomId" | "joinedAt" | "clientId" | "playerName">> & ClientSession,
    message: PlayerControlMessage
  ): Promise<void> {
    if (hostSession.roomRole !== "host") {
      this.send(socket, errorMessage("host_required", "Apenas o narrador pode gerenciar jogadores."));
      return;
    }

    if (message.type === "approve_player") {
      await this.approvePendingPlayer(socket, hostSession.roomId, message.clientId);
      return;
    }

    if (message.type === "reject_player") {
      this.rejectPendingPlayer(socket, hostSession.roomId, message.clientId);
      return;
    }

    this.kickRoomPlayer(socket, hostSession.roomId, message.clientId, hostSession.clientId);
  }

  private async handleLeaveRoom(socket: WebSocket): Promise<void> {
    const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
    this.sessions.delete(socket);

    if (session?.ready && session.roomRole === "host") {
      await this.closeRoom(session.roomId);
      socket.close(1000, "leave_room");
      return;
    }

    if (session?.ready) {
      this.broadcastPresence(session.roomId);
    } else if (session?.roomId && session.clientId) {
      this.sendPendingPlayers(session.roomId);
    }

    socket.close(1000, "leave_room");
  }

  private async approvePendingPlayer(hostSocket: WebSocket, roomId: string, clientId: string): Promise<void> {
    const pendingSocket = this.findPendingSocket(roomId, clientId);
    const pendingSession = pendingSocket ? this.sessions.get(pendingSocket) ?? normalizeSession(pendingSocket.deserializeAttachment()) : undefined;
    if (!pendingSocket || !pendingSession?.clientId || !pendingSession.playerName) {
      this.send(hostSocket, errorMessage("pending_not_found", "Pedido de entrada nao encontrado."));
      this.sendPendingPlayers(roomId);
      return;
    }
    const approvedClientId = pendingSession.clientId;

    if (this.getReadyCount(roomId) >= maxRoomPlayers) {
      this.send(pendingSocket, errorMessage("room_full", `Sala cheia. O limite e de ${maxRoomPlayers} jogadores.`));
      pendingSocket.close(1008, "room_full");
      this.sessions.delete(pendingSocket);
      this.sendPendingPlayers(roomId);
      return;
    }

    const session: ClientSession = {
      ...pendingSession,
      joinedAt: new Date().toISOString(),
      requestedAt: undefined,
      roomRole: "player",
      ready: true
    };

    await this.markPlayerApproved(approvedClientId);
    this.sessions.set(pendingSocket, session);
    pendingSocket.serializeAttachment(session);
    this.send(pendingSocket, {
      type: "welcome",
      version: 1,
      roomId,
      clientId: approvedClientId,
      players: this.getPlayers(roomId),
      history: await this.getHistory()
    });
    this.broadcastPresence(roomId);
    this.sendPendingPlayers(roomId);
  }

  private rejectPendingPlayer(hostSocket: WebSocket, roomId: string, clientId: string): void {
    const pendingSocket = this.findPendingSocket(roomId, clientId);
    if (!pendingSocket) {
      this.send(hostSocket, errorMessage("pending_not_found", "Pedido de entrada nao encontrado."));
      this.sendPendingPlayers(roomId);
      return;
    }

    this.send(pendingSocket, errorMessage("approval_rejected", "O narrador recusou sua entrada na sala."));
    pendingSocket.close(1008, "approval_rejected");
    this.sessions.delete(pendingSocket);
    this.sendPendingPlayers(roomId);
  }

  private kickRoomPlayer(hostSocket: WebSocket, roomId: string, clientId: string, hostClientId: string): void {
    if (clientId === hostClientId) {
      this.send(hostSocket, errorMessage("invalid_kick", "Use Desconectar para fechar a sala."));
      return;
    }

    const targetSocket = this.findReadySocket(roomId, clientId);
    if (!targetSocket) {
      this.send(hostSocket, errorMessage("player_not_found", "Jogador nao encontrado na sala."));
      return;
    }

    this.send(targetSocket, errorMessage("kicked", "Voce foi removido da sala pelo narrador."));
    targetSocket.close(1008, "kicked");
    this.sessions.delete(targetSocket);
    void this.unmarkPlayerApproved(clientId);
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

  private handleViewStatus(socket: WebSocket, message: ViewStatusMessage): void {
    const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
    if (!session?.ready || !session.roomId) {
      return;
    }

    const wasActive = session.sheetActive === true;
    const nextSession: ClientSession = {
      ...session,
      sheetActive: message.active,
      sheetSeenAt: message.active ? message.reportedAt : session.sheetSeenAt
    };
    this.sessions.set(socket, nextSession);
    socket.serializeAttachment(nextSession);

    if (wasActive !== message.active) {
      this.broadcastPresence(session.roomId);
    }
  }

  private sendPendingPlayers(roomId: string): void {
    const hostSocket = this.findHostSocket(roomId);
    if (!hostSocket) {
      return;
    }

    this.send(hostSocket, {
      type: "pending_players",
      version: 1,
      roomId,
      pendingPlayers: this.getPendingPlayers(roomId)
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
        roomRole: session.roomRole ?? "player",
        joinedAt: session.joinedAt,
        sheetStatus: session.sheetActive === true ? "active" : "offline",
        sheetSeenAt: session.sheetSeenAt
      });
    }

    return players;
  }

  private getPendingPlayers(roomId: string): PendingPlayer[] {
    const players: PendingPlayer[] = [];

    for (const socket of this.ctx.getWebSockets()) {
      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (session?.ready || session?.roomId !== roomId || !session.clientId || !session.playerName) {
        continue;
      }

      players.push({
        clientId: session.clientId,
        playerName: session.playerName,
        characterName: session.characterName,
        requestedAt: session.requestedAt || session.joinedAt
      });
    }

    return players;
  }

  private hasRoomHost(roomId: string, except?: WebSocket): boolean {
    return Boolean(this.findHostSocket(roomId, except));
  }

  private findHostSocket(roomId: string, except?: WebSocket): WebSocket | undefined {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) {
        continue;
      }

      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (session?.ready && session.roomId === roomId && session.roomRole === "host") {
        return socket;
      }
    }

    return undefined;
  }

  private findReadySocket(roomId: string, clientId: string): WebSocket | undefined {
    for (const socket of this.ctx.getWebSockets()) {
      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (session?.ready && session.roomId === roomId && session.clientId === clientId) {
        return socket;
      }
    }

    return undefined;
  }

  private findPendingSocket(roomId: string, clientId: string): WebSocket | undefined {
    for (const socket of this.ctx.getWebSockets()) {
      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (!session?.ready && session?.roomId === roomId && session.clientId === clientId) {
        return socket;
      }
    }

    return undefined;
  }

  private replacePendingPlayer(roomId: string, clientId: string, nextSocket: WebSocket): void {
    const existingSocket = this.findPendingSocket(roomId, clientId);
    if (!existingSocket || existingSocket === nextSocket) {
      return;
    }

    this.send(existingSocket, errorMessage("approval_replaced", "Um novo pedido de entrada substituiu este."));
    existingSocket.close(1001, "approval_replaced");
    this.sessions.delete(existingSocket);
  }

  private replaceReadyPlayer(roomId: string, clientId: string, nextSocket: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === nextSocket) {
        continue;
      }

      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (!session?.ready || session.roomId !== roomId || session.clientId !== clientId) {
        continue;
      }

      this.send(socket, errorMessage("session_replaced", "Uma nova conexao substituiu esta sessao."));
      socket.close(1001, "session_replaced");
      this.sessions.delete(socket);
    }
  }

  private getReadyCount(roomId: string, except?: WebSocket): number {
    let count = 0;

    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) {
        continue;
      }

      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (session?.ready && session.roomId === roomId) {
        count += 1;
      }
    }

    return count;
  }

  private getReadySession(socket: WebSocket): Required<Pick<ClientSession, "roomId" | "joinedAt" | "clientId" | "playerName">> &
    ClientSession | undefined {
    const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
    if (!session?.ready || !session.clientId || !session.playerName) {
      return undefined;
    }

    return session as Required<Pick<ClientSession, "roomId" | "joinedAt" | "clientId" | "playerName">> & ClientSession;
  }

  private async isPlayerApproved(clientId: string): Promise<boolean> {
    const approved = await this.getApprovedPlayers();
    return approved.includes(clientId);
  }

  private async markPlayerApproved(clientId: string): Promise<void> {
    const approved = new Set(await this.getApprovedPlayers());
    approved.add(clientId);
    await this.ctx.storage.put(approvedStorageKey, [...approved].slice(-maxRoomPlayers * 4));
  }

  private async unmarkPlayerApproved(clientId: string): Promise<void> {
    const approved = new Set(await this.getApprovedPlayers());
    approved.delete(clientId);
    await this.ctx.storage.put(approvedStorageKey, [...approved]);
  }

  private async getApprovedPlayers(): Promise<string[]> {
    const approved = await this.ctx.storage.get<string[]>(approvedStorageKey);
    return Array.isArray(approved) ? approved.filter((clientId) => typeof clientId === "string") : [];
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

  private async closeRoom(roomId: string): Promise<void> {
    this.clearHostGraceTimer();
    for (const socket of this.ctx.getWebSockets()) {
      const session = this.sessions.get(socket) ?? normalizeSession(socket.deserializeAttachment());
      if (session?.roomId !== roomId) {
        continue;
      }

      this.send(socket, errorMessage("room_closed", "O narrador saiu e a sala foi desfeita."));
      this.sessions.delete(socket);
      socket.close(1001, "room_closed");
    }

    await this.ctx.storage.delete(historyStorageKey);
    await this.ctx.storage.delete(approvedStorageKey);
  }

  private scheduleHostGraceRoomClose(roomId: string, hostClientId: string): void {
    this.clearHostGraceTimer();
    this.hostGraceClientId = hostClientId;
    this.hostGraceTimer = setTimeout(() => {
      this.hostGraceTimer = undefined;
      this.hostGraceClientId = "";
      void this.closeRoom(roomId);
    }, hostReconnectGraceMs);
    this.broadcastPresence(roomId);
  }

  private clearHostGraceTimer(): void {
    if (this.hostGraceTimer) {
      clearTimeout(this.hostGraceTimer);
      this.hostGraceTimer = undefined;
    }
    this.hostGraceClientId = "";
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
    (message.roomRole === undefined || message.roomRole === "host" || message.roomRole === "player") &&
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

function isPlayerControlMessage(value: unknown): value is PlayerControlMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<PlayerControlMessage>;
  return (
    (message.type === "approve_player" || message.type === "reject_player" || message.type === "kick_player") &&
    message.version === protocolVersion &&
    isBoundedString(message.clientId, 8, 120)
  );
}

function isLeaveRoomMessage(value: unknown): value is LeaveRoomMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<LeaveRoomMessage>;
  return message.type === "leave_room" && message.version === protocolVersion;
}

function isHeartbeatMessage(value: unknown): value is HeartbeatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<HeartbeatMessage>;
  return message.type === "heartbeat" && message.version === protocolVersion && typeof message.createdAt === "string";
}

function isViewStatusMessage(value: unknown): value is ViewStatusMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ViewStatusMessage>;
  return (
    message.type === "view_status" &&
    message.version === protocolVersion &&
    typeof message.active === "boolean" &&
    typeof message.reportedAt === "string" &&
    !Number.isNaN(Date.parse(message.reportedAt))
  );
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
  const dieFace = die.face;
  return (
    (die.kind === "regular" || die.kind === "hunger" || die.kind === "unknown") &&
    typeof dieValue === "number" &&
    Number.isInteger(dieValue) &&
    dieValue >= 1 &&
    dieValue <= 100 &&
    (dieSides === undefined || (typeof dieSides === "number" && Number.isInteger(dieSides) && dieSides >= 2 && dieSides <= 100)) &&
    (dieFace === undefined || dieFace === "blank" || dieFace === "success" || dieFace === "critical" || dieFace === "skull")
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
  return isMultiPartRollTitle(title) || isSingleTraitRollTitle(title) || /^custom(?:[ \t]*\([ \t]*re-?roll[ \t]*\))?$/i.test(title);
}

function isMultiPartRollTitle(value: string): boolean {
  const parts = stripRerollTitleSuffix(value).split("+").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 && parts.every(isTraitTitlePart);
}

function isSingleTraitRollTitle(value: string): boolean {
  const title = stripRerollTitleSuffix(value);
  if (!isTraitTitlePart(title) || isMultiPartRollTitle(title)) {
    return false;
  }

  return !/^(ADD DICE TO ROLL|ATTRIBUTES|CLEAR|COTERIE|CUSTOM|DETAILS|DETAILED|DICE POOL|DISCIPLINES|EXPAND|FLAWS|GAME RULES|GROUPS|HEALTH|HUNGER|INVENTORY|LIBRARY|LOCAL|MENTAL|MERITS|NOTES|PHYSICAL|RE-ROLL|REROLL|ROLL|SELECT DICE TO REROLL|SKILLS|SOCIAL|SUCCESSES?|SUCCESS)$/i.test(
    title
  );
}

function isTraitTitlePart(value: string): boolean {
  return /^[A-Z][A-Z '-]{1,50}$/i.test(value.trim());
}

function stripRerollTitleSuffix(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[ \t]*\([ \t]*re-?roll[ \t]*\)$/i, "").trim();
}

function normalizeRoomId(value: string | null): string | undefined {
  const roomId = value?.trim();
  return roomId && /^[a-f0-9]{32}$/.test(roomId) ? roomId : undefined;
}

function normalizeRelayKey(value: unknown): string | undefined {
  const key = typeof value === "string" ? value.trim() : "";
  return key || undefined;
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
    requestedAt: typeof session.requestedAt === "string" ? session.requestedAt : undefined,
    clientId: typeof session.clientId === "string" ? session.clientId : undefined,
    playerName: typeof session.playerName === "string" ? session.playerName : undefined,
    characterName: typeof session.characterName === "string" ? session.characterName : undefined,
    roomRole: session.roomRole === "host" ? "host" : "player",
    ready: session.ready === true,
    sheetActive: session.sheetActive === true,
    sheetSeenAt: typeof session.sheetSeenAt === "string" ? session.sheetSeenAt : undefined
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

function errorMessage(code: string, message: string, rollId?: string): ServerMessage {
  return rollId ? { type: "error", version: 1, code, message, rollId } : { type: "error", version: 1, code, message };
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
  const roomLimit = maxRoomPlayers;
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
      <p>Se este relay estiver protegido, informe tambem a chave do relay na extensao. Cada sala aceita ate ${roomLimit} jogadores conectados.</p>
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
