/**
 * Windows 클라이언트 portable exe 빌드.
 *
 * 사전 준비:
 *   client/.env.production 에 VITE_SERVER_URL=http://<서버IP>:3000 설정
 *
 * 산출물: client/release/Intra-Chat-{version}-portable.exe
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;
const ENV_PROD = path.join(ROOT, "client/.env.production");
const ENV_EXAMPLE = path.join(ROOT, "client/.env.production.example");

function log(msg) {
  console.log(`[package-client] ${msg}`);
}

if (!fs.existsSync(ENV_PROD)) {
  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.error("[package-client] client/.env.production.example 이 없습니다.");
    process.exit(1);
  }
  fs.copyFileSync(ENV_EXAMPLE, ENV_PROD);
  log("client/.env.production 을 example 에서 생성했습니다.");
  log("⚠️  VITE_SERVER_URL 을 실제 서버 IP로 수정한 뒤 다시 빌드하는 것을 권장합니다.");
}

const envContent = fs.readFileSync(ENV_PROD, "utf8");
if (envContent.includes("192.168.1.100")) {
  log("⚠️  VITE_SERVER_URL 이 예시 IP(192.168.1.100)입니다. 배포 전 실제 서버 IP로 수정하세요.");
}

log("Electron 클라이언트 빌드 시작…");
execSync("npm run package:win -w client", { cwd: ROOT, stdio: "inherit" });

const exe = path.join(ROOT, "client/release", `Intra-Chat-${VERSION}-portable.exe`);
if (fs.existsSync(exe)) {
  const mb = Math.round(fs.statSync(exe).size / 1024 / 1024);
  fs.copyFileSync(
    path.join(ROOT, "scripts/templates/CLIENT-README.txt"),
    path.join(ROOT, "client/release", "README-CLIENT.txt")
  );
  log(`완료: ${exe} (${mb} MB)`);
  log(`안내: client/release/README-CLIENT.txt`);
} else {
  log("빌드는 끝났지만 exe 파일을 찾지 못했습니다. client/release/ 를 확인하세요.");
}
