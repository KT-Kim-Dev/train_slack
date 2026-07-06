import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Node.js major 버전 → NODE_MODULE_VERSION (ABI) */
const NODE_ABI_MAP = {
  "20": "115",
  "22": "127",
  "24": "137",
};

export function nodeAbiFromVersion(nodeVersion) {
  const major = nodeVersion.split(".")[0];
  return NODE_ABI_MAP[major] ?? "115";
}

/** Windows PE(MZ) 바이너리 여부 확인 */
export function isPeFile(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  return buf[0] === 0x4d && buf[1] === 0x5a;
}

/** better_sqlite3.node 경로 탐색 */
export function findBetterSqlite3Node(appDir) {
  const direct = path.join(appDir, "node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  if (fs.existsSync(direct)) return direct;

  const prebuilds = path.join(appDir, "node_modules/better-sqlite3/prebuilds");
  if (fs.existsSync(prebuilds)) {
    for (const name of fs.readdirSync(prebuilds)) {
      if (name.includes("win32")) {
        const p = path.join(prebuilds, name, "better_sqlite3.node");
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

/**
 * GitHub prebuild에서 win32-x64 better_sqlite3.node 를 직접 받아 배치한다.
 * macOS에서 npm cross-install 시 darwin 바이너리가 들어가는 문제를 우회한다.
 */
export async function ensureBetterSqlite3Win32(appDir, nodeAbi) {
  const BS3_VERSION = "12.11.1";
  // v12.11.1 GitHub release 에 있는 node ABI 목록 (win32-x64)
  const AVAILABLE_ABI = ["127", "137", "141", "147"];
  const abi = AVAILABLE_ABI.includes(nodeAbi) ? nodeAbi : "127";

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const cacheDir = path.join(root, ".cache");
  const tarPath = path.join(cacheDir, `better-sqlite3-v${BS3_VERSION}-node-v${abi}-win32-x64.tar.gz`);
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BS3_VERSION}/better-sqlite3-v${BS3_VERSION}-node-v${abi}-win32-x64.tar.gz`;

  await fsp.mkdir(cacheDir, { recursive: true });
  if (!fs.existsSync(tarPath)) {
    console.log("[package-server] better-sqlite3 win32 prebuild 다운로드…");
    execSync(`curl -fsSL "${url}" -o "${tarPath}"`, { stdio: "inherit" });
  }

  const tmpDir = path.join(cacheDir, "bs3-extract");
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await fsp.mkdir(tmpDir, { recursive: true });
  execSync(`tar -xzf "${tarPath}" -C "${tmpDir}"`, { stdio: "inherit" });

  let nodeFile = path.join(tmpDir, "better_sqlite3.node");
  if (!fs.existsSync(nodeFile)) {
    const found = execSync(`find "${tmpDir}" -name "better_sqlite3.node"`, { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    if (!found) throw new Error("prebuild tar 에서 better_sqlite3.node 를 찾지 못했습니다.");
    nodeFile = found;
  }

  const releaseDir = path.join(appDir, "node_modules/better-sqlite3/build/Release");
  const prebuildDir = path.join(appDir, "node_modules/better-sqlite3/prebuilds/win32-x64");
  await fsp.mkdir(releaseDir, { recursive: true });
  await fsp.mkdir(prebuildDir, { recursive: true });
  await fsp.copyFile(nodeFile, path.join(releaseDir, "better_sqlite3.node"));
  await fsp.copyFile(nodeFile, path.join(prebuildDir, "better_sqlite3.node"));

  const prebuildsRoot = path.join(appDir, "node_modules/better-sqlite3/prebuilds");
  if (fs.existsSync(prebuildsRoot)) {
    for (const name of fs.readdirSync(prebuildsRoot)) {
      if (!name.includes("win32")) {
        await fsp.rm(path.join(prebuildsRoot, name), { recursive: true, force: true });
      }
    }
  }

  if (!isPeFile(path.join(releaseDir, "better_sqlite3.node"))) {
    throw new Error("배치된 better_sqlite3.node 가 Windows PE 형식이 아닙니다.");
  }
  console.log("[package-server] better-sqlite3 win32-x64 native 모듈 배치 완료");
}
