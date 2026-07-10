import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventColor,
  CalendarEventInput,
  CalendarVisibility,
} from "@intra-chat/shared";
import { CALENDAR_EVENT_COLORS, DEFAULT_CALENDAR_EVENT_COLOR } from "@intra-chat/shared";
import { db, AI_USERNAME } from "./index.js";

interface EventRow {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: number;
  visibility: string;
  reminder_minutes: number;
  color: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  creator_name: string;
}

interface AttendeeRow {
  user_id: number;
  display_name: string;
  username: string;
  response_status: string;
}

function normalizeVisibility(raw: string): CalendarVisibility {
  return raw === "private" ? "private" : "company";
}

function normalizeEventColor(raw: string | null | undefined): CalendarEventColor {
  const value = (raw ?? DEFAULT_CALENDAR_EVENT_COLOR).toLowerCase();
  return (CALENDAR_EVENT_COLORS as readonly string[]).includes(value)
    ? (value as CalendarEventColor)
    : DEFAULT_CALENDAR_EVENT_COLOR;
}

function toAttendee(row: AttendeeRow): CalendarAttendee {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    responseStatus: "invited",
  };
}

function loadAttendees(eventId: number): CalendarAttendee[] {
  const rows = db
    .prepare(
      `SELECT a.user_id, u.display_name, u.username, a.response_status
       FROM calendar_attendees a
       JOIN users u ON u.id = a.user_id
       WHERE a.event_id = ?
       ORDER BY u.display_name`
    )
    .all(eventId) as AttendeeRow[];
  return rows.map(toAttendee);
}

function toEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day === 1,
    visibility: normalizeVisibility(row.visibility),
    reminderMinutes: row.reminder_minutes,
    color: normalizeEventColor(row.color),
    createdBy: row.created_by,
    creatorName: row.creator_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attendees: loadAttendees(row.id),
  };
}

const EVENT_SELECT = `
  SELECT e.*, u.display_name AS creator_name
  FROM calendar_events e
  JOIN users u ON u.id = e.created_by
`;

export function getEventById(id: number): CalendarEvent | null {
  const row = db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id) as EventRow | undefined;
  return row ? toEvent(row) : null;
}

/** 생성자이거나 참석자이면 true */
export function canAccessEvent(event: CalendarEvent, userId: number): boolean {
  if (event.createdBy === userId) return true;
  if (event.attendees.some((a) => a.userId === userId)) return true;
  if (event.visibility === "company") return true;
  return false;
}

export function canEditEvent(event: CalendarEvent, userId: number): boolean {
  return event.createdBy === userId;
}

export function listEventsForUser(params: {
  userId: number;
  from: string;
  to: string;
  scope: "mine" | "all";
}): CalendarEvent[] {
  const { userId, from, to, scope } = params;
  // ISO 문자열 단순 비교가 깨지지 않도록 Date로 기간 필터링한다.
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  let sql: string;
  let args: unknown[];

  if (scope === "mine") {
    // 내가 만들었거나 / 참석자로 등록된 일정만
    sql = `${EVENT_SELECT}
      WHERE (
          e.created_by = ?
          OR EXISTS (
            SELECT 1 FROM calendar_attendees a
            WHERE a.event_id = e.id AND a.user_id = ?
          )
        )
      ORDER BY e.start_at ASC, e.id ASC`;
    args = [userId, userId];
  } else {
    // 전체: 전사 공개 + 내 private + 내가 참석한 일정
    sql = `${EVENT_SELECT}
      WHERE (
          e.visibility = 'company'
          OR e.created_by = ?
          OR EXISTS (
            SELECT 1 FROM calendar_attendees a
            WHERE a.event_id = e.id AND a.user_id = ?
          )
        )
      ORDER BY e.start_at ASC, e.id ASC`;
    args = [userId, userId];
  }

  const rows = db.prepare(sql).all(...args) as EventRow[];
  return rows
    .map(toEvent)
    .filter((ev) => {
      const start = Date.parse(ev.startAt);
      const end = Date.parse(ev.endAt);
      if (Number.isNaN(start) || Number.isNaN(end)) return false;
      if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return true;
      return start < toMs && end > fromMs;
    });
}

/** RAG schedule.md 기록용 — 전체 일정 (시작 시각 순) */
export function listAllEventsForRagExport(): CalendarEvent[] {
  const rows = db
    .prepare(`${EVENT_SELECT} ORDER BY e.start_at ASC, e.id ASC`)
    .all() as EventRow[];
  return rows.map(toEvent);
}

/** 로컬 날짜(YYYY-MM-DD) 하루 일정 — 호출자가 dayStart/dayEnd ISO를 넘김 */
export function listEventsForLocalDay(params: {
  userId: number;
  dayStartIso: string;
  dayEndIso: string;
  scope?: "mine" | "all";
}): CalendarEvent[] {
  return listEventsForUser({
    userId: params.userId,
    from: params.dayStartIso,
    to: params.dayEndIso,
    scope: params.scope ?? "mine",
  });
}

function replaceAttendees(eventId: number, attendeeIds: number[]): void {
  db.prepare("DELETE FROM calendar_attendees WHERE event_id = ?").run(eventId);
  if (attendeeIds.length === 0) return;

  const insert = db.prepare(
    "INSERT INTO calendar_attendees (event_id, user_id, response_status) VALUES (?, ?, 'invited')"
  );
  const activeIds = db
    .prepare(
      `SELECT id FROM users WHERE is_active = 1 AND username != ? AND id IN (${attendeeIds
        .map(() => "?")
        .join(",")})`
    )
    .all(AI_USERNAME, ...attendeeIds) as { id: number }[];

  const tx = db.transaction(() => {
    for (const row of activeIds) {
      insert.run(eventId, row.id);
    }
  });
  tx();
}

export function createEvent(createdBy: number, input: CalendarEventInput): CalendarEvent {
  const visibility: CalendarVisibility = input.visibility === "private" ? "private" : "company";
  const reminderMinutes =
    input.reminderMinutes == null || Number.isNaN(input.reminderMinutes)
      ? 10
      : Math.max(0, Math.floor(input.reminderMinutes));
  const color = normalizeEventColor(input.color);

  const result = db
    .prepare(
      `INSERT INTO calendar_events
        (title, description, location, start_at, end_at, all_day, visibility, reminder_minutes, color, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.title.trim(),
      input.description?.trim() || null,
      input.location?.trim() || null,
      input.startAt,
      input.endAt,
      input.allDay ? 1 : 0,
      visibility,
      reminderMinutes,
      color,
      createdBy
    );

  const eventId = Number(result.lastInsertRowid);
  const attendeeIds = (input.attendeeIds ?? []).filter((id) => id !== createdBy);
  replaceAttendees(eventId, attendeeIds);
  return getEventById(eventId)!;
}

export function updateEvent(
  eventId: number,
  input: CalendarEventInput
): CalendarEvent | null {
  const existing = getEventById(eventId);
  if (!existing) return null;

  const visibility: CalendarVisibility = input.visibility === "private" ? "private" : "company";
  const reminderMinutes =
    input.reminderMinutes == null || Number.isNaN(input.reminderMinutes)
      ? existing.reminderMinutes
      : Math.max(0, Math.floor(input.reminderMinutes));
  const color = normalizeEventColor(input.color ?? existing.color);

  db.prepare(
    `UPDATE calendar_events SET
      title = ?, description = ?, location = ?, start_at = ?, end_at = ?,
      all_day = ?, visibility = ?, reminder_minutes = ?, color = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(
    input.title.trim(),
    input.description?.trim() || null,
    input.location?.trim() || null,
    input.startAt,
    input.endAt,
    input.allDay ? 1 : 0,
    visibility,
    reminderMinutes,
    color,
    eventId
  );

  // 시작/리마인더가 바뀌면 이전 리마인더 발송 기록 초기화
  if (
    existing.startAt !== input.startAt ||
    existing.reminderMinutes !== reminderMinutes
  ) {
    db.prepare("DELETE FROM calendar_reminder_sent WHERE event_id = ?").run(eventId);
  }

  const attendeeIds = (input.attendeeIds ?? []).filter((id) => id !== existing.createdBy);
  replaceAttendees(eventId, attendeeIds);
  return getEventById(eventId);
}

export function deleteEvent(eventId: number): boolean {
  const result = db.prepare("DELETE FROM calendar_events WHERE id = ?").run(eventId);
  return result.changes > 0;
}

/** 영향받는 사용자 id (생성자 + 참석자) */
export function eventParticipantIds(event: CalendarEvent): number[] {
  const ids = new Set<number>([event.createdBy]);
  for (const a of event.attendees) ids.add(a.userId);
  return [...ids];
}

export interface DueReminderRow {
  eventId: number;
}

/** 리마인더 시각이 지났고 아직 미발송인 일정 (시작 전이면서 reminder 시각 도달) */
export function listDueReminders(nowMs: number = Date.now()): CalendarEvent[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.start_at, e.reminder_minutes
       FROM calendar_events e
       LEFT JOIN calendar_reminder_sent s ON s.event_id = e.id
       WHERE e.reminder_minutes > 0
         AND s.event_id IS NULL`
    )
    .all() as { id: number; start_at: string; reminder_minutes: number }[];

  const due: CalendarEvent[] = [];
  for (const row of rows) {
    const startMs = Date.parse(row.start_at);
    if (Number.isNaN(startMs)) continue;
    if (startMs <= nowMs) continue; // 이미 시작됨
    const remindAt = startMs - row.reminder_minutes * 60_000;
    if (remindAt > nowMs) continue;
    const event = getEventById(row.id);
    if (event) due.push(event);
  }
  return due;
}

export function markReminderSent(eventId: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO calendar_reminder_sent (event_id) VALUES (?)`
  ).run(eventId);
}
