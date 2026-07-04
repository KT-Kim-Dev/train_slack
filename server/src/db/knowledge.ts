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

const upsertStmt = db.prepare(`
  INSERT INTO knowledge_chunks (source_type, source_key, title, content, embedding, updated_at)
  VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(source_type, source_key) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    embedding = excluded.embedding,
    updated_at = excluded.updated_at
`);

export function upsertKnowledgeChunk(params: {
  sourceType: KnowledgeSourceType;
  sourceKey: string;
  title: string | null;
  content: string;
  embedding: number[];
}): void {
  upsertStmt.run(
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
