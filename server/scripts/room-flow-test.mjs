import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import WebSocket from "ws";

const externalServerUrl = process.env.SERVER_URL?.trim();
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? String(19_000 + Math.floor(Math.random() * 20_000)), 10);
const serverUrl = externalServerUrl || `ws://${host}:${port}`;
const statusUrl = `http://${host}:${port}/health`;
const channel = process.env.CHANNEL ?? `room-flow-${Date.now()}`;
const password = process.env.PASSWORD ?? randomUUID();
const playerCount = Number.parseInt(process.env.PLAYER_COUNT ?? "3", 10);
const scenarioTimeoutMs = Number.parseInt(process.env.SCENARIO_TIMEOUT_MS ?? "30000", 10);
const clients = new Set();

let serverProcess;

async function main() {
  try {
    if (!externalServerUrl) {
      serverProcess = startLocalRelay();
      await waitForHealth();
    }

    await runScenario();
    console.log(`OK room flow simulation passed with ${playerCount} players on ${serverUrl}`);
  } finally {
    for (const client of clients) {
      client.close();
    }

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await Promise.race([once(serverProcess, "exit"), delay(1500)]);
    }
  }
}

function startLocalRelay() {
  const child = spawn(process.execPath, ["server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (data) => {
    if (process.env.VERBOSE_ROOM_FLOW) {
      process.stdout.write(`[relay] ${data}`);
    }
  });
  child.stderr.on("data", (data) => process.stderr.write(`[relay] ${data}`));
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`Relay exited unexpectedly with code ${code ?? signal}`);
    }
  });

  return child;
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const status = await getJson(statusUrl);
      if (status.ok === true) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(120);
  }

  throw new Error(`Relay did not become healthy at ${statusUrl}`);
}

async function runScenario() {
  const hostClient = await connectClient({
    clientId: `host-${randomUUID()}`,
    playerName: "Byron",
    characterName: "Narrador",
    roomRole: "host"
  });
  const hostWelcome = await hostClient.waitFor((message) => message.type === "welcome", "host welcome");
  assertEqual(hostWelcome.players.length, 1, "host starts alone in the room");

  const players = [];
  for (let index = 0; index < playerCount; index += 1) {
    const player = await connectClient({
      clientId: `player-${index + 1}-${randomUUID()}`,
      playerName: ["Pablo", "Mina", "Theo"][index] ?? `Player ${index + 1}`,
      characterName: ["Pablo", "Mina", "Theo"][index] ?? `Character ${index + 1}`,
      roomRole: "player"
    });
    players.push(player);
    await player.waitFor((message) => message.type === "approval_required", `${player.playerName} approval required`);
    const pending = await hostClient.waitFor(
      (message) => message.type === "pending_players" && message.pendingPlayers.some((item) => item.clientId === player.clientId),
      `${player.playerName} visible to host without refresh`
    );
    assert(pending.pendingPlayers.length >= 1, "host receives pending player list");
    hostClient.send({ type: "approve_player", version: 1, clientId: player.clientId });
    await player.waitFor((message) => message.type === "welcome", `${player.playerName} welcome after approval`);
  }

  await waitForPresenceCount([hostClient, ...players], playerCount + 1);
  for (const client of [hostClient, ...players]) {
    client.sendViewStatus(true);
  }
  await waitForSheetStatus([hostClient, ...players], players[0].clientId, "active", "players report open sheets");
  players[0].sendViewStatus(false);
  await waitForSheetStatus([hostClient, ...players], players[0].clientId, "offline", "closed sheet appears offline");
  players[0].sendViewStatus(true);
  await waitForSheetStatus([hostClient, ...players], players[0].clientId, "active", "reopened sheet appears active");

  const clearedPending = await hostClient.waitFor(
    (message) => message.type === "pending_players" && message.pendingPlayers.length === 0,
    "pending list clears after approvals"
  );
  assertEqual(clearedPending.pendingPlayers.length, 0, "pending requests clear after approval");

  const hostRoll = createRoll(hostClient, "host-strength", "STRENGTH + ATHLETICS", 2);
  hostClient.sendRoll(hostRoll);
  await waitForRoll([hostClient, ...players], hostRoll.id, "host roll reaches everyone");

  const sharedDiceGrab = createDiceControlEvent(hostRoll.id, 0, "grab", 1, 0.42, 0.58);
  players[0].sendDiceControl(sharedDiceGrab);
  await waitForDiceControl([hostClient, ...players], hostRoll.id, 0, "grab", players[0].clientId, "shared die grab reaches everyone");
  players[1].sendDiceControl(createDiceControlEvent(hostRoll.id, 0, "grab", 1, 0.2, 0.2));
  const sharedDiceMove = createDiceControlEvent(hostRoll.id, 0, "move", 2, 0.62, 0.32);
  players[0].sendDiceControl(sharedDiceMove);
  await waitForDiceControl([hostClient, ...players], hostRoll.id, 0, "move", players[0].clientId, "shared die move reaches everyone");
  players[0].sendDiceControl(createDiceControlEvent(hostRoll.id, 0, "release", 3, 0.64, 0.34));
  await waitForDiceControl([hostClient, ...players], hostRoll.id, 0, "release", players[0].clientId, "shared die release reaches everyone");

  if (playerCount < 9) {
    const latePlayer = await connectClient({
      clientId: `late-${randomUUID()}`,
      playerName: "Late",
      characterName: "Late",
      roomRole: "player"
    });
    players.push(latePlayer);
    await latePlayer.waitFor((message) => message.type === "approval_required", "late player approval required");
    const latePending = await hostClient.waitFor(
      (message) => message.type === "pending_players" && message.pendingPlayers.some((item) => item.clientId === latePlayer.clientId),
      "late player visible to host"
    );
    assert(latePending.pendingPlayers.length >= 1, "host receives late pending player");
    hostClient.send({ type: "approve_player", version: 1, clientId: latePlayer.clientId });
    const lateWelcome = await latePlayer.waitFor((message) => message.type === "welcome", "late player welcome");
    const activeDice = lateWelcome.activeDice ?? [];
    const activeHostRoll = activeDice.find((item) => item.roll?.id === hostRoll.id);
    assert(activeHostRoll, "late player receives active dice for recent roll");
    assert(
      activeHostRoll.controls?.some((event) => event.rollId === hostRoll.id && event.dieIndex === 0 && event.action === "release"),
      "late player receives latest shared die position"
    );
    await waitForPresenceCount([hostClient, ...players], players.length + 1);
  }

  hostClient.sendDiceClear();
  await waitForDiceClear([hostClient, ...players], hostClient.clientId, "host clears shared dice for everyone");

  const playerRoll = createRoll(players[0], "player-resolve", "RESOLVE + AWARENESS", 1);
  players[0].sendRoll(playerRoll);
  await waitForRoll([hostClient, ...players], playerRoll.id, "player roll reaches host and table");

  const ignoredRoll = createRoll(players[0], "ignored-dice-pool", "CUSTOM", null, {
    rawText: "CUSTOM\nDICE POOL\nREGULAR HUNGER\nADD DICE TO ROLL"
  });
  players[0].sendRoll(ignoredRoll);
  const ignoredError = await players[0].waitFor(
    (message) => message.type === "error" && message.code === "ignored_roll",
    "ignored roll error"
  );
  assertEqual(ignoredError.rollId, ignoredRoll.id, "ignored_roll includes the offending roll id");
  assertEqual(players[0].socket.readyState, WebSocket.OPEN, "ignored roll does not close player socket");

  const afterIgnoredRoll = createRoll(players[0], "after-ignored", "DEXTERITY + STEALTH", 3);
  players[0].sendRoll(afterIgnoredRoll);
  await waitForRoll([hostClient, ...players], afterIgnoredRoll.id, "player still publishes after ignored roll");

  const repeatedCustomRolls = [
    createRoll(players[1], "custom-repeat-1", "CUSTOM", 1, { rawText: "CUSTOM\nSUCCESS: 1\nDETAILS\n6" }),
    createRoll(players[1], "custom-repeat-2", "CUSTOM", 1, { rawText: "CUSTOM\nSUCCESS: 1\nDETAILS\n6" })
  ];
  for (const roll of repeatedCustomRolls) {
    players[1].sendRoll(roll);
  }
  await waitForRoll([hostClient, ...players], repeatedCustomRolls[0].id, "first repeated custom roll delivered");
  await waitForRoll([hostClient, ...players], repeatedCustomRolls[1].id, "second repeated custom roll delivered");

  const willpowerRoll = createRoll(players[0], "willpower", "WILLPOWER", 3);
  players[0].sendRoll(willpowerRoll);
  await waitForRoll([hostClient, ...players], willpowerRoll.id, "willpower roll reaches everyone");

  const humanityRoll = createRoll(players[1], "humanity", "HUMANITY", 4);
  players[1].sendRoll(humanityRoll);
  await waitForRoll([hostClient, ...players], humanityRoll.id, "humanity roll reaches everyone");

  const reconnectedPlayer = await reconnectClient(players[2]);
  players[2] = reconnectedPlayer;
  await waitForPresenceCount([hostClient, ...players], players.length + 1);
  const reconnectRoll = createRoll(reconnectedPlayer, "approved-reconnect", "WITS + TECHNOLOGY", 2);
  reconnectedPlayer.sendRoll(reconnectRoll);
  await waitForRoll([hostClient, ...players], reconnectRoll.id, "approved reconnected player can publish");

  const reconnectedHost = await reconnectClient(hostClient);
  await waitForPresenceCount([reconnectedHost, ...players], players.length + 1);
  const hostAfterReconnectRoll = createRoll(reconnectedHost, "host-reconnect", "CHARISMA + PERSUASION", 4);
  reconnectedHost.sendRoll(hostAfterReconnectRoll);
  await waitForRoll([reconnectedHost, ...players], hostAfterReconnectRoll.id, "host can publish after reconnect");

  const manualD10Roll = createManualD10Roll(players[0], "manual-d10", 10);
  assertEqual(manualD10Roll.dice[0].label, "0", "manual d10 displays zero on the ten face");
  players[0].sendRoll(manualD10Roll);
  await waitForRoll([reconnectedHost, ...players], manualD10Roll.id, "extension manual d10 reaches everyone");

  const hostAfterOfflineRoll = await verifyPlayerRollWhileHostOffline(reconnectedHost, players);
  const resumedHost = await reconnectRoomAfterEveryoneClosed(hostAfterOfflineRoll, players);
  const persistedApprovalRoll = createRoll(players[0], "persisted-approval", "STAMINA + SURVIVAL", 2);
  players[0].sendRoll(persistedApprovalRoll);
  await waitForRoll([resumedHost, ...players], persistedApprovalRoll.id, "approved player can publish after table resumes");

  await verifyDuplicateIdentityKick(resumedHost, players);

  resumedHost.send({ type: "leave_room", version: 1 });
  await Promise.all(
    players.map((player) =>
      player.waitFor((message) => message.type === "error" && message.code === "room_closed", `${player.playerName} room_closed`)
    )
  );
}

async function connectClient(identity) {
  const client = new RoomClient(identity);
  clients.add(client);
  await client.connect();
  return client;
}

async function reconnectClient(client) {
  client.close();
  clients.delete(client);
  const nextClient = await connectClient({
    clientId: client.clientId,
    playerName: client.playerName,
    characterName: client.characterName,
    roomRole: client.roomRole
  });
  await nextClient.waitFor((message) => message.type === "welcome", `${client.playerName} reconnect welcome`);
  return nextClient;
}

async function verifyDuplicateIdentityKick(hostClient, players) {
  const original = players[0];
  const duplicate = await connectClient({
    clientId: `duplicate-${randomUUID()}`,
    playerName: original.playerName,
    characterName: original.characterName,
    roomRole: "player"
  });
  await duplicate.waitFor((message) => message.type === "approval_required", "duplicate identity approval required");
  hostClient.send({ type: "approve_player", version: 1, clientId: duplicate.clientId });
  const welcome = await duplicate.waitFor((message) => message.type === "welcome", "duplicate identity welcome");
  assertEqual(welcome.players.length, players.length + 1, "duplicate visible identity does not inflate presence count");
  await waitForPresenceCount([hostClient, ...players, duplicate], players.length + 1);

  hostClient.send({ type: "kick_player", version: 1, clientId: duplicate.clientId });
  await Promise.all(
    [original, duplicate].map((client) =>
      client.waitFor((message) => message.type === "error" && message.code === "kicked", `${client.playerName} duplicate kicked`)
    )
  );
  players.splice(players.indexOf(original), 1);
  await waitForPresenceCount([hostClient, ...players], players.length + 1);
}

async function verifyPlayerRollWhileHostOffline(hostClient, players) {
  const hostIdentity = toIdentity(hostClient);
  hostClient.close();
  clients.delete(hostClient);
  await delay(250);

  const offlineHostRoll = createRoll(players[0], "host-offline-delivery", "MANIPULATION + SUBTERFUGE", 3);
  players[0].sendRoll(offlineHostRoll);
  await waitForRoll(players, offlineHostRoll.id, "player roll stays visible while host is offline");

  const resumedHost = await connectClient(hostIdentity);
  const welcome = await resumedHost.waitFor((message) => message.type === "welcome", "host returns after offline player roll");
  assert(
    welcome.history.some((roll) => roll.id === offlineHostRoll.id),
    "host receives offline player roll from room history"
  );
  await waitForPresenceCount([resumedHost, ...players], players.length + 1);
  return resumedHost;
}

async function reconnectRoomAfterEveryoneClosed(hostClient, players) {
  const hostIdentity = toIdentity(hostClient);
  const playerIdentities = players.map(toIdentity);
  closeClients([hostClient, ...players]);
  await delay(250);

  const resumedHost = await connectClient(hostIdentity);
  const hostWelcome = await resumedHost.waitFor((message) => message.type === "welcome", "persistent host welcome");
  assert(
    hostWelcome.history.some((roll) => roll.rollTitle === "1d10" && roll.source === "extension"),
    "persistent room preserves recent history"
  );

  const resumedPlayers = [];
  for (const identity of playerIdentities) {
    const player = await connectClient(identity);
    const welcome = await player.waitFor((message) => message.type === "welcome", `${player.playerName} persistent approval welcome`);
    assert(
      !welcome.pendingPlayers?.some((pending) => pending.clientId === player.clientId),
      `${player.playerName} does not return as pending after approval`
    );
    resumedPlayers.push(player);
  }

  players.splice(0, players.length, ...resumedPlayers);
  await waitForPresenceCount([resumedHost, ...players], players.length + 1);
  return resumedHost;
}

function closeClients(targetClients) {
  for (const client of targetClients) {
    client.close();
    clients.delete(client);
  }
}

function toIdentity(client) {
  return {
    clientId: client.clientId,
    playerName: client.playerName,
    characterName: client.characterName,
    roomRole: client.roomRole
  };
}

async function waitForPresenceCount(targetClients, expectedCount) {
  await Promise.all(
    targetClients.map((client) =>
      client.waitFor(
        (message) => message.type === "presence" && message.players.length === expectedCount,
        `${client.playerName} sees ${expectedCount} players`
      )
    )
  );
}

async function waitForRoll(targetClients, rollId, label) {
  await Promise.all(
    targetClients.map((client) =>
      client.waitFor(
        (message) => message.type === "roll" && message.roll.id === rollId,
        `${label}: ${client.playerName}`
      )
    )
  );
}

async function waitForDiceControl(targetClients, rollId, dieIndex, action, actorClientId, label) {
  await Promise.all(
    targetClients.map((client) =>
      client.waitFor(
        (message) =>
          message.type === "dice_control" &&
          message.event.rollId === rollId &&
          message.event.dieIndex === dieIndex &&
          message.event.action === action &&
          message.event.actorClientId === actorClientId,
        `${label}: ${client.playerName}`
      )
    )
  );
}

async function waitForDiceClear(targetClients, actorClientId, label) {
  await Promise.all(
    targetClients.map((client) =>
      client.waitFor(
        (message) => message.type === "dice_clear" && message.event.actorClientId === actorClientId,
        `${label}: ${client.playerName}`
      )
    )
  );
}

async function waitForSheetStatus(targetClients, clientId, sheetStatus, label) {
  await Promise.all(
    targetClients.map((client) =>
      client.waitFor(
        (message) =>
          message.type === "presence" &&
          message.players.some((player) => player.clientId === clientId && player.sheetStatus === sheetStatus),
        `${label}: ${client.playerName}`
      )
    )
  );
}

class RoomClient {
  constructor({ clientId, playerName, characterName, roomRole }) {
    this.clientId = clientId;
    this.playerName = playerName;
    this.characterName = characterName;
    this.roomRole = roomRole;
    this.messages = [];
    this.waiters = new Set();
  }

  async connect() {
    this.socket = new WebSocket(serverUrl);
    this.socket.on("message", (data) => this.handleMessage(data));
    this.socket.on("close", () => this.rejectWaiters(new Error(`${this.playerName} socket closed`)));
    this.socket.on("error", (error) => this.rejectWaiters(error));
    await once(this.socket, "open");
    this.send({
      type: "hello",
      version: 1,
      clientId: this.clientId,
      playerName: this.playerName,
      characterName: this.characterName,
      roomRole: this.roomRole,
      channel,
      password
    });
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.playerName} cannot send while socket is not open`);
    }
    this.socket.send(JSON.stringify(message));
  }

  sendRoll(roll) {
    this.send({ type: "roll", version: 1, roll });
  }

  sendViewStatus(active) {
    this.send({ type: "view_status", version: 1, active, reportedAt: new Date().toISOString() });
  }

  sendDiceControl(event) {
    this.send({ type: "dice_control", version: 1, event });
  }

  sendDiceClear() {
    this.send({ type: "dice_clear", version: 1, event: { createdAt: new Date().toISOString() } });
  }

  waitFor(predicate, label, timeoutMs = scenarioTimeoutMs) {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, label, timer: undefined };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for ${label}. Last messages: ${summarizeMessages(this.messages)}`));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  close() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }

  handleMessage(data) {
    const message = JSON.parse(data.toString("utf8"));
    this.messages.push(message);
    this.messages = this.messages.slice(-200);

    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(message)) {
        continue;
      }

      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  rejectWaiters(error) {
    for (const waiter of [...this.waiters]) {
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.reject(error);
    }
  }
}

function createRoll(client, suffix, title, successes, overrides = {}) {
  const id = `${client.clientId}:${suffix}:${Date.now()}:${randomUUID()}`;
  const dice = overrides.dice ?? [
    { kind: "regular", value: 10, sides: 10, face: "critical" },
    { kind: "regular", value: 8, sides: 10, face: "success" },
    { kind: "hunger", value: 2, sides: 10, face: "blank" }
  ];

  return {
    type: "roll",
    version: 1,
    id,
    clientId: client.clientId,
    playerName: client.playerName,
    characterName: client.characterName,
    source: "demiplane",
    system: "vampire",
    rollTitle: title,
    successes,
    total: null,
    dice,
    rawText: overrides.rawText ?? `${title}\nSUCCESSES: ${successes}\nDETAILS\n10 8 2`,
    createdAt: new Date().toISOString()
  };
}

function createManualD10Roll(client, suffix, value) {
  const label = value === 10 ? "0" : String(value);
  return {
    type: "roll",
    version: 1,
    id: `${client.clientId}:${suffix}:${Date.now()}:${randomUUID()}`,
    clientId: client.clientId,
    playerName: client.playerName,
    characterName: client.characterName,
    source: "extension",
    system: "generic",
    rollTitle: "1d10",
    successes: null,
    total: value,
    dice: [
      {
        kind: "regular",
        value,
        sides: 10,
        face: "blank",
        label
      }
    ],
    rawText: `1d10\nResult: ${label}`,
    createdAt: new Date().toISOString()
  };
}

function createDiceControlEvent(rollId, dieIndex, action, sequence, x, y) {
  return {
    action,
    rollId,
    dieIndex,
    sequence,
    x,
    y,
    z: 0,
    createdAt: new Date().toISOString()
  };
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${expected}, got ${actual}`);
  }
}

function summarizeMessages(messages) {
  return messages
    .slice(-8)
    .map((message) => {
      if (message.type === "roll") {
        return `roll:${message.roll?.id}`;
      }
      if (message.type === "error") {
        return `error:${message.code}:${message.rollId ?? ""}`;
      }
      if (message.type === "pending_players") {
        return `pending:${message.pendingPlayers?.length ?? 0}`;
      }
      if (message.type === "dice_clear") {
        return `dice_clear:${message.event?.actorClientId ?? ""}`;
      }
      if (message.type === "presence") {
        return `presence:${message.players?.length ?? 0}`;
      }
      return message.type;
    })
    .join(", ");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(3000, () => {
      request.destroy(new Error(`Timed out requesting ${url}`));
    });
  });
}

await main();
