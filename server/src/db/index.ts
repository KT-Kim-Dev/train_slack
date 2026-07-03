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
  type       TEXT NOT NULL CHECK (type IN ('channel','group','dm','ai')),
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
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','file','image','ai_response','card')),
  content      TEXT,
  file_name    TEXT,
  file_path    TEXT,
  file_size    INTEGER,
  metadata     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 신규(v3): AI 채팅 세션
CREATE TABLE IF NOT EXISTS ai_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  model_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 신규(v3): 명령어 실행 로그 (Yona/Jenkins/AI 공통, 문제 추적용)
CREATE TABLE IF NOT EXISTS command_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  command    TEXT NOT NULL,
  parameter  TEXT,
  success    INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 신규(v3): Jenkins 빌드 이력
CREATE TABLE IF NOT EXISTS build_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project      TEXT NOT NULL,
  build_number INTEGER,
  status       TEXT,
  duration_sec INTEGER,
  started_at   TEXT,
  finished_at  TEXT,
  triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room_id      INTEGER REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members (user_id);
CREATE INDEX IF NOT EXISTS idx_command_logs_created ON command_logs (created_at);

-- 신규(v3): 관리자 UI에서 수정 가능한 통합 연동 설정 (서버 재시작 없이 즉시 반영)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

/** AI 메시지의 발신자로 사용할 시스템 계정 username */
export const AI_USERNAME = "__ai__";

export function initDb(): void {
  db.exec(SCHEMA);
  runMigrations();
  ensureDefaultChannel();
  ensureAiUser();
  logger.info("데이터베이스 초기화 완료", { dbPath: config.dbPath });
}

/**
 * 기존 DB의 CHECK 제약·컬럼 변경을 SQLite의 12-step 방식으로 처리한다.
 * CREATE TABLE IF NOT EXISTS 는 이미 존재하는 테이블의 스키마를 바꾸지 않으므로,
 * 이 함수에서 필요한 마이그레이션만 멱등하게 실행한다.
 */
function runMigrations(): void {
  // ----- rooms: type CHECK 에 'ai' 추가 -----
  const roomsDef: string = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'").get() as
      | { sql: string }
      | undefined
  )?.sql ?? "";
  if (roomsDef && !roomsDef.includes("'ai'")) {
    logger.info("DB 마이그레이션: rooms.type 에 ai 추가");
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE rooms_v3 (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL CHECK (type IN ('channel','group','dm','ai')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO rooms_v3 SELECT * FROM rooms;
      DROP TABLE rooms;
      ALTER TABLE rooms_v3 RENAME TO rooms;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // ----- messages: message_type CHECK 에 'ai_response'|'card' 추가 + metadata 컬럼 -----
  const msgDef: string = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get() as
      | { sql: string }
      | undefined
  )?.sql ?? "";
  const needsTypeUpdate = msgDef && !msgDef.includes("'ai_response'");
  const hasMetadata = msgDef && msgDef.includes("metadata");

  if (needsTypeUpdate || !hasMetadata) {
    logger.info("DB 마이그레이션: messages.message_type 확장 + metadata 컬럼 추가");
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE messages_v3 (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','file','image','ai_response','card')),
        content      TEXT,
        file_name    TEXT,
        file_path    TEXT,
        file_size    INTEGER,
        metadata     TEXT,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO messages_v3 (id, room_id, sender_id, message_type, content, file_name, file_path, file_size, created_at)
        SELECT id, room_id, sender_id, message_type, content, file_name, file_path, file_size, created_at FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v3 RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages (room_id, created_at);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
}

/**
 * AI 응답 메시지의 발신자로 쓸 시스템 계정을 보장한다.
 * 로그인 불가한 계정(사용 불가능한 해시)으로 생성한다.
 */
function ensureAiUser(): void {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(AI_USERNAME);
  if (!existing) {
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, is_active) VALUES (?, '!', ?, 0)"
    ).run(AI_USERNAME, "AI 어시스턴트");
    logger.info("AI 시스템 계정 생성");
  }
}

export function getAiUserId(): number {
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(AI_USERNAME) as {
    id: number;
  };
  return row.id;
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
