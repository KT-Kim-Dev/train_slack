import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import {
  deleteDocumentChunksExcept,
  deleteDocumentChunksForFile,
  getKnowledgeStats,
  listDocumentChunkKeysForFile,
  listKnowledgeEmbeddings,
  upsertKnowledgeChunk,
} from "../db/knowledge.js";
import { getRawSetting, getSettings, setRawSetting, updateSettings } from "../db/settings.js";
import { logger } from "../logger.js";
import { embedText } from "./embeddings.js";
import { IntegrationError } from "./ollama.js";

const DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".memo"]);
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const SNAPSHOT_KEY = "rag_file_snapshot";

export interface RagSyncResult {
  filesProcessed: number;
  filesUpdated: number;
  filesSkipped: number;
  chunksIndexed: number;
  chunksRemoved: number;
  errors: string[];
}

interface FileSnapshot {
  mtimeMs: number;
  size: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 긴 문서를 RAG용 조각으로 분할한다 */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= CHUNK_SIZE) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + CHUNK_SIZE, normalized.length);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("。")
      );
      if (breakAt > CHUNK_SIZE * 0.4) end = start + breakAt + 1;
    }
    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

/** 질문과 유사한 지식 조각을 검색해 프롬프트용 텍스트로 반환한다. 실패·데이터 없음 시 null (AI 응답에는 영향 없음) */
export async function retrieveRagContext(query: string): Promise<string | null> {
  const settings = getSettings();
  if (!settings.rag_enabled) return null;
  if (!settings.ollama_url.trim()) return null;

  const chunks = listKnowledgeEmbeddings();
  if (chunks.length === 0) return null;

  try {
    const queryEmbedding = await embedText(query);
    const ranked = chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.rag_top_k)
      .filter((item) => item.score > 0.2);

    if (ranked.length === 0) return null;

    return ranked
      .map(({ chunk, score }, index) => {
        const label = chunk.title ? `[${chunk.title}]` : `[지식 ${index + 1}]`;
        return `${label} (유사도 ${(score * 100).toFixed(0)}%)\n${chunk.content}`;
      })
      .join("\n\n---\n\n");
  } catch (err) {
    logger.debug("RAG 참고 지식 검색 생략 (AI 응답은 정상 진행)", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** AI Q&A를 지식 베이스에 저장한다. 임베딩 실패 시 조용히 생략 */
export async function indexQaPair(question: string, answer: string): Promise<void> {
  const settings = getSettings();
  if (!settings.rag_enabled || !settings.rag_auto_learn) return;
  if (!settings.ollama_url.trim()) return;

  const q = question.trim();
  const a = answer.trim();
  if (!q || !a || a.startsWith("⚠️")) return;

  try {
    const content = `질문: ${q}\n답변: ${a}`;
    const sourceKey = createHash("sha256").update(content).digest("hex").slice(0, 32);
    const embedding = await embedText(content);
    upsertKnowledgeChunk({
      sourceType: "qa",
      sourceKey,
      title: `Q&A: ${q.slice(0, 40)}${q.length > 40 ? "…" : ""}`,
      content,
      embedding,
    });
  } catch (err) {
    logger.debug("RAG Q&A 학습 생략", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

async function collectDocumentFiles(
  rootDir: string
): Promise<{ absolutePath: string; relativePath: string; mtimeMs: number; size: number }[]> {
  const result: { absolutePath: string; relativePath: string; mtimeMs: number; size: number }[] =
    [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!DOCUMENT_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(absolutePath);
      result.push({
        absolutePath,
        relativePath: path.relative(rootDir, absolutePath).replace(/\\/g, "/"),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  await walk(rootDir);
  return result;
}

function loadFileSnapshot(): Map<string, FileSnapshot> {
  const raw = getRawSetting(SNAPSHOT_KEY);
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, FileSnapshot>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveFileSnapshot(snapshot: Map<string, FileSnapshot>): void {
  const obj = Object.fromEntries(snapshot.entries());
  setRawSetting(SNAPSHOT_KEY, JSON.stringify(obj));
}

/** 증분 동기화 스냅샷에서 항목을 제거해 다음 sync 시 재색인되게 한다 */
export function invalidateRagSnapshotEntry(relativePath: string): void {
  const snapshot = loadFileSnapshot();
  if (snapshot.delete(relativePath)) {
    saveFileSnapshot(snapshot);
  }
}

/**
 * 서버 RAG 폴더의 문서를 RAG 지식 베이스에 반영한다.
 * mtime/size 가 바뀐 파일만 재색인하고, 삭제된 파일 조각은 제거한다.
 */
export async function syncSharedFolder(): Promise<RagSyncResult> {
  const settings = getSettings();
  if (!settings.rag_enabled) {
    return {
      filesProcessed: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      chunksIndexed: 0,
      chunksRemoved: 0,
      errors: [],
    };
  }

  const folder = config.ragDocumentFolder;

  let stat;
  try {
    stat = await fs.stat(folder);
  } catch {
    logger.debug("RAG 폴더 없음 — 동기화 생략", { folder });
    return {
      filesProcessed: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      chunksIndexed: 0,
      chunksRemoved: 0,
      errors: [],
    };
  }
  if (!stat.isDirectory()) {
    logger.debug("RAG 경로가 폴더가 아님 — 동기화 생략", { folder });
    return {
      filesProcessed: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      chunksIndexed: 0,
      chunksRemoved: 0,
      errors: [],
    };
  }

  const files = await collectDocumentFiles(folder);

  if (!settings.ollama_url.trim()) {
    logger.debug("Ollama URL 미설정 — RAG 동기화 생략");
    return {
      filesProcessed: files.length,
      filesUpdated: 0,
      filesSkipped: files.length,
      chunksIndexed: 0,
      chunksRemoved: 0,
      errors: [],
    };
  }

  const prevSnapshot = loadFileSnapshot();
  const nextSnapshot = new Map<string, FileSnapshot>();
  const activeKeys = new Set<string>();
  const errors: string[] = [];
  let filesUpdated = 0;
  let filesSkipped = 0;
  let chunksIndexed = 0;
  let chunksRemoved = 0;

  for (const file of files) {
    const snap: FileSnapshot = { mtimeMs: file.mtimeMs, size: file.size };
    nextSnapshot.set(file.relativePath, snap);

    const prev = prevSnapshot.get(file.relativePath);
    const unchanged =
      prev !== undefined && prev.mtimeMs === snap.mtimeMs && prev.size === snap.size;

    if (unchanged) {
      filesSkipped++;
      for (const key of listDocumentChunkKeysForFile(file.relativePath)) {
        activeKeys.add(key);
      }
      continue;
    }

    filesUpdated++;
    chunksRemoved += deleteDocumentChunksForFile(file.relativePath);

    try {
      const text = await fs.readFile(file.absolutePath, "utf8");
      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        const sourceKey = `${file.relativePath}#${i}`;
        activeKeys.add(sourceKey);
        const embedding = await embedText(chunks[i]);
        upsertKnowledgeChunk({
          sourceType: "document",
          sourceKey,
          title: file.relativePath,
          content: chunks[i],
          embedding,
        });
        chunksIndexed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      errors.push(`${file.relativePath}: ${message}`);
    }
  }

  for (const [relativePath] of prevSnapshot) {
    if (!nextSnapshot.has(relativePath)) {
      chunksRemoved += deleteDocumentChunksForFile(relativePath);
    }
  }

  chunksRemoved += deleteDocumentChunksExcept(activeKeys);
  saveFileSnapshot(nextSnapshot);
  updateSettings({ rag_last_sync_at: new Date().toISOString() });

  logger.info("RAG 문서 폴더 동기화 완료", {
    folder,
    filesProcessed: files.length,
    filesUpdated,
    filesSkipped,
    chunksIndexed,
    chunksRemoved,
    errorCount: errors.length,
  });

  return {
    filesProcessed: files.length,
    filesUpdated,
    filesSkipped,
    chunksRemoved,
    chunksIndexed,
    errors,
  };
}

export function getRagStats() {
  const stats = getKnowledgeStats();
  const settings = getSettings();
  return {
    ...stats,
    ragEnabled: settings.rag_enabled,
    ragAutoLearn: settings.rag_auto_learn,
    sharedFolder: config.ragDocumentFolder,
    lastSyncAt: settings.rag_last_sync_at || null,
  };
}
