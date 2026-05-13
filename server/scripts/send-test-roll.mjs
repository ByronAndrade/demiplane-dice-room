import WebSocket from "ws";

const serverUrl = process.env.SERVER_URL ?? "ws://localhost:8787";
const channel = process.env.CHANNEL ?? "Rio_by_night";
const password = process.env.PASSWORD ?? "123";
const clientId = `simulator-${Date.now()}`;

const socket = new WebSocket(serverUrl);

socket.on("open", () => {
  socket.send(
    JSON.stringify({
      type: "hello",
      version: 1,
      clientId,
      playerName: "Codex Simulator",
      characterName: "Teste remoto",
      channel,
      password
    })
  );
});

socket.on("message", (data) => {
  const message = JSON.parse(data.toString());

  if (message.type !== "welcome") {
    return;
  }

  socket.send(
    JSON.stringify({
      type: "roll",
      version: 1,
      roll: {
        type: "roll",
        version: 1,
        id: `simulated-roll-${Date.now()}`,
        clientId,
        playerName: "Codex Simulator",
        characterName: "Teste remoto",
        source: "demiplane",
        system: "vampire",
        rollTitle: "Strength + Athletics",
        successes: 3,
        total: null,
        dice: [
          { kind: "regular", value: 10, sides: 10 },
          { kind: "regular", value: 8, sides: 10 },
          { kind: "hunger", value: 1, sides: 10 }
        ],
        rawText: "Strength + Athletics\nSUCCESSES: 3\n10 8 1",
        createdAt: new Date().toISOString()
      }
    })
  );

  console.log(`Sent simulated roll to channel "${channel}" on ${serverUrl}.`);
  socket.close();
});

socket.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
