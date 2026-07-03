import type { Message, MessagePage, MessageType } from "@intra-chat/shared";
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
  created_at: string;
}

function toMessage(row: MessageRow): Message {
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
