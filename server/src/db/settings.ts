/**
 * 통합 연동 설정을 DB에 저장/조회한다.
 * 서버 재시작 없이 관리자 UI에서 즉시 반영되도록,
 * 서비스 레이어는 매 호출마다 이 함수로 설정을 읽는다.
 * DB 값이 없으면 환경변수(env)를 폴백으로 사용한다.
 */

import { db } from "./index.js";

export interface IntegrationSettings {
  ollama_url: string;
  ollama_model: string;
  ollama_timeout_ms: number;
  ai_context_limit: number;
  ai_reply_language: "ko" | "en" | "auto";
  ai_extra_instructions: string;
  ai_show_reasoning: boolean;
  rag_enabled: boolean;
  rag_auto_learn: boolean;
  rag_embedding_model: string;
  rag_top_k: number;
  rag_shared_folder: string;
  rag_last_sync_at: string;
  yona_url: string;
  yona_token: string;
  yona_default_project: string;
  jenkins_url: string;
  jenkins_user: string;
  jenkins_token: string;
}

const DEFAULTS: IntegrationSettings = {
  ollama_url: "",
  ollama_model: "llama3",
  ollama_timeout_ms: 60000,
  ai_context_limit: 10,
  ai_reply_language: "ko",
  ai_extra_instructions: "",
  ai_show_reasoning: false,
  rag_enabled: true,
  rag_auto_learn: true,
  rag_embedding_model: "nomic-embed-text",
  rag_top_k: 5,
  rag_shared_folder: "",
  rag_last_sync_at: "",
  yona_url: "",
  yona_token: "",
  yona_default_project: "",
  jenkins_url: "",
  jenkins_user: "",
  jenkins_token: "",
};

function parseReplyLanguage(raw: string | undefined): IntegrationSettings["ai_reply_language"] {
  if (raw === "en" || raw === "auto") return raw;
  return "ko";
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

/** env 기반 초기값 (DB에 없을 때 폴백) */
function envDefaults(): IntegrationSettings {
  return {
    ollama_url: process.env.OLLAMA_URL?.trim() ?? "",
    ollama_model: process.env.OLLAMA_MODEL?.trim() || DEFAULTS.ollama_model,
    ollama_timeout_ms: Number(process.env.OLLAMA_TIMEOUT_MS ?? DEFAULTS.ollama_timeout_ms),
    ai_context_limit: Number(process.env.AI_CONTEXT_LIMIT ?? DEFAULTS.ai_context_limit),
    ai_reply_language: parseReplyLanguage(process.env.AI_REPLY_LANGUAGE),
    ai_extra_instructions: process.env.AI_EXTRA_INSTRUCTIONS?.trim() ?? "",
    ai_show_reasoning: parseBool(process.env.AI_SHOW_REASONING, DEFAULTS.ai_show_reasoning),
    rag_enabled: parseBool(process.env.RAG_ENABLED, DEFAULTS.rag_enabled),
    rag_auto_learn: parseBool(process.env.RAG_AUTO_LEARN, DEFAULTS.rag_auto_learn),
    rag_embedding_model: process.env.RAG_EMBEDDING_MODEL?.trim() || DEFAULTS.rag_embedding_model,
    rag_top_k: Number(process.env.RAG_TOP_K ?? DEFAULTS.rag_top_k),
    rag_shared_folder: process.env.RAG_SHARED_FOLDER?.trim() ?? "",
    rag_last_sync_at: process.env.RAG_LAST_SYNC_AT?.trim() ?? "",
    yona_url: process.env.YONA_URL?.trim() ?? "",
    yona_token: process.env.YONA_TOKEN?.trim() ?? "",
    yona_default_project: process.env.YONA_DEFAULT_PROJECT?.trim() ?? "",
    jenkins_url: process.env.JENKINS_URL?.trim() ?? "",
    jenkins_user: process.env.JENKINS_USER?.trim() ?? "",
    jenkins_token: process.env.JENKINS_TOKEN?.trim() ?? "",
  };
}

/** DB에 저장된 설정을 읽고, 없는 키는 env 폴백으로 채운다 */
export function getSettings(): IntegrationSettings {
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];

  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  const env = envDefaults();

  return {
    ollama_url: map.ollama_url ?? env.ollama_url,
    ollama_model: map.ollama_model || env.ollama_model,
    ollama_timeout_ms: map.ollama_timeout_ms ? Number(map.ollama_timeout_ms) : env.ollama_timeout_ms,
    ai_context_limit: map.ai_context_limit ? Number(map.ai_context_limit) : env.ai_context_limit,
    ai_reply_language: parseReplyLanguage(map.ai_reply_language ?? env.ai_reply_language),
    ai_extra_instructions: map.ai_extra_instructions ?? env.ai_extra_instructions,
    ai_show_reasoning: map.ai_show_reasoning !== undefined
      ? parseBool(map.ai_show_reasoning, DEFAULTS.ai_show_reasoning)
      : env.ai_show_reasoning,
    rag_enabled: map.rag_enabled !== undefined ? parseBool(map.rag_enabled, DEFAULTS.rag_enabled) : env.rag_enabled,
    rag_auto_learn:
      map.rag_auto_learn !== undefined ? parseBool(map.rag_auto_learn, DEFAULTS.rag_auto_learn) : env.rag_auto_learn,
    rag_embedding_model: map.rag_embedding_model || env.rag_embedding_model,
    rag_top_k: map.rag_top_k ? Number(map.rag_top_k) : env.rag_top_k,
    rag_shared_folder: map.rag_shared_folder ?? env.rag_shared_folder,
    rag_last_sync_at: map.rag_last_sync_at ?? env.rag_last_sync_at,
    yona_url: map.yona_url ?? env.yona_url,
    yona_token: map.yona_token ?? env.yona_token,
    yona_default_project: map.yona_default_project ?? env.yona_default_project,
    jenkins_url: map.jenkins_url ?? env.jenkins_url,
    jenkins_user: map.jenkins_user ?? env.jenkins_user,
    jenkins_token: map.jenkins_token ?? env.jenkins_token,
  };
}

/** 설정 일부 또는 전체를 업데이트한다 (upsert) */
export function updateSettings(partial: Partial<IntegrationSettings>): void {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );

  const run = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) upsert.run(k, v);
  });

  const entries = Object.entries(partial)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)] as [string, string]);

  run(entries);
}
