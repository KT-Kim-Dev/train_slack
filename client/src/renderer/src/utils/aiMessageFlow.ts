import type { Message } from "@intra-chat/shared";

export type AiFlowKind = "question" | "answer";

/** AI 전용 방이 아닐 때 연속된 질문(text)+응답(ai_response) 쌍을 식별 */
export function buildAiFlowMap(messages: Message[], isAiRoom: boolean): Map<number, AiFlowKind> {
  const map = new Map<number, AiFlowKind>();
  if (isAiRoom) return map;

  for (let i = 0; i < messages.length - 1; i++) {
    const current = messages[i];
    const next = messages[i + 1];
    if (
      current.messageType === "text" &&
      next.messageType === "ai_response" &&
      current.senderId === next.senderId
    ) {
      map.set(current.id, "question");
      map.set(next.id, "answer");
    }
  }

  return map;
}
