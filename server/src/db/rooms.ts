import type { Room, RoomType } from "@intra-chat/shared";
import { db } from "./index.js";

export interface RoomRow {
  id: number;
  name: string;
  type: RoomType;
  created_by: number | null;
  created_at: string;
}

function toRoom(row: RoomRow, unreadCount?: number): Room {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    createdBy: row.created_by ?? 0,
    createdAt: row.created_at,
    unreadCount,
  };
}

export function createRoom(params: {
  name: string;
  type: RoomType;
  createdBy: number | null;
}): RoomRow {
  const result = db
    .prepare("INSERT INTO rooms (name, type, created_by) VALUES (?, ?, ?)")
    .run(params.name, params.type, params.createdBy);
  return getRoomById(Number(result.lastInsertRowid))!;
}

export function getRoomById(id: number): RoomRow | undefined {
  return db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined;
}

export function addMember(roomId: number, userId: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)"
  ).run(roomId, userId);
}

export function removeMember(roomId: number, userId: number): void {
  db.prepare("DELETE FROM room_members WHERE room_id = ? AND user_id = ?").run(roomId, userId);
}

export function isMember(roomId: number, userId: number): boolean {
  const row = db
    .prepare("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
    .get(roomId, userId);
  return !!row;
}

/** 사용자가 참여 중인 모든 방 id (숨김 여부 무관, 소켓 채널 합류용) */
export function getRoomIdsForUser(userId: number): number[] {
  const rows = db
    .prepare("SELECT room_id FROM room_members WHERE user_id = ?")
    .all(userId) as { room_id: number }[];
  return rows.map((r) => r.room_id);
}

export function getMemberIds(roomId: number): number[] {
  const rows = db
    .prepare("SELECT user_id FROM room_members WHERE room_id = ?")
    .all(roomId) as { user_id: number }[];
  return rows.map((r) => r.user_id);
}

/**
 * 사용자가 참여 중인 방 목록을 미읽음 수와 함께 반환한다.
 * 미읽음 수 = 해당 방에서 last_read_message_id 이후 & 본인이 보내지 않은 메시지 수.
 */
export function listRoomsForUser(userId: number): Room[] {
  const rows = db
    .prepare(
      `SELECT r.*, rm.last_read_message_id AS last_read
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       WHERE rm.user_id = ? AND rm.is_hidden = 0
       ORDER BY r.type, r.name`
    )
    .all(userId) as (RoomRow & { last_read: number | null })[];

  return rows.map((row) => {
    const unread = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM messages
         WHERE room_id = ? AND id > COALESCE(?, 0) AND sender_id <> ?`
      )
      .get(row.id, row.last_read, userId) as { cnt: number };
    return toRoom(row, unread.cnt);
  });
}

export function markRoomRead(roomId: number, userId: number, lastMessageId: number): void {
  db.prepare(
    "UPDATE room_members SET last_read_message_id = ? WHERE room_id = ? AND user_id = ?"
  ).run(lastMessageId, roomId, userId);
}

export function hideRoom(roomId: number, userId: number, hidden: boolean): void {
  db.prepare(
    "UPDATE room_members SET is_hidden = ? WHERE room_id = ? AND user_id = ?"
  ).run(hidden ? 1 : 0, roomId, userId);
}

/** DM 수신 시 숨김 처리된 상대방에게 방을 다시 표시한다 */
export function unhideDmRecipients(roomId: number, senderId: number): number[] {
  const rows = db
    .prepare(
      `SELECT user_id FROM room_members
       WHERE room_id = ? AND is_hidden = 1 AND user_id != ?`
    )
    .all(roomId, senderId) as { user_id: number }[];
  if (rows.length === 0) return [];
  db.prepare(
    `UPDATE room_members SET is_hidden = 0
     WHERE room_id = ? AND is_hidden = 1 AND user_id != ?`
  ).run(roomId, senderId);
  return rows.map((r) => r.user_id);
}

/** 특정 사용자의 방 미읽음 수 (목록 복원용) */
export function getUnreadCountForUser(roomId: number, userId: number): number {
  const row = db
    .prepare(
      `SELECT last_read_message_id AS last_read FROM room_members
       WHERE room_id = ? AND user_id = ?`
    )
    .get(roomId, userId) as { last_read: number | null } | undefined;
  if (!row) return 0;
  const unread = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM messages
       WHERE room_id = ? AND id > COALESCE(?, 0) AND sender_id <> ?`
    )
    .get(roomId, row.last_read, userId) as { cnt: number };
  return unread.cnt;
}

/** 두 사용자 간 기존 DM 방을 찾는다 (참여자가 정확히 두 명이고 둘 다 포함) */
export function findDmRoom(userA: number, userB: number): RoomRow | undefined {
  return db
    .prepare(
      `SELECT r.* FROM rooms r
       WHERE r.type = 'dm'
         AND (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) = 2
         AND EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = r.id AND m.user_id = ?)
         AND EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = r.id AND m.user_id = ?)
       LIMIT 1`
    )
    .get(userA, userB) as RoomRow | undefined;
}

export { toRoom };
