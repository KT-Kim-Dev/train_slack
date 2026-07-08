import type { CalendarEvent, ScheduleCard, ScheduleCardItem } from "@intra-chat/shared";
import {
  addMember,
  createRoom,
  findDmRoom,
  hideRoom,
  toRoom,
} from "../db/rooms.js";
import { insertCardMessage } from "../db/messages.js";
import { broadcastMessage, notifyRoomCreated } from "../sockets/index.js";
import { logger } from "../logger.js";

function toScheduleItem(event: CalendarEvent): ScheduleCardItem {
  return {
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    location: event.location,
    creatorName: event.creatorName,
    attendeeNames: event.attendees.map((a) => a.displayName),
  };
}

function eventLocalDate(event: CalendarEvent): string {
  const d = new Date(event.startAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 두 사용자 간 DM 방을 찾거나 새로 만들고, 숨김이면 다시 표시한다 */
export function ensureDmRoom(fromUserId: number, toUserId: number): number {
  let room = findDmRoom(fromUserId, toUserId);
  if (!room) {
    room = createRoom({
      name: `dm:${Math.min(fromUserId, toUserId)}:${Math.max(fromUserId, toUserId)}`,
      type: "dm",
      createdBy: fromUserId,
    });
    addMember(room.id, fromUserId);
    addMember(room.id, toUserId);
    notifyRoomCreated(toRoom(room, 0), [fromUserId, toUserId]);
    logger.info("일정 알림용 DM 생성", { roomId: room.id, fromUserId, toUserId });
  } else {
    hideRoom(room.id, fromUserId, false);
    hideRoom(room.id, toUserId, false);
  }
  return room.id;
}

function buildNoticeCard(
  event: CalendarEvent,
  notice: "added" | "removed"
): { card: ScheduleCard; content: string } {
  const content =
    notice === "added" ? "일정에 추가되었습니다." : "일정에 삭제되었습니다.";
  const card: ScheduleCard = {
    kind: "schedule",
    date: eventLocalDate(event),
    label: content,
    notice,
    events: [toScheduleItem(event)],
  };
  return { card, content };
}

/** 참석자 1명에게 DM으로 추가/삭제 일정 카드 전송 */
export function sendAttendeeScheduleDm(params: {
  fromUserId: number;
  toUserId: number;
  event: CalendarEvent;
  notice: "added" | "removed";
}): void {
  if (params.fromUserId === params.toUserId) return;
  const roomId = ensureDmRoom(params.fromUserId, params.toUserId);
  const { card, content } = buildNoticeCard(params.event, params.notice);
  const msg = insertCardMessage({
    roomId,
    senderId: params.fromUserId,
    card,
    content,
  });
  broadcastMessage(msg);
}

/** 여러 참석자에게 동일 알림 */
export function sendAttendeeScheduleDms(params: {
  fromUserId: number;
  userIds: number[];
  event: CalendarEvent;
  notice: "added" | "removed";
}): void {
  for (const uid of [...new Set(params.userIds)]) {
    if (uid === params.fromUserId) continue;
    try {
      sendAttendeeScheduleDm({
        fromUserId: params.fromUserId,
        toUserId: uid,
        event: params.event,
        notice: params.notice,
      });
    } catch (err) {
      logger.warn("일정 참석자 DM 알림 실패", {
        toUserId: uid,
        eventId: params.event.id,
        notice: params.notice,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
