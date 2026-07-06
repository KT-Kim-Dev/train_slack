/**
 * Windows 서버 배포 패키지 생성.
 *
 * 산출물: release/Intra-Chat-Server-{version}-win.zip
 *   - node.exe (포터블 Node.js, 별도 설치 불필요)
 *   - start-server.bat / create-user.bat
 *   - app/dist + app/node_modules (win32 x64)
 *
 * macOS/Linux 에서도 크로스 패키징 가능 (better-sqlite3 win32 prebuild).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { buildServerDist } from "./lib/build-server-dist.mjs";
import {
  ensureBetterSqlite3Win32,
  findBetterSqlite3Node,
  isPeFile,
  nodeAbiFromVersion,
} from "./lib/ensure-win32-native.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(
  await fsp.readFile(path.join(ROOT, "package.json"), "utf8")
).version;
const NODE_VERSION = process.env.NODE_WIN_VERSION ?? "22.14.0";
const OUT_NAME = `Intra-Chat-Server-${VERSION}-win`;
const OUT_DIR = path.join(ROOT, "release", "server", OUT_NAME);
const CACHE_DIR = path.join(ROOT, ".cache", "node-win");
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

function log(msg) {
  console.log(`[package-server] ${msg}`);
}

async function downloadNodeExe(destPath) {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const zipPath = path.join(CACHE_DIR, NODE_ZIP);
  const extractedDir = path.join(CACHE_DIR, `node-v${NODE_VERSION}-win-x64`);

  if (!fs.existsSync(zipPath)) {
    log(`Node.js ${NODE_VERSION} win-x64 다운로드 중…`);
    execSync(`curl -fsSL "${NODE_URL}" -o "${zipPath}"`, { stdio: "inherit" });
  }
  if (!fs.existsSync(extractedDir)) {
    log("Node.js 압축 해제 중…");
    execSync(`unzip -qo "${zipPath}" -d "${CACHE_DIR}"`, { stdio: "inherit" });
  }
  await fsp.copyFile(path.join(extractedDir, "node.exe"), destPath);
}

async function copyTemplate(name, dest) {
  let content = await fsp.readFile(path.join(ROOT, "scripts/templates", name), "utf8");
  // Windows CMD 호환: CRLF 줄바꿈
  if (name.endsWith(".bat")) {
    content = content.replace(/\r?\n/g, "\r\n");
  }
  await fsp.writeFile(dest, content);
}

async function main() {
  log(`버전 ${VERSION} Windows 서버 패키지 생성`);

  // 이전 산출물 정리
  await fsp.rm(OUT_DIR, { recursive: true, force: true });
  const appDir = path.join(OUT_DIR, "app");
  const distDir = path.join(appDir, "dist");
  await fsp.mkdir(distDir, { recursive: true });
  await fsp.mkdir(path.join(appDir, "data"), { recursive: true });
  await fsp.mkdir(path.join(appDir, "uploads"), { recursive: true });
  await fsp.mkdir(path.join(appDir, "logs"), { recursive: true });

  // 1) TypeScript → dist 번들
  log("서버 소스 빌드 (esbuild)…");
  await buildServerDist(distDir);

  // 2) Windows x64 런타임 의존성 설치
  log("Windows x64 node_modules 설치 중…");
  await fsp.copyFile(
    path.join(ROOT, "scripts/templates/server-runtime-package.json"),
    path.join(appDir, "package.json")
  );
  execSync("npm install --omit=dev --no-audit --no-fund --os=win32 --cpu=x64", {
    cwd: appDir,
    stdio: "inherit",
  });

  // macOS cross-install 시 darwin .node 가 들어가는 문제 → GitHub prebuild로 win32 바이너리 강제 배치
  log("better-sqlite3 Windows native 모듈 배치…");
  await ensureBetterSqlite3Win32(appDir, nodeAbiFromVersion(NODE_VERSION));
  const sqliteNode = findBetterSqlite3Node(appDir);
  if (!sqliteNode || !isPeFile(sqliteNode)) {
    throw new Error("better_sqlite3.node Windows PE 검증 실패");
  }
  log(`native 모듈 검증 OK: ${path.basename(sqliteNode)} (PE/MZ)`);

  // 3) 설정 파일
  await fsp.copyFile(path.join(ROOT, "server/.env.example"), path.join(appDir, ".env.example"));
  // 배포용 기본 CORS: Electron 클라이언트 file/custom origin 허용
  let envExample = await fsp.readFile(path.join(appDir, ".env.example"), "utf8");
  envExample = envExample.replace(
    "CORS_ORIGIN=http://localhost:5173",
    "CORS_ORIGIN=*"
  );
  await fsp.writeFile(path.join(appDir, ".env.example"), envExample);

  // 4) 포터블 node.exe + 실행 스크립트
  log("포터블 node.exe 포함…");
  await downloadNodeExe(path.join(OUT_DIR, "node.exe"));
  await copyTemplate("start-server.bat", path.join(OUT_DIR, "start-server.bat"));
  await copyTemplate("create-user.bat", path.join(OUT_DIR, "create-user.bat"));
  await copyTemplate("SERVER-README.txt", path.join(OUT_DIR, "README.txt"));

  // 5) ZIP
  const zipPath = path.join(ROOT, "release", "server", `${OUT_NAME}.zip`);
  log(`ZIP 생성: ${zipPath}`);
  execSync(`cd "${path.join(ROOT, "release", "server")}" && zip -rq "${OUT_NAME}.zip" "${OUT_NAME}"`, {
    stdio: "inherit",
  });

  const stat = fs.statSync(zipPath);
  log(`완료: ${zipPath} (${Math.round(stat.size / 1024 / 1024)} MB)`);
  log(`Windows PC에 압축 해제 후 start-server.bat 실행`);
}

main().catch((err) => {
  console.error("[package-server] 실패:", err);
  process.exit(1);
});
