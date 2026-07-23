import type { CardPayload, Message, MessageMetadata, MessagePage, MessageReplyPreview, MessageType } from "@intra-chat/shared";
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
  parent_id: number | null;
  created_at: string;
  parent_msg_id?: number | null;
  parent_sender_id?: number | null;
  parent_sender_name?: string | null;
  parent_message_type?: MessageType | null;
  parent_content?: string | null;
  parent_file_name?: string | null;
}

function buildReplyPreview(row: MessageRow): MessageReplyPreview | null {
  if (!row.parent_msg_id) return null;
  return {
    id: row.parent_msg_id,
    senderId: row.parent_sender_id ?? 0,
    senderName: row.parent_sender_name ?? "알 수 없음",
    messageType: row.parent_message_type ?? "text",
    content: row.parent_content ?? null,
    fileName: row.parent_file_name ?? null,
  };
}

function toMessage(row: MessageRow): Message {
  let metadata: MessageMetadata | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as MessageMetadata;
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
    fileUrl: row.file_path ? `/api/files/${row.id}` : null,
    fileSize: row.file_size,
    metadata,
    parentMessageId: row.parent_id,
    replyTo: buildReplyPreview(row),
    createdAt: row.created_at,
  };
}

const SELECT_WITH_SENDER = `
  SELECT m.*, u.display_name AS sender_name,
    pm.id AS parent_msg_id,
    pm.sender_id AS parent_sender_id,
    pu.display_name AS parent_sender_name,
    pm.message_type AS parent_message_type,
    pm.content AS parent_content,
    pm.file_name AS parent_file_name
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages pm ON pm.id = m.parent_id
  LEFT JOIN users pu ON pu.id = pm.sender_id
`;

export function getMessageById(id: number): Message | undefined {
  const row = db
    .prepare(`${SELECT_WITH_SENDER} WHERE m.id = ?`)
    .get(id) as MessageRow | undefined;
  return row ? toMessage(row) : undefined;
}

/** 같은 방의 메시지인지 확인 (대댓글용) */
export function getMessageInRoom(messageId: number, roomId: number): Message | undefined {
  const row = db
    .prepare(`${SELECT_WITH_SENDER} WHERE m.id = ? AND m.room_id = ?`)
    .get(messageId, roomId) as MessageRow | undefined;
  return row ? toMessage(row) : undefined;
}

export function getFileMeta(
  messageId: number
): { filePath: string; fileName: string; messageType: MessageType; metadata: MessageMetadata | null } | undefined {
  const row = db
    .prepare("SELECT file_path, file_name, message_type, metadata FROM messages WHERE id = ?")
    .get(messageId) as
    | { file_path: string | null; file_name: string | null; message_type: MessageType; metadata: string | null }
    | undefined;
  if (!row || !row.file_path || !row.file_name) return undefined;
  let metadata: MessageMetadata | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as MessageMetadata;
    } catch {
      metadata = null;
    }
  }
  return { filePath: row.file_path, fileName: row.file_name, messageType: row.message_type, metadata };
}

/** 그룹채팅 멤버 입·퇴장 시스템 메시지 */
export function insertMemberSystemMessage(params: {
  roomId: number;
  userId: number;
  action: "joined" | "left";
}): Message {
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(params.userId) as
    | { display_name: string }
    | undefined;
  const displayName = user?.display_name ?? "알 수 없음";
  const content =
    params.action === "joined"
      ? `[${displayName}] 이 들어왔습니다.`
      : `[${displayName}] 이 나갔습니다.`;

  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content) VALUES (?, ?, 'system', ?)"
    )
    .run(params.roomId, params.userId, content);
  return getMessageById(Number(result.lastInsertRowid))!;
}

/** DM /지진 시스템 메시지 */
export function insertEarthquakeSystemMessage(params: {
  roomId: number;
  userId: number;
}): Message {
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(params.userId) as
    | { display_name: string }
    | undefined;
  const displayName = user?.display_name ?? "알 수 없음";
  const content = `[${displayName}]님이 지진을 발생시켰습니다.`;

  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content) VALUES (?, ?, 'system', ?)"
    )
    .run(params.roomId, params.userId, content);
  return getMessageById(Number(result.lastInsertRowid))!;
}

/** 채널 /전체지진 시스템 메시지 */
export function insertMassEarthquakeSystemMessage(params: {
  roomId: number;
  userId: number;
}): Message {
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(params.userId) as
    | { display_name: string }
    | undefined;
  const displayName = user?.display_name ?? "알 수 없음";
  const content = `[${displayName}]님이 전체지진을 발동시켰습니다.`;

  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content) VALUES (?, ?, 'system', ?)"
    )
    .run(params.roomId, params.userId, content);
  return getMessageById(Number(result.lastInsertRowid))!;
}

/** @멘션 대상 개별 /지진 시스템 메시지 */
export function insertTargetedEarthquakeSystemMessage(params: {
  roomId: number;
  userId: number;
  targetUserIds: number[];
}): Message {
  const sender = db.prepare("SELECT display_name FROM users WHERE id = ?").get(params.userId) as
    | { display_name: string }
    | undefined;
  const senderName = sender?.display_name ?? "알 수 없음";

  const targetNames = params.targetUserIds.map((id) => {
    const row = db.prepare("SELECT display_name FROM users WHERE id = ?").get(id) as
      | { display_name: string }
      | undefined;
    return row?.display_name ?? "알 수 없음";
  });

  const content =
    targetNames.length === 1
      ? `[${senderName}]님이 [${targetNames[0]}]님에게 지진을 발생시켰습니다.`
      : `[${senderName}]님이 [${targetNames.join(", ")}]님에게 지진을 발생시켰습니다.`;

  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content) VALUES (?, ?, 'system', ?)"
    )
    .run(params.roomId, params.userId, content);
  return getMessageById(Number(result.lastInsertRowid))!;
}

/** 지진 무시 시스템 메시지 */
export function insertEarthquakeIgnoredSystemMessage(params: {
  roomId: number;
  userId: number;
}): Message {
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(params.userId) as
    | { display_name: string }
    | undefined;
  const displayName = user?.display_name ?? "알 수 없음";
  const content = `[${displayName}]께서 지진발생을 무시하였습니다.`;

  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content) VALUES (?, ?, 'system', ?)"
    )
    .run(params.roomId, params.userId, content);
  return getMessageById(Number(result.lastInsertRowid))!;
}

export function insertTextMessage(params: {
  roomId: number;
  senderId: number;
  content: string;
  parentMessageId?: number | null;
}): Message {
  const result = db
    .prepare(
      "INSERT INTO messages (room_id, sender_id, message_type, content, parent_id) VALUES (?, ?, 'text', ?, ?)"
    )
    .run(params.roomId, params.senderId, params.content, params.parentMessageId ?? null);
  return getMessageById(Number(result.lastInsertRowid))!;
}

export function insertFileMessage(params: {
  roomId: number;
  senderId: number;
  messageType: "file" | "image";
  fileName: string;
  filePath: string;
  fileSize: number;
  parentMessageId?: number | null;
  metadata?: MessageMetadata | null;
}): Message {
  const result = db
    .prepare(
      `INSERT INTO messages (room_id, sender_id, message_type, file_name, file_path, file_size, parent_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.roomId,
      params.senderId,
      params.messageType,
      params.fileName,
      params.filePath,
      params.fileSize,
      params.parentMessageId ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null
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

/** RAG 대화보내기용 — 방의 전체 메시지를 시간순으로 조회 */
export function getMessagesForRagExport(roomId: number): {
  messageType: MessageType;
  content: string | null;
  fileName: string | null;
  senderName: string;
  createdAt: string;
}[] {
  const rows = db
    .prepare(
      `SELECT m.message_type, m.content, m.file_name,
              COALESCE(u.display_name, '알 수 없음') AS sender_name,
              m.created_at
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = ?
       ORDER BY m.id ASC`
    )
    .all(roomId) as {
    message_type: MessageType;
    content: string | null;
    file_name: string | null;
    sender_name: string;
    created_at: string;
  }[];
  return rows.map((row) => ({
    messageType: row.message_type,
    content: row.content,
    fileName: row.file_name,
    senderName: row.sender_name,
    createdAt: row.created_at,
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
