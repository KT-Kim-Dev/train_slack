import { getSettings } from "../db/settings.js";
import { IntegrationError } from "./ollama.js";

/** Ollama 임베딩 API로 텍스트를 벡터화한다 */
export async function embedText(text: string, model?: string): Promise<number[]> {
  const settings = getSettings();
  if (!settings.ollama_url) {
    throw new IntegrationError("Ollama URL이 설정되지 않았습니다.");
  }

  const embedModel = model || settings.rag_embedding_model;
  let res: Response;
  try {
    res = await fetch(`${settings.ollama_url.replace(/\/+$/, "")}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embedModel, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new IntegrationError("임베딩 서버에 연결할 수 없습니다. Ollama와 임베딩 모델을 확인해 주세요.");
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new IntegrationError(`임베딩 모델(${embedModel})을 찾을 수 없습니다.`);
    }
    throw new IntegrationError(`임베딩 생성 실패 (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { embedding?: number[] };
  if (!data.embedding?.length) {
    throw new IntegrationError("임베딩 결과가 비어 있습니다.");
  }
  return data.embedding;
}
