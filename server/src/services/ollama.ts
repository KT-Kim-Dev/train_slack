import { config, integrationsEnabled } from "../config.js";

/**
 * Ollama(OpenAI 호환 API) 연동 서비스.
 * 서비스 레이어로 분리되어, Ollama 가 없거나 실패해도 채팅 핵심 기능에는 영향이 없다.
 */

export class IntegrationError extends Error {}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 서버에 설치된 모델 목록 조회 (FR-33) */
export async function listModels(): Promise<string[]> {
  if (!integrationsEnabled.ai()) return [];
  try {
    const res = await fetch(`${config.ai.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * 스트리밍 채팅 (FR-29, FR-30).
 * onDelta 로 생성되는 토큰을 순차 전달하며, 최종 누적 텍스트를 반환한다.
 * 실패 시 IntegrationError 를 던진다 (FR-34).
 */
export async function chatStream(params: {
  messages: ChatMessage[];
  model?: string;
  onDelta: (delta: string) => void;
}): Promise<string> {
  if (!integrationsEnabled.ai()) {
    throw new IntegrationError("AI 기능이 설정되지 않았습니다. 서버 관리자에게 OLLAMA_URL 설정을 요청하세요.");
  }
  const model = params.model || config.ai.defaultModel;

  let res: Response;
  try {
    res = await fetch(`${config.ai.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: params.messages, stream: true }),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new IntegrationError("AI 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw new IntegrationError("AI 서버에 연결할 수 없습니다. 서버 상태를 확인해 주세요.");
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new IntegrationError(`요청한 모델(${model})을 찾을 수 없습니다.`);
    }
    throw new IntegrationError(`AI 서버 오류가 발생했습니다 (HTTP ${res.status}).`);
  }
  if (!res.body) throw new IntegrationError("AI 서버로부터 응답 본문을 받지 못했습니다.");

  return await consumeSseStream(res.body, params.onDelta);
}

/** OpenAI 호환 SSE 스트림을 파싱해 delta 를 누적한다 */
async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        /* 부분 JSON 등은 무시 */
      }
    }
  }
  return full;
}
