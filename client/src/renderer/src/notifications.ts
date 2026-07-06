import type { Message, Room } from "@intra-chat/shared";
import { pushToast } from "./components/ToastStack";

interface NotifyParams {
  room: Room;
  message: Message;
  roomLabel: string;
}

function previewText(message: Message): string {
  if (message.content?.trim()) return message.content.trim().slice(0, 80);
  if (message.fileName) return `📎 ${message.fileName}`;
  return "새 메시지";
}

/** OS 알림 + 앱 내 우측 하단 토스트 */
export function notifyIncomingMessage({ room, message, roomLabel }: NotifyParams): void {
  const body = `${message.senderName}: ${previewText(message)}`;
  const title = roomLabel;

  pushToast({ title, body, roomId: room.id });

  if (window.intraChat?.showNotification) {
    void window.intraChat.showNotification({ title, body, roomId: room.id });
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
