import type { Room } from "@intra-chat/shared";
import { db } from "./index.js";
import { addMember, createRoom, toRoom, type RoomRow } from "./rooms.js";

/**
 * 사용자별 AI 채팅방("AI 어시스턴트")을 보장한다 (FR-27).
 * 없으면 type='ai' 방을 만들고 사용자를 참여시킨 뒤 ai_sessions 레코드를 생성한다.
 */
export function ensureAiRoom(userId: number, model: string | null): Room {
  const existing = db
    .prepare(
      `SELECT r.* FROM rooms r
       JOIN room_members m ON m.room_id = r.id
       WHERE r.type = 'ai' AND m.user_id = ?
       LIMIT 1`
    )
    .get(userId) as RoomRow | undefined;

  if (existing) return toRoom(existing, 0);

  const room = createRoom({ name: "AI 어시스턴트", type: "ai", createdBy: userId });
  addMember(room.id, userId);
  db.prepare("INSERT INTO ai_sessions (user_id, room_id, model_name) VALUES (?, ?, ?)").run(
    userId,
    room.id,
    model
  );
  return toRoom(room, 0);
}

/** 명령어 실행 로그 기록 (NFR 로그 요구사항) */
export function logCommand(params: {
  userId: number | null;
  command: string;
  parameter: string | null;
  success: boolean;
  elapsedMs: number | null;
}): void {
  db.prepare(
    "INSERT INTO command_logs (user_id, command, parameter, success, elapsed_ms) VALUES (?, ?, ?, ?, ?)"
  ).run(params.userId, params.command, params.parameter, params.success ? 1 : 0, params.elapsedMs);
}

export function insertBuildHistory(params: {
  project: string;
  buildNumber: number | null;
  status: string;
  triggeredBy: number | null;
  roomId: number | null;
}): number {
  const result = db
    .prepare(
      `INSERT INTO build_history (project, build_number, status, started_at, triggered_by, room_id)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?)`
    )
    .run(params.project, params.buildNumber, params.status, params.triggeredBy, params.roomId);
  return Number(result.lastInsertRowid);
}

export function finishBuildHistory(params: {
  project: string;
  buildNumber: number;
  status: string;
  durationSec: number | null;
}): void {
  db.prepare(
    `UPDATE build_history
     SET status = ?, duration_sec = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE project = ? AND build_number = ?`
  ).run(params.status, params.durationSec, params.project, params.buildNumber);
}

/** 웹훅 완료 알림을 게시할 방을 찾기 위해 빌드 시작 시 기록한 room_id 를 조회 */
export function getBuildRoom(project: string, buildNumber: number): number | null {
  const row = db
    .prepare(
      "SELECT room_id FROM build_history WHERE project = ? AND build_number = ? ORDER BY id DESC LIMIT 1"
    )
    .get(project, buildNumber) as { room_id: number | null } | undefined;
  return row?.room_id ?? null;
}
