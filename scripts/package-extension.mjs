import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";

const root = process.cwd();
const distDir = path.join(root, "extension", "dist");
const firefoxDistDir = path.join(root, "extension", "dist-firefox");
const artifactsDir = path.join(root, "artifacts");
const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
const chromiumOutputPath = path.join(artifactsDir, `demiplane-dice-room-${manifest.version}-chromium.zip`);
const firefoxOutputPath = path.join(artifactsDir, `demiplane-dice-room-${manifest.version}-firefox.zip`);

await mkdir(artifactsDir, { recursive: true });
await rm(chromiumOutputPath, { force: true });
await rm(firefoxOutputPath, { force: true });
await rm(firefoxDistDir, { recursive: true, force: true });

await zipDirectory(distDir, chromiumOutputPath);

await cp(distDir, firefoxDistDir, { recursive: true });
await writeFile(
  path.join(firefoxDistDir, "manifest.json"),
  `${JSON.stringify(createFirefoxManifest(manifest), null, 2)}\n`
);
await zipDirectory(firefoxDistDir, firefoxOutputPath);

console.log(`Created ${path.relative(root, chromiumOutputPath)}`);
console.log(`Created ${path.relative(root, firefoxOutputPath)}`);

async function zipDirectory(sourceDir, outputPath) {
  const output = createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);
  archive.directory(sourceDir, false);
  await archive.finalize();
  await done;
}

function createFirefoxManifest(chromiumManifest) {
  return {
    ...chromiumManifest,
    background: {
      scripts: ["background.js"],
      type: "module"
    },
    browser_specific_settings: {
      gecko: {
        id: "demiplane-dice-room@local",
        strict_min_version: "109.0"
      }
    }
  };
}
