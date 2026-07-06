import type { IntegrationSettings } from "../db/settings.js";

/** 관리자 설정과 기본값을 조합해 Ollama에 전달할 system 프롬프트를 만든다 */
export function buildAiSystemPrompt(
  settings: Pick<IntegrationSettings, "ai_reply_language" | "ai_extra_instructions">
): string {
  const parts = ["당신은 사내 업무를 돕는 AI 어시스턴트입니다."];

  switch (settings.ai_reply_language) {
    case "ko":
      parts.push("항상 한국어로 답변하세요.");
      break;
    case "en":
      parts.push("Always respond in English.");
      break;
    case "auto":
      parts.push("사용자가 사용한 언어와 같은 언어로 답변하세요.");
      break;
  }

  parts.push("간결하고 정확하게 답변하세요.");

  const extra = settings.ai_extra_instructions.trim();
  if (extra) parts.push(extra);

  return parts.join(" ");
}

/** RAG 검색 결과를 system 프롬프트에 붙인다 (참고용 — 없거나 부적합하면 무시 가능) */
export function appendRagContext(systemPrompt: string, ragContext: string | null): string {
  if (!ragContext) return systemPrompt;
  return (
    `${systemPrompt}\n\n` +
    "아래는 사내 지식 베이스에서 검색한 참고 자료입니다. 관련 내용이 있으면 참고하되, " +
    "없거나 부족하면 일반 지식으로 답변하세요. 참고 자료만으로 답을 거부하지 마세요.\n" +
    ragContext
  );
}
