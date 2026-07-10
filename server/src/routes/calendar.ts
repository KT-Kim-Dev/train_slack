import { Router } from "express";
import { z } from "zod";
import { CALENDAR_EVENT_COLORS, type CalendarEventColor, type CalendarEventInput } from "@intra-chat/shared";
import type { ScheduleCard } from "@intra-chat/shared";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import {
  canAccessEvent,
  canEditEvent,
  createEvent,
  deleteEvent,
  eventParticipantIds,
  getEventById,
  listEventsForUser,
  updateEvent,
} from "../db/calendar.js";
import { isMember } from "../db/rooms.js";
import { insertCardMessage } from "../db/messages.js";
import { logCommand } from "../db/integrations.js";
import { broadcastMessage, notifyCalendarEvent } from "../sockets/index.js";
import { sendAttendeeScheduleDms } from "../services/calendar-dm-notify.js";
import { scheduleCalendarScheduleExport } from "../services/calendar-rag-export.js";
import { logger } from "../logger.js";

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  allDay: z.boolean().optional(),
  visibility: z.enum(["private", "company"]).optional(),
  reminderMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  color: z
    .string()
    .refine((value) => (CALENDAR_EVENT_COLORS as readonly string[]).includes(value), {
      message: "유효하지 않은 일정 색상입니다.",
    })
    .optional(),
  attendeeIds: z.array(z.number().int().positive()).optional(),
});

function validateTimeRange(startAt: string, endAt: string, allDay?: boolean): string | null {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "시작/종료 시각 형식이 올바르지 않습니다.";
  }
  if (end < start) {
    return "종료 시각은 시작 시각 이후여야 합니다.";
  }
  if (!allDay && end === start) {
    return "종료 시각은 시작 시각보다 이후여야 합니다.";
  }
  return null;
}

function toEventInput(data: z.infer<typeof eventInputSchema>): CalendarEventInput {
  return {
    ...data,
    color: data.color as CalendarEventColor | undefined,
  };
}

/** 기간 내 일정 목록 (scope=mine|all) */
calendarRouter.get("/events", (req: AuthedRequest, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const scope = req.query.scope === "all" ? "all" : "mine";

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    res.status(400).json({ error: "from/to 쿼리(ISO)가 필요합니다." });
    return;
  }

  const events = listEventsForUser({
    userId: req.auth!.userId,
    from,
    to,
    scope,
  });
  res.json(events);
});

/**
 * 특정 일 일정 조회 후 채팅방에 카드 게시
 * 클라이언트가 로컬 자정 기준 from/to ISO 와 date(YYYY-MM-DD) 를 전달한다.
 */
calendarRouter.get("/schedule", (req: AuthedRequest, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const date = typeof req.query.date === "string" ? req.query.date : "";
  const roomId = req.query.roomId ? Number(req.query.roomId) : null;
  // 채팅 일정 조회는 기본으로 공개일정+내일정 포함
  const scope = req.query.scope === "mine" ? "mine" : "all";
  const startedAt = Date.now();

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    res.status(400).json({ error: "from/to 쿼리(ISO)가 필요합니다." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });
    return;
  }
  if (!roomId || !isMember(roomId, req.auth!.userId)) {
    res.status(403).json({ error: "이 방에 접근할 수 없습니다." });
    return;
  }

  const events = listEventsForUser({
    userId: req.auth!.userId,
    from,
    to,
    scope,
  });

  const [, month, day] = date.split("-").map(Number);
  const label = `${month}월 ${day}일 일정`;
  const card: ScheduleCard = {
    kind: "schedule",
    date,
    label,
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startAt: e.startAt,
      endAt: e.endAt,
      allDay: e.allDay,
      location: e.location,
      creatorName: e.creatorName,
      attendeeNames: e.attendees.map((a) => a.displayName),
    })),
  };

  const msg = insertCardMessage({
    roomId,
    senderId: req.auth!.userId,
    card,
    content: events.length === 0 ? `${label}: 없음` : `${label} ${events.length}건`,
  });
  broadcastMessage(msg);

  logCommand({
    userId: req.auth!.userId,
    command: "/calendar",
    parameter: date,
    success: true,
    elapsedMs: Date.now() - startedAt,
  });
  logger.info("캘린더 일정 조회 카드 게시", { roomId, date, count: events.length });
  res.json(card);
});

/** 단건 조회 */
calendarRouter.get("/events/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const event = getEventById(id);
  if (!event) {
    res.status(404).json({ error: "일정을 찾을 수 없습니다." });
    return;
  }
  if (!canAccessEvent(event, req.auth!.userId)) {
    res.status(403).json({ error: "이 일정에 접근할 수 없습니다." });
    return;
  }
  res.json(event);
});

/** 일정 생성 */
calendarRouter.post("/events", (req: AuthedRequest, res) => {
  const parsed = eventInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "일정 입력값이 올바르지 않습니다." });
    return;
  }

  const input = toEventInput(parsed.data);
  const rangeError = validateTimeRange(input.startAt, input.endAt, input.allDay);
  if (rangeError) {
    res.status(400).json({ error: rangeError });
    return;
  }

  const event = createEvent(req.auth!.userId, input);
  const targets = eventParticipantIds(event).filter((id) => id !== req.auth!.userId);
  notifyCalendarEvent("created", event, targets);
  // 참석자 추가 DM 알림
  sendAttendeeScheduleDms({
    fromUserId: req.auth!.userId,
    userIds: event.attendees.map((a) => a.userId),
    event,
    notice: "added",
  });
  logger.info("캘린더 일정 생성", { eventId: event.id, userId: req.auth!.userId });
  scheduleCalendarScheduleExport();
  res.status(201).json(event);
});

/** 일정 수정 (생성자만) */
calendarRouter.put("/events/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = getEventById(id);
  if (!existing) {
    res.status(404).json({ error: "일정을 찾을 수 없습니다." });
    return;
  }
  if (!canEditEvent(existing, req.auth!.userId)) {
    res.status(403).json({ error: "일정 수정 권한이 없습니다." });
    return;
  }

  const parsed = eventInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "일정 입력값이 올바르지 않습니다." });
    return;
  }

  const input = toEventInput(parsed.data);
  const rangeError = validateTimeRange(input.startAt, input.endAt, input.allDay);
  if (rangeError) {
    res.status(400).json({ error: rangeError });
    return;
  }

  const prevAttendeeIds = new Set(existing.attendees.map((a) => a.userId));
  const prevIds = new Set(eventParticipantIds(existing));
  const event = updateEvent(id, input);
  if (!event) {
    res.status(404).json({ error: "일정을 찾을 수 없습니다." });
    return;
  }

  const nextAttendeeIds = new Set(event.attendees.map((a) => a.userId));
  const added = [...nextAttendeeIds].filter((uid) => !prevAttendeeIds.has(uid));
  const removed = [...prevAttendeeIds].filter((uid) => !nextAttendeeIds.has(uid));

  const nextIds = eventParticipantIds(event);
  const notifyIds = [...new Set([...prevIds, ...nextIds])].filter(
    (uid) => uid !== req.auth!.userId
  );
  notifyCalendarEvent("updated", event, notifyIds);

  if (added.length > 0) {
    sendAttendeeScheduleDms({
      fromUserId: req.auth!.userId,
      userIds: added,
      event,
      notice: "added",
    });
  }
  if (removed.length > 0) {
    // 삭제된 참석자에게는 수정 전 일정 정보를 보여준다
    sendAttendeeScheduleDms({
      fromUserId: req.auth!.userId,
      userIds: removed,
      event: existing,
      notice: "removed",
    });
  }

  logger.info("캘린더 일정 수정", {
    eventId: event.id,
    userId: req.auth!.userId,
    added,
    removed,
  });
  scheduleCalendarScheduleExport();
  res.json(event);
});

/** 일정 삭제 (생성자만) */
calendarRouter.delete("/events/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = getEventById(id);
  if (!existing) {
    res.status(404).json({ error: "일정을 찾을 수 없습니다." });
    return;
  }
  if (!canEditEvent(existing, req.auth!.userId)) {
    res.status(403).json({ error: "일정 삭제 권한이 없습니다." });
    return;
  }

  const targets = eventParticipantIds(existing).filter((uid) => uid !== req.auth!.userId);
  const attendeeIds = existing.attendees.map((a) => a.userId);
  deleteEvent(id);
  notifyCalendarEvent("deleted", existing, targets);
  if (attendeeIds.length > 0) {
    sendAttendeeScheduleDms({
      fromUserId: req.auth!.userId,
      userIds: attendeeIds,
      event: existing,
      notice: "removed",
    });
  }
  logger.info("캘린더 일정 삭제", { eventId: id, userId: req.auth!.userId });
  scheduleCalendarScheduleExport();
  res.json({ ok: true });
});
