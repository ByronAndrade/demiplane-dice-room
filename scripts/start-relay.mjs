import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, stat, unlink } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = path.join(root, ".tools");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const localCloudflaredPath = path.join(toolsDir, `cloudflared${executableSuffix}`);
const port = process.env.PORT ?? "8787";
const statusUrl = `http://localhost:${port}`;
const tunnelEnabled = process.env.DICE_ROOM_TUNNEL !== "0";
const adminToken = randomUUID();
const childProcesses = new Set();

await ensureDependencies();
await run(npmCommand, ["run", "build:server"]);

const server = trackProcess(
  spawn(npmCommand, ["run", "start:server"], {
    cwd: root,
    env: {
      ...process.env,
      DICE_ROOM_ADMIN_TOKEN: adminToken,
      HOST: process.env.HOST ?? "0.0.0.0",
      PORT: port
    },
    stdio: "inherit"
  })
);

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.on("exit", (code) => {
  stopChildrenExcept(server);
  process.exit(code ?? 0);
});

await waitForStatusPage();
await maybeStartTunnel();
openStatusPage();

console.log("");
console.log("Relay pronto. A pagina de status abriu no navegador.");
console.log(`Status: ${statusUrl}`);
if (tunnelEnabled) {
  console.log("O tunel publico pode levar alguns segundos para aparecer na pagina.");
}
console.log("Mantenha esta janela aberta durante a sessao.");

async function ensureDependencies() {
  if (existsSync(path.join(root, "node_modules", "ws"))) {
    return;
  }

  console.log("Instalando dependencias do projeto...");
  await run(npmCommand, ["install"]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} terminou com codigo ${code}`));
    });
  });
}

async function maybeStartTunnel() {
  if (!tunnelEnabled) {
    console.log("Tunel publico desativado por DICE_ROOM_TUNNEL=0.");
    return;
  }

  console.log("");
  console.log("Criando tunel publico temporario para jogadores fora da sua rede...");

  let cloudflaredCommand = "";
  try {
    cloudflaredCommand = await resolveCloudflaredCommand();
  } catch (error) {
    console.log(`Nao foi possivel preparar o tunel publico: ${getErrorMessage(error)}`);
    console.log("O relay local continua ativo. Use um servidor online ou instale cloudflared para tunel automatico.");
    return;
  }

  const tunnel = trackProcess(
    spawn(cloudflaredCommand, ["tunnel", "--url", `http://localhost:${port}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    })
  );

  let registeredUrl = "";
  const handleOutput = (data) => {
    const text = data.toString("utf8");
    const tunnelUrl = parseTryCloudflareUrl(text);

    if (tunnelUrl && tunnelUrl !== registeredUrl) {
      registeredUrl = tunnelUrl;
      const relayUrl = tunnelUrl.replace(/^https:/, "wss:");
      registerPublicRelayUrl(relayUrl)
        .then(() => {
          console.log("");
          console.log("Tunel publico pronto.");
          console.log(`Relay publico: ${relayUrl}`);
          console.log("Copie esse endereco para os jogadores que estao fora da sua rede.");
        })
        .catch((error) => {
          console.log(`Tunel criado, mas nao consegui registrar na pagina local: ${getErrorMessage(error)}`);
          console.log(`Relay publico: ${relayUrl}`);
        });
      return;
    }

    for (const line of text.split(/\r?\n/)) {
      if (/error|failed|unable/i.test(line)) {
        console.log(`cloudflared: ${line}`);
      }
    }
  };

  tunnel.stdout.on("data", handleOutput);
  tunnel.stderr.on("data", handleOutput);
  tunnel.on("exit", (code) => {
    if (!registeredUrl) {
      console.log(`O tunel publico terminou antes de ficar pronto (codigo ${code ?? 0}).`);
    }
  });
}

async function resolveCloudflaredCommand() {
  if (await commandWorks("cloudflared", ["--version"])) {
    return "cloudflared";
  }

  if (await fileExists(localCloudflaredPath)) {
    return localCloudflaredPath;
  }

  const downloadUrl = getCloudflaredDownloadUrl();
  if (!downloadUrl) {
    throw new Error(`plataforma sem download automatico (${process.platform}/${process.arch})`);
  }

  await mkdir(toolsDir, { recursive: true });
  console.log("Baixando cloudflared uma unica vez para abrir o tunel publico...");

  try {
    await downloadFile(downloadUrl, localCloudflaredPath);
    if (process.platform !== "win32") {
      await chmod(localCloudflaredPath, 0o755);
    }
  } catch (error) {
    await unlink(localCloudflaredPath).catch(() => {});
    throw error;
  }

  return localCloudflaredPath;
}

function getCloudflaredDownloadUrl() {
  if (process.platform === "linux" && process.arch === "x64") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64";
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
  }

  return "";
}

function downloadFile(url, targetPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("redirecionamentos demais ao baixar cloudflared"));
          return;
        }

        const nextUrl = new URL(response.headers.location, url).toString();
        downloadFile(nextUrl, targetPath, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`download retornou HTTP ${response.statusCode ?? 0}`));
        return;
      }

      const file = createWriteStream(targetPath);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
    request.setTimeout(30_000, () => {
      request.destroy(new Error("tempo esgotado ao baixar cloudflared"));
    });
  });
}

function commandWorks(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "ignore"
    });

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

function parseTryCloudflareUrl(text) {
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g);
  return match?.[0] ?? "";
}

function registerPublicRelayUrl(relayUrl) {
  const payload = JSON.stringify({ url: relayUrl });

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "localhost",
        port,
        path: "/admin/public-relay-url",
        method: "POST",
        headers: {
          "content-length": Buffer.byteLength(payload),
          "content-type": "application/json",
          "x-dice-room-admin-token": adminToken
        }
      },
      (response) => {
        response.resume();
        if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
          resolve();
          return;
        }

        reject(new Error(`registro retornou HTTP ${response.statusCode ?? 0}`));
      }
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function waitForStatusPage() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 8000) {
    if (await canReachStatusPage()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function canReachStatusPage() {
  return new Promise((resolve) => {
    const request = http.get(statusUrl, (response) => {
      response.resume();
      resolve((response.statusCode ?? 0) < 500);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function openStatusPage() {
  const opener = getOpenCommand(statusUrl);
  if (!opener) {
    return;
  }

  const child = spawn(opener.command, opener.args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function getOpenCommand(url) {
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (process.env.WSL_DISTRO_NAME) {
    return { command: "powershell.exe", args: ["-NoProfile", "-Command", `Start-Process '${url}'`] };
  }

  return { command: "xdg-open", args: [url] };
}

function trackProcess(child) {
  childProcesses.add(child);
  child.on("exit", () => childProcesses.delete(child));
  return child;
}

function shutdown(signal) {
  stopChildrenExcept();
  setTimeout(() => process.exit(0), 1200).unref();
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function stopChildrenExcept(except) {
  for (const child of childProcesses) {
    if (child === except || child.killed) {
      continue;
    }
    child.kill("SIGTERM");
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
