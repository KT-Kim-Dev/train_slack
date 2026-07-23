import type { CalendarEvent, CalendarEventAction, Message, Room } from "@intra-chat/shared";
import { pushToast } from "./components/ToastStack";

export type NotificationNavTarget =
  | { type: "room"; roomId: number }
  | { type: "calendar"; eventId: number };

interface NotifyParams {
  room: Room;
  message: Message;
  roomLabel: string;
  /** 현재 보고 있는 방이면 인앱 토스트 생략 */
  skipInAppToast?: boolean;
}

function previewText(message: Message): string {
  if (message.content?.trim()) return message.content.trim().slice(0, 80);
  if (message.fileName) return `📎 ${message.fileName}`;
  return "새 메시지";
}

/** 앱 내 토스트(활성 창) + 트레이 토스트 + 작업 표시줄 반짝임 */
export function notifyIncomingMessage({
  room,
  message,
  roomLabel,
  skipInAppToast = false,
}: NotifyParams): void {
  const body = `${message.senderName}: ${previewText(message)}`;
  const title = roomLabel;

  if (!skipInAppToast) {
    pushToast({ title, body, target: { type: "room", roomId: room.id } });
  }

  if (window.intraChat?.showNotification) {
    void window.intraChat.showNotification({
      title,
      body,
      target: { type: "room", roomId: room.id },
    });
  }
}

const CALENDAR_ACTION_TITLE: Record<CalendarEventAction, string> = {
  created: "새 일정 초대",
  updated: "일정 변경",
  deleted: "일정 삭제",
  reminder: "일정 알림",
};

export function notifyCalendarEvent(
  action: CalendarEventAction,
  event: CalendarEvent
): void {
  const title = CALENDAR_ACTION_TITLE[action];
  const when = event.allDay
    ? "종일"
    : new Date(event.startAt).toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  const body = `${event.title} · ${when}`;

  pushToast({ title, body, target: { type: "calendar", eventId: event.id } });

  if (window.intraChat?.showNotification) {
    void window.intraChat.showNotification({
      title,
      body,
      target: { type: "calendar", eventId: event.id },
    });
  }
}

export function roomNotificationLabel(
  room: Room,
  users: { id: number; displayName: string }[],
  currentUserId: number
): string {
  if (room.type === "channel") return `# ${room.name}`;
  if (room.type === "group") return `◆ ${room.name}`;
  if (room.type === "dm") {
    const ids = room.name.replace("dm:", "").split(":").map(Number);
    const otherId = ids.find((id) => id !== currentUserId);
    const other = users.find((u) => u.id === otherId);
    return `@ ${other?.displayName ?? "DM"}`;
  }
  return room.name;
}
