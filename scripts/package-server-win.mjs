/**
 * Windows 서버 배포 패키지 생성.
 *
 * 산출물:
 *   1) release/server/Intra-Chat-Server-{version}-win.zip       — 최초 설치용
 *   2) release/server/Intra-Chat-Server-{version}-update-win.zip — 데이터 유지 업데이트용
 *
 * macOS/Linux 에서도 크로스 패키징 가능 (better-sqlite3 win32 prebuild).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildServerRuntime,
  copyTemplate,
  downloadNodeExe,
  zipDirectory,
} from "./lib/build-server-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(
  await fsp.readFile(path.join(ROOT, "package.json"), "utf8")
).version;
const NODE_VERSION = process.env.NODE_WIN_VERSION ?? "22.14.0";
const FULL_NAME = `Intra-Chat-Server-${VERSION}-win`;
const UPDATE_NAME = `Intra-Chat-Server-${VERSION}-update-win`;
const RELEASE_DIR = path.join(ROOT, "release", "server");
const STAGING_DIR = path.join(RELEASE_DIR, ".staging-runtime");
const CACHE_DIR = path.join(ROOT, ".cache", "node-win");
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

function log(msg) {
  console.log(`[package-server] ${msg}`);
}

async function writeVersionFile(dir) {
  const content = [
    `Intra-Chat Server ${VERSION}`,
    `Built: ${new Date().toISOString()}`,
    `Node: ${NODE_VERSION}`,
  ].join("\r\n");
  await fsp.writeFile(path.join(dir, "VERSION.txt"), content);
}

async function buildSharedRuntime() {
  await fsp.rm(STAGING_DIR, { recursive: true, force: true });
  const appDir = path.join(STAGING_DIR, "app");
  await fsp.mkdir(appDir, { recursive: true });

  await buildServerRuntime(appDir, { root: ROOT, nodeVersion: NODE_VERSION, log });
  await downloadNodeExe({
    cacheDir: CACHE_DIR,
    nodeVersion: NODE_VERSION,
    nodeUrl: NODE_URL,
    nodeZip: NODE_ZIP,
    destPath: path.join(STAGING_DIR, "node.exe"),
    log,
  });
}

async function copyRuntimeTree(destAppDir, includeNodeExe, destRoot) {
  await fsp.cp(path.join(STAGING_DIR, "app"), destAppDir, { recursive: true });
  if (includeNodeExe) {
    await fsp.copyFile(path.join(STAGING_DIR, "node.exe"), path.join(destRoot, "node.exe"));
  }
}

async function copyEmojiResources(appDir) {
  const resourceDir = path.join(ROOT, "resource");
  if (!fs.existsSync(resourceDir)) return;
  const dest = path.join(appDir, "emojis", "builtin");
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(resourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (![".gif", ".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue;
    await fsp.copyFile(path.join(resourceDir, entry.name), path.join(dest, entry.name));
  }
}

async function assembleFullPackage() {
  const outDir = path.join(RELEASE_DIR, FULL_NAME);
  await fsp.rm(outDir, { recursive: true, force: true });
  const appDir = path.join(outDir, "app");
  await fsp.mkdir(path.join(appDir, "data"), { recursive: true });
  await fsp.mkdir(path.join(appDir, "uploads"), { recursive: true });
  await fsp.mkdir(path.join(appDir, "logs"), { recursive: true });

  await copyRuntimeTree(appDir, true, outDir);
  await copyEmojiResources(appDir);
  await copyTemplate(ROOT, "start-server.bat", path.join(outDir, "start-server.bat"));
  await copyTemplate(ROOT, "create-user.bat", path.join(outDir, "create-user.bat"));
  await copyTemplate(ROOT, "SERVER-README.txt", path.join(outDir, "README.txt"));
  await writeVersionFile(outDir);

  zipDirectory(RELEASE_DIR, FULL_NAME, `${FULL_NAME}.zip`, log);
}

async function assembleUpdatePackage() {
  const outDir = path.join(RELEASE_DIR, UPDATE_NAME);
  await fsp.rm(outDir, { recursive: true, force: true });
  const appDir = path.join(outDir, "app");
  await fsp.mkdir(appDir, { recursive: true });

  await copyRuntimeTree(appDir, true, outDir);
  await copyEmojiResources(appDir);
  await copyTemplate(ROOT, "update-server.bat", path.join(outDir, "update-server.bat"));
  await copyTemplate(ROOT, "start-server.bat", path.join(outDir, "start-server.bat"));
  await copyTemplate(ROOT, "create-user.bat", path.join(outDir, "create-user.bat"));
  await copyTemplate(ROOT, "SERVER-UPDATE-README.txt", path.join(outDir, "README.txt"));
  await writeVersionFile(outDir);

  zipDirectory(RELEASE_DIR, UPDATE_NAME, `${UPDATE_NAME}.zip`, log);
  log(`업데이트: update-server.bat "기존서버폴더경로" 로 데이터 유지 배포`);
}

async function main() {
  log(`버전 ${VERSION} Windows 서버 패키지 생성 (전체 + 업데이트)`);
  await buildSharedRuntime();
  await assembleFullPackage();
  await assembleUpdatePackage();
  await fsp.rm(STAGING_DIR, { recursive: true, force: true });
  log("전체 설치 ZIP → Windows PC에 압축 해제 후 start-server.bat");
}

main().catch((err) => {
  console.error("[package-server] 실패:", err);
  process.exit(1);
});
