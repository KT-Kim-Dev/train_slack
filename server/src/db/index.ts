import Database from "better-sqlite3";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * SQLite 연결 및 스키마 초기화.
 * 명세 7장의 데이터 모델(users/rooms/room_members/messages)을 그대로 반영한다.
 * 채널/그룹/DM 을 rooms 단일 테이블로 통합하고, 파일도 messages 의 한 타입으로 다룬다.
 */

export const db = new Database(config.dbPath);

// 동시 접근 성능/안정성을 위한 PRAGMA 설정
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  is_online     INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_seen     TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('channel','group','dm')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id              INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_read_message_id INTEGER,
  is_hidden            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','file','image')),
  content      TEXT,
  file_name    TEXT,
  file_path    TEXT,
  file_size    INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members (user_id);
`;

export function initDb(): void {
  db.exec(SCHEMA);
  ensureDefaultChannel();
  logger.info("데이터베이스 초기화 완료", { dbPath: config.dbPath });
}

/**
 * PoC 편의를 위해 기본 공개 채널("general")을 보장한다.
 * 신규 사용자는 로그인 시 이 채널에 자동 합류시킨다(수직 슬라이스 단계).
 */
function ensureDefaultChannel(): void {
  const existing = db
    .prepare("SELECT id FROM rooms WHERE type = 'channel' AND name = ?")
    .get("general") as { id: number } | undefined;

  if (!existing) {
    db.prepare("INSERT INTO rooms (name, type, created_by) VALUES (?, 'channel', NULL)").run(
      "general"
    );
    logger.info("기본 공개 채널 'general' 생성");
  }
}

export function getDefaultChannelId(): number {
  const row = db
    .prepare("SELECT id FROM rooms WHERE type = 'channel' AND name = ?")
    .get("general") as { id: number };
  return row.id;
}
