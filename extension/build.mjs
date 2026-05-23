import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import esbuild from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  copyFile("public/manifest.json", "dist/manifest.json"),
  copyFile("public/popup.html", "dist/popup.html"),
  copyFile("public/popup.css", "dist/popup.css"),
  cp("public/assets", "dist/assets", { recursive: true, force: true })
]);

const common = {
  bundle: true,
  target: ["chrome116"],
  define: {
    __DICE_ROOM_DEFAULT_RELAY__: JSON.stringify(
      process.env.DICE_ROOM_DEFAULT_RELAY || "wss://demiplane-dice-room-relay.foxbyron.workers.dev"
    ),
    __DICE_ROOM_DEFAULT_RELAY_KEY__: JSON.stringify(process.env.DICE_ROOM_DEFAULT_RELAY_KEY || "")
  },
  sourcemap: true,
  logLevel: "info"
};

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ["src/background.ts"],
    outfile: "dist/background.js",
    format: "esm"
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/content.ts"],
    outfile: "dist/content.js",
    format: "iife"
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/pageBridge.ts"],
    outfile: "dist/page-bridge.js",
    format: "iife"
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/popup.ts"],
    outfile: "dist/popup.js",
    format: "iife"
  })
]);
