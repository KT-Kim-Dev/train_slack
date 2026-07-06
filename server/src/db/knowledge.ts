import type { Statement } from "better-sqlite3";
import { db } from "./index.js";

export type KnowledgeSourceType = "qa" | "document";

export interface KnowledgeChunkRow {
  id: number;
  source_type: KnowledgeSourceType;
  source_key: string;
  title: string | null;
  content: string;
  embedding: string;
}

export interface KnowledgeStats {
  totalChunks: number;
  qaChunks: number;
  documentChunks: number;
}

// DB 초기화 이후 첫 호출 시 준비 (모듈 로드 시점에 테이블이 없을 수 있으므로 lazy)
let _upsertStmt: Statement | null = null;
function getUpsertStmt(): Statement {
  if (!_upsertStmt) {
    _upsertStmt = db.prepare(`
      INSERT INTO knowledge_chunks (source_type, source_key, title, content, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(source_type, source_key) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at
    `);
  }
  return _upsertStmt;
}

export function upsertKnowledgeChunk(params: {
  sourceType: KnowledgeSourceType;
  sourceKey: string;
  title: string | null;
  content: string;
  embedding: number[];
}): void {
  getUpsertStmt().run(
    params.sourceType,
    params.sourceKey,
    params.title,
    params.content,
    JSON.stringify(params.embedding)
  );
}

export function listKnowledgeEmbeddings(): {
  id: number;
  source_type: KnowledgeSourceType;
  title: string | null;
  content: string;
  embedding: number[];
}[] {
  const rows = db
    .prepare(
      `SELECT id, source_type, title, content, embedding FROM knowledge_chunks ORDER BY id ASC`
    )
    .all() as KnowledgeChunkRow[];

  return rows.map((row) => ({
    id: row.id,
    source_type: row.source_type,
    title: row.title,
    content: row.content,
    embedding: JSON.parse(row.embedding) as number[],
  }));
}

export function deleteDocumentChunksExcept(sourceKeys: Set<string>): number {
  const rows = db
    .prepare(`SELECT source_key FROM knowledge_chunks WHERE source_type = 'document'`)
    .all() as { source_key: string }[];

  const deleteStmt = db.prepare(
    `DELETE FROM knowledge_chunks WHERE source_type = 'document' AND source_key = ?`
  );
  let removed = 0;
  for (const row of rows) {
    if (!sourceKeys.has(row.source_key)) {
      deleteStmt.run(row.source_key);
      removed++;
    }
  }
  return removed;
}

/** 특정 문서 파일에 속한 모든 조각을 삭제한다 (source_key = "path#0", "path#1", …) */
export function deleteDocumentChunksForFile(relativePath: string): number {
  const result = db
    .prepare(
      `DELETE FROM knowledge_chunks WHERE source_type = 'document' AND source_key LIKE ?`
    )
    .run(`${relativePath}#%`);
  return result.changes;
}

/** 변경 없는 파일의 기존 조각 키 목록 (증분 동기화용) */
export function listDocumentChunkKeysForFile(relativePath: string): string[] {
  const rows = db
    .prepare(
      `SELECT source_key FROM knowledge_chunks WHERE source_type = 'document' AND source_key LIKE ?`
    )
    .all(`${relativePath}#%`) as { source_key: string }[];
  return rows.map((row) => row.source_key);
}

export function getKnowledgeStats(): KnowledgeStats {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM knowledge_chunks`).get() as { c: number };
  const qa = db
    .prepare(`SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_type = 'qa'`)
    .get() as { c: number };
  const doc = db
    .prepare(`SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_type = 'document'`)
    .get() as { c: number };
  return {
    totalChunks: total.c,
    qaChunks: qa.c,
    documentChunks: doc.c,
  };
}
