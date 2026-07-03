import type { CreateIssueRequest } from "@intra-chat/shared";
import { getSettings } from "../db/settings.js";
import { IntegrationError } from "./ollama.js";

/**
 * Yona 이슈 관리 연동 서비스 (REST).
 * 인증 토큰은 서버에만 보관하며 클라이언트에 노출하지 않는다 (FR-38).
 * 조회 시마다 Yona API 를 직접 호출한다 (캐싱하지 않음).
 */

export interface YonaIssue {
  issueId: number | string;
  title: string;
  assignee: string | null;
  priority: string | null;
  status: string | null;
  dueDate: string | null;
  url: string | null;
}

function authHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `token ${token}`;
  return headers;
}

function assertEnabled(yonaUrl: string): void {
  if (!yonaUrl) {
    throw new IntegrationError("Yona 연동이 설정되지 않았습니다. 관리자 설정에서 Yona URL을 입력해 주세요.");
  }
}

/** 이슈 조회 (FR-35, FR-39) */
export async function getIssue(issueId: string): Promise<YonaIssue> {
  const { yona_url, yona_token, yona_default_project } = getSettings();
  assertEnabled(yona_url);
  const project = yona_default_project;
  const url = project
    ? `${yona_url}/${project}/issues/${issueId}`
    : `${yona_url}/api/issues/${issueId}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(yona_token), signal: AbortSignal.timeout(10000) });
  } catch {
    throw new IntegrationError("Yona 서버에 연결할 수 없습니다.");
  }
  if (res.status === 404) throw new IntegrationError(`이슈 #${issueId} 를 찾을 수 없습니다.`);
  if (!res.ok) throw new IntegrationError(`Yona 조회 오류 (HTTP ${res.status}).`);

  const data = (await res.json()) as Record<string, unknown>;
  return normalizeIssue(issueId, data);
}

/** 이슈 생성 (FR-36, FR-37) */
export async function createIssue(
  payload: CreateIssueRequest
): Promise<{ issueId: number | string; url: string }> {
  const { yona_url, yona_token, yona_default_project } = getSettings();
  assertEnabled(yona_url);
  const project = payload.project || yona_default_project;
  const url = project
    ? `${yona_url}/${project}/issues`
    : `${yona_url}/api/issues`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(yona_token),
      body: JSON.stringify({
        title: payload.title,
        body: payload.description ?? "",
        assignee: payload.assignee,
        labels: payload.labels ?? [],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new IntegrationError("Yona 서버에 연결할 수 없습니다.");
  }
  if (!res.ok) throw new IntegrationError(`Yona 이슈 생성 오류 (HTTP ${res.status}).`);

  const data = (await res.json()) as Record<string, unknown>;
  const issueId = (data.number ?? data.id ?? data.issueId ?? "") as number | string;
  const issueUrl =
    (data.url as string) ??
    (project ? `${yona_url}/${project}/issues/${issueId}` : `${yona_url}/issues/${issueId}`);
  return { issueId, url: issueUrl };
}

/** Yona 응답의 다양한 필드명을 표준 형태로 매핑 */
function normalizeIssue(issueId: string, data: Record<string, unknown>): YonaIssue {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = data[k];
      if (typeof v === "string" && v) return v;
      if (v && typeof v === "object" && "name" in (v as object)) {
        const name = (v as { name?: unknown }).name;
        if (typeof name === "string") return name;
      }
    }
    return null;
  };
  return {
    issueId,
    title: pick("title", "name") ?? `이슈 #${issueId}`,
    assignee: pick("assignee", "assigneeName"),
    priority: pick("priority", "severity"),
    status: pick("status", "state"),
    dueDate: pick("dueDate", "due"),
    url: pick("url", "htmlUrl"),
  };
}
