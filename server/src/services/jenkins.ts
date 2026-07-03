import { config, integrationsEnabled } from "../config.js";
import { IntegrationError } from "./ollama.js";

/**
 * Jenkins 빌드/CI 연동 서비스 (REST).
 * API 토큰은 서버에만 보관한다. 빌드 실행 자체의 "확인 절차"(FR-44)는 클라이언트에서 담당한다.
 */

function authHeader(): Record<string, string> {
  if (config.jenkins.user && config.jenkins.token) {
    const basic = Buffer.from(`${config.jenkins.user}:${config.jenkins.token}`).toString("base64");
    return { Authorization: `Basic ${basic}` };
  }
  return {};
}

function assertEnabled(): void {
  if (!integrationsEnabled.jenkins()) {
    throw new IntegrationError(
      "Jenkins 연동이 설정되지 않았습니다. 서버 관리자에게 JENKINS_URL 설정을 요청하세요."
    );
  }
}

/** 빌드 실행 요청 (FR-40). 큐 등록 후 빌드 번호를 조회한다. */
export async function startBuild(
  project: string
): Promise<{ buildNumber: number | null; queuedAt: string | null }> {
  assertEnabled();
  let res: Response;
  try {
    res = await fetch(`${config.jenkins.baseUrl}/job/${encodeURIComponent(project)}/build`, {
      method: "POST",
      headers: authHeader(),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new IntegrationError("Jenkins 서버에 연결할 수 없습니다.");
  }
  if (res.status === 404) throw new IntegrationError(`프로젝트 '${project}' 를 찾을 수 없습니다.`);
  if (!res.ok && res.status !== 201) {
    throw new IntegrationError(`Jenkins 빌드 실행 오류 (HTTP ${res.status}).`);
  }

  // 다음 빌드 번호 추정 (nextBuildNumber). 실패해도 치명적이지 않음.
  let buildNumber: number | null = null;
  try {
    const info = await fetch(
      `${config.jenkins.baseUrl}/job/${encodeURIComponent(project)}/api/json`,
      { headers: authHeader(), signal: AbortSignal.timeout(8000) }
    );
    if (info.ok) {
      const data = (await info.json()) as { nextBuildNumber?: number };
      buildNumber = data.nextBuildNumber ?? null;
    }
  } catch {
    /* 무시 */
  }
  return { buildNumber, queuedAt: new Date().toISOString() };
}

/** 빌드 상태 조회 (FR-43) */
export async function getStatus(
  project: string
): Promise<{ status: string; durationSec: number | null; logUrl: string | null }> {
  assertEnabled();
  let res: Response;
  try {
    res = await fetch(
      `${config.jenkins.baseUrl}/job/${encodeURIComponent(project)}/lastBuild/api/json`,
      { headers: authHeader(), signal: AbortSignal.timeout(10000) }
    );
  } catch {
    throw new IntegrationError("Jenkins 서버에 연결할 수 없습니다.");
  }
  if (res.status === 404) throw new IntegrationError(`프로젝트 '${project}' 를 찾을 수 없습니다.`);
  if (!res.ok) throw new IntegrationError(`Jenkins 상태 조회 오류 (HTTP ${res.status}).`);

  const data = (await res.json()) as {
    building?: boolean;
    result?: string | null;
    duration?: number;
    number?: number;
    url?: string;
  };
  const status = data.building ? "BUILDING" : data.result ?? "UNKNOWN";
  const durationSec = data.duration ? Math.round(data.duration / 1000) : null;
  const logUrl = data.url ? `${data.url}console` : null;
  return { status, durationSec, logUrl };
}
