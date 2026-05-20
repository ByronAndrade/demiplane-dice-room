import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import {
  clientMessageSchema,
  type HelloMessage,
  type PresencePlayer,
  type RollEvent,
  type ServerMessage
} from "./protocol.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "0.0.0.0";
const maxMessageBytes = 64 * 1024;
const maxRoomHistory = 100;
const maxRoomPlayers = 20;
const adminToken = process.env.DICE_ROOM_ADMIN_TOKEN ?? "";
const relayAccessKey = process.env.DICE_ROOM_RELAY_KEY?.trim() ?? "";
let runtimePublicRelayUrl = "";

type Client = {
  socket: WebSocket;
  clientId: string;
  playerName: string;
  characterName?: string;
  roomRole: "host" | "player";
  roomId: string;
  joinedAt: string;
};

const rooms = new Map<string, Set<Client>>();
const roomHistories = new Map<string, RollEvent[]>();

const heartbeatInterval = setInterval(() => {
  const createdAt = new Date().toISOString();
  for (const roomId of rooms.keys()) {
    broadcast(roomId, {
      type: "heartbeat",
      version: 1,
      roomId,
      createdAt
    });
  }
}, 25_000);
heartbeatInterval.unref();

const httpServer = createServer((request, response) => {
  void handleHttpRequest(request, response).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 500, { ok: false, error: "internal_error" });
    } else {
      response.end();
    }
  });
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket, request) => {
  let client: Client | undefined;

  if (!hasValidRelayAccessKey(request)) {
    send(socket, errorMessage("relay_key_required", "Este relay exige uma chave de acesso."));
    socket.close(1008, "relay_key_required");
    return;
  }

  socket.on("message", (data) => {
    const raw = data.toString("utf8");

    if (Buffer.byteLength(raw, "utf8") > maxMessageBytes) {
      send(socket, errorMessage("message_too_large", "Mensagem maior que o limite aceito."));
      return;
    }

    const json = parseJson(raw);
    if (!json.ok) {
      send(socket, errorMessage("invalid_json", "Mensagem nao e um JSON valido."));
      return;
    }

    const parsed = clientMessageSchema.safeParse(json.value);
    if (!parsed.success) {
      send(socket, errorMessage("invalid_message", "Mensagem fora do formato esperado."));
      return;
    }

    if (parsed.data.type === "hello") {
      client = joinRoom(socket, parsed.data, client);
      return;
    }

    if (!client) {
      send(socket, errorMessage("not_joined", "Envie hello antes de publicar rolagens."));
      return;
    }

    const roll = normalizeRoll(parsed.data.roll, client);
    if (!isUsefulRoll(roll)) {
      send(socket, errorMessage("ignored_roll", "Rolagem ignorada porque nao parece ser um resultado completo."));
      return;
    }

    appendHistory(client.roomId, roll);
    broadcast(client.roomId, { type: "roll", version: 1, roomId: client.roomId, roll }, client);
  });

  socket.on("close", () => {
    if (client) {
      leaveRoom(client);
      client = undefined;
    }
  });

  socket.on("error", () => {
    if (client) {
      leaveRoom(client);
      client = undefined;
    }
  });
});

httpServer.listen(port, host, () => {
  console.log("Demiplane Dice Room relay is online.");
  console.log(`Status: http://localhost:${port}`);
  for (const relayUrl of getRelayUrls()) {
    console.log(`Relay:  ${relayUrl}`);
  }
});

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if ((requestUrl.pathname === "/" || requestUrl.pathname === "/status") && request.method === "GET") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderStatusPage());
    return;
  }

  if (requestUrl.pathname === "/health" && request.method === "GET") {
    sendJson(response, 200, getHealthPayload());
    return;
  }

  if (requestUrl.pathname === "/admin/public-relay-url" && request.method === "POST") {
    await handlePublicRelayUrlRequest(request, response);
    return;
  }

  sendJson(response, 404, { ok: false, error: "not_found" });
}

async function handlePublicRelayUrlRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!adminToken || request.headers["x-dice-room-admin-token"] !== adminToken) {
    sendJson(response, 403, { ok: false, error: "forbidden" });
    return;
  }

  let rawBody = "";
  try {
    rawBody = await readRequestBody(request);
  } catch {
    sendJson(response, 413, { ok: false, error: "request_body_too_large" });
    return;
  }
  const json = parseJson(rawBody);
  if (!json.ok || !json.value || typeof json.value !== "object" || !("url" in json.value)) {
    sendJson(response, 400, { ok: false, error: "invalid_body" });
    return;
  }

  const url = String(json.value.url).trim();
  if (!isValidRelayUrl(url)) {
    sendJson(response, 400, { ok: false, error: "invalid_relay_url" });
    return;
  }

  runtimePublicRelayUrl = url;
  console.log(`Public relay: ${url}`);
  sendJson(response, 200, { ok: true, relays: getRelayUrls() });
}

function getHealthPayload(): { ok: true; rooms: number; players: number; relays: string[]; accessKeyRequired: boolean; roomLimit: number } {
  return {
    ok: true,
    rooms: rooms.size,
    players: getTotalPlayers(),
    relays: getRelayUrls(),
    accessKeyRequired: Boolean(relayAccessKey),
    roomLimit: maxRoomPlayers
  };
}

function joinRoom(socket: WebSocket, hello: HelloMessage, previous?: Client): Client | undefined {
  if (previous) {
    leaveRoom(previous);
  }

  const roomId = createRoomId(hello.channel, hello.password);
  const room = rooms.get(roomId) ?? new Set<Client>();
  if (room.size >= maxRoomPlayers) {
    send(socket, errorMessage("room_full", `Sala cheia. O limite e de ${maxRoomPlayers} jogadores.`));
    socket.close(1008, "room_full");
    return undefined;
  }

  if (hello.roomRole === "host" && hasRoomHost(roomId)) {
    send(socket, errorMessage("room_host_exists", "Esta sala ja tem um narrador conectado."));
    socket.close(1008, "room_host_exists");
    return undefined;
  }

  const client: Client = {
    socket,
    clientId: hello.clientId,
    playerName: hello.playerName,
    characterName: hello.characterName || undefined,
    roomRole: hello.roomRole,
    roomId,
    joinedAt: new Date().toISOString()
  };

  room.add(client);
  rooms.set(roomId, room);

  send(client.socket, {
    type: "welcome",
    version: 1,
    roomId,
    clientId: client.clientId,
    players: getPlayers(roomId),
    history: getHistory(roomId)
  });

  broadcastPresence(roomId);
  return client;
}

function leaveRoom(client: Client): void {
  const room = rooms.get(client.roomId);
  if (!room) {
    return;
  }

  if (client.roomRole === "host") {
    closeRoom(client.roomId);
    return;
  }

  room.delete(client);

  if (room.size === 0) {
    rooms.delete(client.roomId);
    return;
  }

  broadcastPresence(client.roomId);
}

function closeRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  for (const client of room) {
    send(client.socket, errorMessage("room_closed", "O narrador saiu e a sala foi desfeita."));
    client.socket.close(1001, "room_closed");
  }

  rooms.delete(roomId);
  roomHistories.delete(roomId);
}

function broadcastPresence(roomId: string): void {
  broadcast(roomId, {
    type: "presence",
    version: 1,
    roomId,
    players: getPlayers(roomId)
  });
}

function broadcast(roomId: string, message: ServerMessage, except?: Client): void {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  for (const client of room) {
    if (except && client === except) {
      continue;
    }
    send(client.socket, message);
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function hasValidRelayAccessKey(request: IncomingMessage): boolean {
  if (!relayAccessKey) {
    return true;
  }

  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  return requestUrl.searchParams.get("key") === relayAccessKey;
}

function getPlayers(roomId: string): PresencePlayer[] {
  const room = rooms.get(roomId);
  if (!room) {
    return [];
  }

  return [...room].map((client) => ({
    clientId: client.clientId,
    playerName: client.playerName,
    characterName: client.characterName,
    roomRole: client.roomRole,
    joinedAt: client.joinedAt
  }));
}

function hasRoomHost(roomId: string): boolean {
  const room = rooms.get(roomId);
  return Boolean(room && [...room].some((client) => client.roomRole === "host"));
}

function normalizeRoll(roll: RollEvent, client: Client): RollEvent {
  return {
    ...roll,
    clientId: client.clientId,
    playerName: client.playerName,
    characterName: roll.characterName || client.characterName
  };
}

function appendHistory(roomId: string, roll: RollEvent): void {
  const history = roomHistories.get(roomId) ?? [];
  if (history.some((item) => item.id === roll.id)) {
    return;
  }

  history.push(roll);
  roomHistories.set(roomId, history.slice(-maxRoomHistory));
}

function getHistory(roomId: string): RollEvent[] {
  return roomHistories.get(roomId) ?? [];
}

function getTotalPlayers(): number {
  let total = 0;
  for (const room of rooms.values()) {
    total += room.size;
  }
  return total;
}

function getRelayUrls(): string[] {
  const urls = new Set<string>();
  const publicRelayUrl = process.env.PUBLIC_RELAY_URL?.trim();

  if (runtimePublicRelayUrl) {
    urls.add(runtimePublicRelayUrl);
  }

  if (publicRelayUrl) {
    urls.add(publicRelayUrl);
  }

  urls.add(`ws://localhost:${port}`);

  for (const networkInterface of Object.values(networkInterfaces())) {
    for (const address of networkInterface ?? []) {
      if (address.internal || address.family !== "IPv4") {
        continue;
      }

      urls.add(`ws://${address.address}:${port}`);
    }
  }

  return [...urls];
}

function renderStatusPage(): string {
  const relayRows = getRelayUrls()
    .map(
      (relayUrl) => `
        <li data-relay-row${isPublicRelayUrl(relayUrl) ? ' data-public="true"' : ""}>
          <code>${escapeHtml(relayUrl)}</code>
          <span>${escapeHtml(getRelayLabel(relayUrl))}</span>
          <button type="button" data-copy="${escapeHtml(relayUrl)}">Copiar</button>
        </li>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demiplane Dice Room Relay</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111418;
        color: #f3f6fb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 28px;
        background: #111418;
      }

      main {
        max-width: 760px;
        margin: 0 auto;
      }

      .panel {
        border: 1px solid #303844;
        border-radius: 8px;
        padding: 20px;
        background: #171c23;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      }

      h1 {
        margin: 0 0 6px;
        font-size: 28px;
      }

      p {
        color: #b7c1d0;
        line-height: 1.55;
      }

      .status {
        display: inline-flex;
        align-items: center;
        border: 1px solid #2f7255;
        border-radius: 999px;
        padding: 6px 10px;
        color: #bdf4d2;
        background: #183526;
        font-weight: 800;
      }

      ul {
        display: grid;
        gap: 10px;
        padding: 0;
        list-style: none;
      }

      li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 10px;
        border: 1px solid #29313d;
        border-radius: 7px;
        padding: 10px;
        background: #11161d;
      }

      li[data-public="true"] {
        border-color: #2f7255;
        background: linear-gradient(90deg, rgba(29, 82, 55, 0.35), #11161d 45%);
      }

      code {
        overflow-wrap: anywhere;
        color: #f7f9fc;
        font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      }

      li span {
        border: 1px solid #384251;
        border-radius: 999px;
        padding: 5px 8px;
        color: #b7c1d0;
        background: #1d242d;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }

      li[data-public="true"] span {
        border-color: #2f7255;
        color: #bdf4d2;
        background: #183526;
      }

      button {
        flex: 0 0 auto;
        border: 1px solid #384251;
        border-radius: 6px;
        padding: 7px 10px;
        color: #f3f6fb;
        background: #252c36;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
      }

      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 18px 0;
      }

      .stat {
        border: 1px solid #29313d;
        border-radius: 7px;
        padding: 10px 12px;
        background: #11161d;
      }

      .stat strong {
        display: block;
        font-size: 22px;
      }

      .help {
        margin-top: 18px;
        border-top: 1px solid #29313d;
        padding-top: 16px;
      }

      @media (max-width: 640px) {
        body {
          padding: 14px;
        }

        li {
          grid-template-columns: 1fr;
          align-items: stretch;
        }

        li span,
        button {
          justify-self: start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <span class="status">Relay online</span>
        <h1>Demiplane Dice Room</h1>
        <p>Use o endereco publico no campo Relay da extensao quando os jogadores estiverem fora da sua rede. Se o tunel ainda estiver subindo, esta pagina atualiza sozinha quando o <code>wss://...</code> aparecer.</p>

        <div class="stats">
          <div class="stat"><strong id="room-count">${rooms.size}</strong> salas ativas</div>
          <div class="stat"><strong id="player-count">${getTotalPlayers()}</strong> jogadores conectados</div>
          <div class="stat"><strong>${maxRoomPlayers}</strong> limite por sala</div>
          <div class="stat"><strong>${relayAccessKey ? "Sim" : "Nao"}</strong> chave exigida</div>
        </div>

        <h2>Enderecos do relay</h2>
        <ul id="relay-list">${relayRows}</ul>

        <div class="help">
          <p>O endereco <code>ws://localhost:${port}</code> serve para testar nesta maquina. Para a mesa online, prefira o endereco publico <code>wss://...</code>. Se este relay exigir chave, informe tambem a chave do relay na extensao.</p>
        </div>
      </section>
    </main>
    <script>
      const relayList = document.querySelector("#relay-list");
      const roomCount = document.querySelector("#room-count");
      const playerCount = document.querySelector("#player-count");

      document.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-copy]");
        if (!button) return;
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "Copiado";
        setTimeout(() => {
          button.textContent = "Copiar";
        }, 1200);
      });

      async function refreshStatus() {
        try {
          const response = await fetch("/health", { cache: "no-store" });
          if (!response.ok) return;
          const status = await response.json();
          roomCount.textContent = String(status.rooms ?? 0);
          playerCount.textContent = String(status.players ?? 0);
          renderRelays(Array.isArray(status.relays) ? status.relays : []);
        } catch {
        }
      }

      function renderRelays(relays) {
        relayList.replaceChildren(...relays.map((relay) => {
          const row = document.createElement("li");
          const code = document.createElement("code");
          const label = document.createElement("span");
          const button = document.createElement("button");
          const relayText = String(relay);

          row.dataset.relayRow = "";
          if (isPublicRelay(relayText)) {
            row.dataset.public = "true";
          }
          code.textContent = relayText;
          label.textContent = getRelayLabel(relayText);
          button.type = "button";
          button.dataset.copy = relayText;
          button.textContent = "Copiar";

          row.append(code, label, button);
          return row;
        }));
      }

      function isPublicRelay(relay) {
        return relay.startsWith("wss://") || relay.includes("trycloudflare.com");
      }

      function getRelayLabel(relay) {
        if (relay.includes("localhost") || relay.includes("127.0.0.1")) return "local";
        if (isPublicRelay(relay)) return "publico";
        return "rede";
      }

      refreshStatus();
      setInterval(refreshStatus, 2000);
    </script>
  </body>
</html>`;
}

function getRelayLabel(relayUrl: string): string {
  if (relayUrl.includes("localhost") || relayUrl.includes("127.0.0.1")) {
    return "local";
  }

  if (isPublicRelayUrl(relayUrl)) {
    return "publico";
  }

  return "rede";
}

function isPublicRelayUrl(relayUrl: string): boolean {
  return relayUrl.startsWith("wss://") || relayUrl.includes("trycloudflare.com");
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

function createRoomId(channel: string, password = ""): string {
  return createHash("sha256")
    .update(channel.trim().toLowerCase())
    .update("\0")
    .update(password)
    .digest("hex")
    .slice(0, 32);
}

function errorMessage(code: string, message: string): ServerMessage {
  return { type: "error", version: 1, code, message };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (Buffer.byteLength(body, "utf8") > maxMessageBytes) {
        request.destroy();
        reject(new Error("request_body_too_large"));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function isValidRelayUrl(value: string): boolean {
  if (value.length > 500) {
    return false;
  }

  try {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
