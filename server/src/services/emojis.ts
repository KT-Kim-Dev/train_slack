import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { EmojiItem } from "@intra-chat/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";

const EMOJI_EXTENSIONS = new Set([".gif", ".jpg", ".jpeg", ".png", ".webp"]);

function isEmojiFile(name: string): boolean {
  return EMOJI_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function resolveEmojiSeedDir(): string | null {
  const candidates = [
    process.env.EMOJI_RESOURCE_DIR
      ? path.resolve(process.env.EMOJI_RESOURCE_DIR)
      : null,
    path.resolve(process.cwd(), "resource"),
    path.resolve(process.cwd(), "../resource"),
    path.resolve(process.cwd(), "../../resource"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return null;
}

/** resource/ 폴더의 기본 이모티콘을 emojis/builtin 에 복사한다 */
export async function seedBuiltinEmojis(): Promise<void> {
  const seedDir = resolveEmojiSeedDir();
  if (!seedDir) {
    logger.debug("이모티콘 seed 폴더(resource) 없음 — builtin 시드 생략");
    return;
  }

  await fsp.mkdir(config.emojisBuiltinDir, { recursive: true });
  const entries = await fsp.readdir(seedDir, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !isEmojiFile(entry.name)) continue;
    const src = path.join(seedDir, entry.name);
    const dest = path.join(config.emojisBuiltinDir, entry.name);
    try {
      const destStat = await fsp.stat(dest).catch(() => null);
      const srcStat = await fsp.stat(src);
      if (destStat && destStat.mtimeMs >= srcStat.mtimeMs && destStat.size === srcStat.size) {
        continue;
      }
      await fsp.copyFile(src, dest);
      copied++;
    } catch (err) {
      logger.warn("기본 이모티콘 복사 실패", {
        file: entry.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (copied > 0) {
    logger.info("기본 이모티콘 시드 완료", { copied, seedDir });
  }
}

function emojiUrl(category: "builtin" | "custom", fileName: string): string {
  return `/api/emojis/${category}/${encodeURIComponent(fileName)}`;
}

async function listEmojiDir(
  dir: string,
  category: "builtin" | "custom",
  uploadedBy: string | null
): Promise<EmojiItem[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && isEmojiFile(e.name))
      .map((e) => ({
        id: `${category}:${e.name}`,
        fileName: e.name,
        category,
        url: emojiUrl(category, e.name),
        uploadedBy,
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName, "ko"));
  } catch {
    return [];
  }
}

export async function listEmojis(): Promise<EmojiItem[]> {
  const [builtin, customFiles] = await Promise.all([
    listEmojiDir(config.emojisBuiltinDir, "builtin", null),
    listEmojiDir(config.emojisCustomDir, "custom", null),
  ]);
  return [...builtin, ...customFiles];
}

export function resolveEmojiPath(category: "builtin" | "custom", fileName: string): string | null {
  const safe = path.basename(fileName);
  if (!isEmojiFile(safe)) return null;
  const base = category === "builtin" ? config.emojisBuiltinDir : config.emojisCustomDir;
  const absolute = path.join(base, safe);
  if (!absolute.startsWith(base)) return null;
  if (!fs.existsSync(absolute)) return null;
  return absolute;
}

export function parseEmojiId(emojiId: string): { category: "builtin" | "custom"; fileName: string } | null {
  const idx = emojiId.indexOf(":");
  if (idx <= 0) return null;
  const category = emojiId.slice(0, idx);
  if (category !== "builtin" && category !== "custom") return null;
  const fileName = path.basename(emojiId.slice(idx + 1));
  if (!isEmojiFile(fileName)) return null;
  return { category, fileName };
}

export { isEmojiFile };
