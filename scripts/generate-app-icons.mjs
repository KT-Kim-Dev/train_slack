#!/usr/bin/env node
/**
 * ATEC 소스 이미지로 앱/트레이 아이콘(icon.png, tray-icon.png, icon.ico)을 생성한다.
 *
 * 사용법:
 *   node scripts/generate-app-icons.mjs [소스이미지경로]
 *
 * macOS: sips 사용. Windows ICO: Pillow(pip install pillow) 필요.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "client/build");
const defaultSource = join(root, "client/build/atec-icon-source.jpg");
const source = process.argv[2] ?? defaultSource;

if (!existsSync(source)) {
  console.error("소스 이미지를 찾을 수 없습니다:", source);
  process.exit(1);
}

const sourceJpg = join(buildDir, "icon-source.jpg");
const iconPng = join(buildDir, "icon.png");
const trayPng = join(buildDir, "tray-icon.png");
const iconIco = join(buildDir, "icon.ico");

execSync(`cp "${source}" "${sourceJpg}"`);
execSync(`sips -s format png "${sourceJpg}" --out "${iconPng}"`);
execSync(`sips -z 512 512 "${iconPng}" --out "${iconPng}"`);
execSync(`sips -z 32 32 "${iconPng}" --out "${trayPng}"`);

for (const size of [16, 32, 48, 64, 128, 256]) {
  execSync(`sips -z ${size} ${size} "${iconPng}" --out "${join(buildDir, `icon-${size}.png`)}"`);
}

const py = `
from PIL import Image
from pathlib import Path
build = Path("${buildDir}")
img = Image.open(build / "icon.png").convert("RGBA")
sizes = [(256,256), (128,128), (64,64), (48,48), (32,32), (16,16)]
icons = [img.resize(s, Image.Resampling.LANCZOS) for s in sizes]
icons[0].save(build / "icon.ico", format="ICO", sizes=[(s.width, s.height) for s in icons])
print("icon.ico created")
`;
execSync(`python3 -c ${JSON.stringify(py)}`);

console.log("Generated:", iconPng, trayPng, iconIco);
