import type { PublicUser, UserPresenceStatus } from "@intra-chat/shared";
import { db, AI_USERNAME } from "./index.js";
import { config } from "../config.js";

/** users 테이블의 원시 행 형태 */
export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  is_online: number;
  is_active: number;
  last_seen: string | null;
  profile_image_path: string | null;
  presence_status: string;
  created_at: string;
}

const VALID_PRESENCE: UserPresenceStatus[] = ["available", "busy", "away"];

function normalizePresenceStatus(raw: string | null | undefined): UserPresenceStatus {
  if (raw && VALID_PRESENCE.includes(raw as UserPresenceStatus)) {
    return raw as UserPresenceStatus;
  }
  return "available";
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isOnline: row.is_online === 1,
    lastSeen: row.last_seen,
    isAdmin: config.adminUsernames.includes(row.username),
    profileImageUrl: row.profile_image_path ? `/api/users/${row.id}/avatar` : null,
    presenceStatus: normalizePresenceStatus(row.presence_status),
  };
}

export function createUser(params: {
  username: string;
  passwordHash: string;
  displayName: string;
}): UserRow {
  const result = db
    .prepare(
      "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)"
    )
    .run(params.username, params.passwordHash, params.displayName);
  return getUserById(Number(result.lastInsertRowid))!;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getUserByUsername(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
}

/** 관리자 화면 등 — AI 시스템 계정 포함 전체 목록 */
export function listUsers(): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY display_name").all() as UserRow[];
}

/** 사이드바 멤버 목록 — 활성 사용자만, AI 시스템 계정 제외 */
export function listActiveUsers(): UserRow[] {
  return db
    .prepare(
      "SELECT * FROM users WHERE is_active = 1 AND username != ? ORDER BY display_name"
    )
    .all(AI_USERNAME) as UserRow[];
}

export function setOnline(userId: number, isOnline: boolean): string | null {
  const lastSeen = isOnline ? null : new Date().toISOString();
  db.prepare("UPDATE users SET is_online = ?, last_seen = COALESCE(?, last_seen) WHERE id = ?").run(
    isOnline ? 1 : 0,
    lastSeen,
    userId
  );
  return lastSeen;
}

export function setPresenceStatus(userId: number, status: UserPresenceStatus): void {
  db.prepare("UPDATE users SET presence_status = ? WHERE id = ?").run(status, userId);
}

export function setProfileImagePath(userId: number, imagePath: string | null): void {
  db.prepare("UPDATE users SET profile_image_path = ? WHERE id = ?").run(imagePath, userId);
}

export function setActive(userId: number, isActive: boolean): void {
  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, userId);
}

export function deleteUser(userId: number): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}
