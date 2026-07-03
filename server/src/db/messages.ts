import type { CardPayload, Message, MessagePage, MessageType } from "@intra-chat/shared";
import { db } from "./index.js";

export interface MessageRow {
  id: number;
  room_id: number;
  sender_id: number;
  sender_name: string;
  message_type: MessageType;
  content: string | null;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  metadata: string | null;
  created_at: string;
}

function toMessage(row: MessageRow): Message {
  let metadata: CardPayload | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as CardPayload;
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    messageType: row.message_type,
    content: row.content,
    fileName: row.file_name,
    // 파일이 있는 경우 다운로드/미리보기용 상대 URL 제공
    fileUrl: row.file_path ? `/api/files/${row.id}` : null,
    fileSize: row.file_size,
    metadata,
    createdAt: row.created_at,
  };
}

const SELECT_WITH_SENDER = `
  SELECT m.*, u.display_name AS sender_name
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
`;

export function getMessageById(id: number): Message | undefined {
  const row = db
    .prepare(`${SELECT_WITH_SENDER} WHERE m.id = ?`)
    .get(id) as MessageRow | undefined;
  return row ? toMessage(row) : undefined;
}

/** 파일 다운로드용으로 원시 파일 경로/메타를 조회 */
export function getFileMeta(
  messageId: number
): { filePath: string; fileName: string; messageType: MessageType } | undefined {
  const row = db
    .prepare("SELECT file_path, file_name, message_type FROM messages WHERE id = ?")
    .get(messageId) as
    | { file_path: string | null; file_name: string | null; message_type: MessageType }
    | undefined;
  if (!row || !row.file_path || !row.file_name) return undefined;
  return { filePath: row.file_path, fileName: row.file_name, messageType: row.message_type };
}

export function insertTextMessage(params: {
  roomId: number;
  senderId: number;
  content: string;
}): Message {
  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content) VALUES (?, ?, 'text', ?)"
    )
    .run(params.roomId, params.senderId, params.content);
  return getMessageById(Number(result.lastInsertRowid))!;
}

export function insertFileMessage(params: {
  roomId: number;
  senderId: number;
  messageType: "file" | "image";
  fileName: string;
  filePath: string;
  fileSize: number;
}): Message {
  const result = db
    .prepare(
      `INSERT INTO messages (room_id, sender_id, message_type, file_name, file_path, file_size)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.roomId,
      params.senderId,
      params.messageType,
      params.fileName,
      params.filePath,
      params.fileSize
    );
  return getMessageById(Number(result.lastInsertRowid))!;
}

/** 카드 메시지(이슈/빌드) 저장 (message_type='card') */
export function insertCardMessage(params: {
  roomId: number;
  senderId: number;
  card: CardPayload;
  content?: string;
}): Message {
  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content, metadata) VALUES (?, ?, 'card', ?, ?)"
    )
    .run(params.roomId, params.senderId, params.content ?? null, JSON.stringify(params.card));
  return getMessageById(Number(result.lastInsertRowid))!;
}

/** AI 응답 자리표시자 생성 (스트리밍 시작 전, 빈 내용으로). 발신자는 질문한 사용자. */
export function insertAiPlaceholder(params: { roomId: number; senderId: number }): Message {
  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content) VALUES (?, ?, 'ai_response', '')"
    )
    .run(params.roomId, params.senderId);
  return getMessageById(Number(result.lastInsertRowid))!;
}

/** 스트리밍 중/완료 시 AI 응답 내용을 갱신 */
export function setMessageContent(messageId: number, content: string): void {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, messageId);
}

/**
 * AI 컨텍스트용으로 방의 최근 메시지를 오래된 순으로 조회한다 (FR-31).
 * message_type 으로 role 을 판별하므로 AI 시스템 계정 ID 가 불필요하다.
 */
export function getContextMessages(
  roomId: number,
  limit: number
): { role: "user" | "assistant"; content: string }[] {
  const rows = db
    .prepare(
      `SELECT message_type, content FROM messages
       WHERE room_id = ? AND message_type IN ('text','ai_response') AND content IS NOT NULL AND content <> ''
       ORDER BY id DESC LIMIT ?`
    )
    .all(roomId, limit) as { message_type: MessageType; content: string }[];
  return rows
    .reverse()
    .map((r) => ({
      role: r.message_type === "ai_response" ? "assistant" : "user",
      content: r.content,
    }));
}

/**
 * 히스토리 페이지네이션 (FR-13).
 * cursor 가 주어지면 그 id 보다 오래된(작은) 메시지를 최신순으로 limit 개 조회한다.
 * 결과는 화면 표시를 위해 오래된 -> 최신 순으로 재정렬해 반환한다.
 */
export function getMessagePage(params: {
  roomId: number;
  cursor: number | null;
  limit: number;
}): MessagePage {
  const limit = Math.min(Math.max(params.limit, 1), 100);
  const rows = db
    .prepare(
      `${SELECT_WITH_SENDER}
       WHERE m.room_id = ? AND (? IS NULL OR m.id < ?)
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(params.roomId, params.cursor, params.cursor, limit + 1) as MessageRow[];

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const nextCursor = hasMore && page.length > 0 ? page[0].id : null;

  return {
    messages: page.map(toMessage),
    nextCursor,
    hasMore,
  };
}

export { toMessage };
