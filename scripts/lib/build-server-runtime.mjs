/**
 * Windows 서버 배포용 런타임(dist + node_modules) 빌드.
 * 전체 설치·업데이트 패키지가 공통으로 사용한다.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildServerDist } from "./build-server-dist.mjs";
import {
  ensureBetterSqlite3Win32,
  findBetterSqlite3Node,
  isPeFile,
  nodeAbiFromVersion,
} from "./ensure-win32-native.mjs";

export async function buildServerRuntime(appDir, { root, nodeVersion, log = console.log }) {
  const distDir = path.join(appDir, "dist");
  await fsp.mkdir(distDir, { recursive: true });

  log("서버 소스 빌드 (esbuild)…");
  await buildServerDist(distDir);

  log("Windows x64 node_modules 설치 중…");
  await fsp.copyFile(
    path.join(root, "scripts/templates/server-runtime-package.json"),
    path.join(appDir, "package.json")
  );
  execSync("npm install --omit=dev --no-audit --no-fund --os=win32 --cpu=x64", {
    cwd: appDir,
    stdio: "inherit",
  });

  log("better-sqlite3 Windows native 모듈 배치…");
  await ensureBetterSqlite3Win32(appDir, nodeAbiFromVersion(nodeVersion));
  const sqliteNode = findBetterSqlite3Node(appDir);
  if (!sqliteNode || !isPeFile(sqliteNode)) {
    throw new Error("better_sqlite3.node Windows PE 검증 실패");
  }
  log(`native 모듈 검증 OK: ${path.basename(sqliteNode)} (PE/MZ)`);

  let envExample = await fsp.readFile(path.join(root, "server/.env.example"), "utf8");
  envExample = envExample.replace("CORS_ORIGIN=http://localhost:5173", "CORS_ORIGIN=*");
  await fsp.writeFile(path.join(appDir, ".env.example"), envExample);
}

export async function copyTemplate(root, name, dest) {
  let content = await fsp.readFile(path.join(root, "scripts/templates", name), "utf8");
  if (name.endsWith(".bat")) {
    content = content.replace(/\r?\n/g, "\r\n");
  }
  await fsp.writeFile(dest, content);
}

export async function downloadNodeExe({ cacheDir, nodeVersion, nodeUrl, nodeZip, destPath, log }) {
  await fsp.mkdir(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, nodeZip);
  const extractedDir = path.join(cacheDir, `node-v${nodeVersion}-win-x64`);

  if (!fs.existsSync(zipPath)) {
    log(`Node.js ${nodeVersion} win-x64 다운로드 중…`);
    execSync(`curl -fsSL "${nodeUrl}" -o "${zipPath}"`, { stdio: "inherit" });
  }
  if (!fs.existsSync(extractedDir)) {
    log("Node.js 압축 해제 중…");
    execSync(`unzip -qo "${zipPath}" -d "${cacheDir}"`, { stdio: "inherit" });
  }
  await fsp.copyFile(path.join(extractedDir, "node.exe"), destPath);
}

export function zipDirectory(releaseDir, folderName, zipFileName, log) {
  const zipPath = path.join(releaseDir, zipFileName);
  log(`ZIP 생성: ${zipPath}`);
  execSync(`cd "${releaseDir}" && zip -rq "${zipFileName}" "${folderName}"`, {
    stdio: "inherit",
  });
  const stat = fs.statSync(zipPath);
  log(`완료: ${zipPath} (${Math.round(stat.size / 1024 / 1024)} MB)`);
  return zipPath;
}
