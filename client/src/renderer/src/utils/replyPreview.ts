import type { Message, MessageReplyPreview } from "@intra-chat/shared";

export function replyPreviewText(reply: MessageReplyPreview, maxLen = 80): string {
  switch (reply.messageType) {
    case "text":
    case "ai_response":
      return (reply.content ?? "").replace(/\s+/g, " ").trim().slice(0, maxLen) || "메시지";
    case "image":
      return reply.fileName ? `📷 ${reply.fileName}` : "📷 이미지";
    case "file":
      return reply.fileName ? `📄 ${reply.fileName}` : "📄 파일";
    case "card":
      return "📋 카드 메시지";
    case "system":
      return reply.content ?? "시스템 메시지";
    default:
      return "메시지";
  }
}

export function replyPreviewTextFromMessage(message: Message, maxLen = 80): string {
  if (message.replyTo) return replyPreviewText(message.replyTo, maxLen);
  switch (message.messageType) {
    case "text":
    case "ai_response":
      return (message.content ?? "").replace(/\s+/g, " ").trim().slice(0, maxLen) || "메시지";
    case "image":
      return message.fileName ? `📷 ${message.fileName}` : "📷 이미지";
    case "file":
      return message.fileName ? `📄 ${message.fileName}` : "📄 파일";
    case "card":
      return "📋 카드 메시지";
    default:
      return "메시지";
  }
}
