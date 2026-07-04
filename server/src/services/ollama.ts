import { getSettings } from "../db/settings.js";

/**
 * Ollama(OpenAI 호환 API) 연동 서비스.
 * 서비스 레이어로 분리되어, Ollama 가 없거나 실패해도 채팅 핵심 기능에는 영향이 없다.
 */

export class IntegrationError extends Error {}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 지정한 Ollama URL에서 설치된 모델 목록을 조회한다 */
export async function listModelsAtUrl(url: string): Promise<string[]> {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return [];

  let res: Response;
  try {
    res = await fetch(`${trimmed}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new IntegrationError("Ollama 서버에 연결할 수 없습니다. URL과 실행 상태를 확인해 주세요.");
  }

  if (!res.ok) {
    throw new IntegrationError(`Ollama 서버 응답 오류 (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

/** 서버에 설치된 모델 목록 조회 (FR-33) */
export async function listModels(): Promise<string[]> {
  const { ollama_url } = getSettings();
  if (!ollama_url) return [];
  try {
    return await listModelsAtUrl(ollama_url);
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
  const settings = getSettings();
  if (!settings.ollama_url) {
    throw new IntegrationError("AI 기능이 설정되지 않았습니다. 관리자 설정에서 Ollama URL을 입력해 주세요.");
  }
  const model = params.model || settings.ollama_model;

  let res: Response;
  const connectController = new AbortController();
  const connectTimer = setTimeout(() => connectController.abort(), 10_000);
  try {
    res = await fetch(`${settings.ollama_url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: params.messages, stream: true }),
      signal: connectController.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new IntegrationError(
        "AI 서버에 연결할 수 없습니다. Ollama URL과 실행 상태를 확인해 주세요."
      );
    }
    throw new IntegrationError("AI 서버에 연결할 수 없습니다. 서버 상태를 확인해 주세요.");
  } finally {
    clearTimeout(connectTimer);
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new IntegrationError(`요청한 모델(${model})을 찾을 수 없습니다.`);
    }
    throw new IntegrationError(`AI 서버 오류가 발생했습니다 (HTTP ${res.status}).`);
  }
  if (!res.body) throw new IntegrationError("AI 서버로부터 응답 본문을 받지 못했습니다.");

  return await consumeSseStream(
    res.body,
    params.onDelta,
    settings.ollama_timeout_ms,
    settings.ai_show_reasoning
  );
}

/** OpenAI/Ollama SSE 스트림을 파싱한다. 기본값은 최종 답변(content)만 표시한다. */
async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
  timeoutMs: number,
  showReasoning: boolean
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let reasoning = "";
  let reasoningHeaderSent = false;
  let answerHeaderSent = false;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (Date.now() > deadline) {
      throw new IntegrationError("AI 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
    }

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
          choices?: { delta?: { content?: string; reasoning?: string } }[];
        };
        const deltaObj = json.choices?.[0]?.delta;
        const reasoningDelta = deltaObj?.reasoning ?? "";
        const contentDelta = deltaObj?.content ?? "";

        if (reasoningDelta) {
          reasoning += reasoningDelta;
          if (showReasoning) {
            if (!reasoningHeaderSent) {
              onDelta("💭 추론\n");
              reasoningHeaderSent = true;
            }
            onDelta(reasoningDelta);
          }
        }

        if (contentDelta) {
          answer += contentDelta;
          if (showReasoning && reasoning && !answerHeaderSent) {
            onDelta("\n\n📝 답변\n");
            answerHeaderSent = true;
          }
          onDelta(contentDelta);
        }
      } catch {
        /* 부분 JSON 등은 무시 */
      }
    }
  }

  if (showReasoning && reasoning) {
    return answer ? `💭 추론\n${reasoning}\n\n📝 답변\n${answer}` : `💭 추론\n${reasoning}`;
  }
  return answer;
}
