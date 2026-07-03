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
  yona_url: "",
  yona_token: "",
  yona_default_project: "",
  jenkins_url: "",
  jenkins_user: "",
  jenkins_token: "",
};

/** env 기반 초기값 (DB에 없을 때 폴백) */
function envDefaults(): IntegrationSettings {
  return {
    ollama_url: process.env.OLLAMA_URL?.trim() ?? "",
    ollama_model: process.env.OLLAMA_MODEL?.trim() || DEFAULTS.ollama_model,
    ollama_timeout_ms: Number(process.env.OLLAMA_TIMEOUT_MS ?? DEFAULTS.ollama_timeout_ms),
    ai_context_limit: Number(process.env.AI_CONTEXT_LIMIT ?? DEFAULTS.ai_context_limit),
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
