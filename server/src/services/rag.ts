import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deleteDocumentChunksExcept,
  getKnowledgeStats,
  listKnowledgeEmbeddings,
  upsertKnowledgeChunk,
} from "../db/knowledge.js";
import { getSettings, updateSettings } from "../db/settings.js";
import { logger } from "../logger.js";
import { embedText } from "./embeddings.js";
import { IntegrationError } from "./ollama.js";

const DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".memo"]);
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export interface RagSyncResult {
  filesProcessed: number;
  chunksIndexed: number;
  chunksRemoved: number;
  errors: string[];
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

/** 질문과 유사한 지식 조각을 검색해 프롬프트용 텍스트로 반환한다 */
export async function retrieveRagContext(query: string): Promise<string | null> {
  const settings = getSettings();
  if (!settings.rag_enabled) return null;

  const chunks = listKnowledgeEmbeddings();
  if (chunks.length === 0) return null;

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
}

/** AI Q&A를 지식 베이스에 저장한다 */
export async function indexQaPair(question: string, answer: string): Promise<void> {
  const settings = getSettings();
  if (!settings.rag_enabled || !settings.rag_auto_learn) return;

  const q = question.trim();
  const a = answer.trim();
  if (!q || !a || a.startsWith("⚠️")) return;

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
}

async function collectDocumentFiles(rootDir: string): Promise<{ absolutePath: string; relativePath: string }[]> {
  const result: { absolutePath: string; relativePath: string }[] = [];

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
      result.push({
        absolutePath,
        relativePath: path.relative(rootDir, absolutePath).replace(/\\/g, "/"),
      });
    }
  }

  await walk(rootDir);
  return result;
}

/** 관리자가 지정한 문서 폴더를 읽어 RAG 지식 베이스에 반영한다 */
export async function syncSharedFolder(folderPath?: string): Promise<RagSyncResult> {
  const settings = getSettings();
  const folder = (folderPath ?? settings.rag_shared_folder).trim();
  if (!folder) {
    throw new IntegrationError("문서 폴더 경로가 설정되지 않았습니다.");
  }

  let stat;
  try {
    stat = await fs.stat(folder);
  } catch {
    throw new IntegrationError(`폴더를 찾을 수 없습니다: ${folder}`);
  }
  if (!stat.isDirectory()) {
    throw new IntegrationError("지정한 경로가 폴더가 아닙니다.");
  }

  const files = await collectDocumentFiles(folder);
  const activeKeys = new Set<string>();
  const errors: string[] = [];
  let chunksIndexed = 0;

  for (const file of files) {
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

  const chunksRemoved = deleteDocumentChunksExcept(activeKeys);
  updateSettings({ rag_last_sync_at: new Date().toISOString() });
  logger.info("RAG 문서 폴더 동기화 완료", {
    folder,
    filesProcessed: files.length,
    chunksIndexed,
    chunksRemoved,
    errorCount: errors.length,
  });

  return {
    filesProcessed: files.length,
    chunksIndexed,
    chunksRemoved,
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
    sharedFolder: settings.rag_shared_folder,
    lastSyncAt: settings.rag_last_sync_at || null,
  };
}
