import { useMemo, useState } from "react";
import type { PublicUser, Room } from "@intra-chat/shared";
import { createDm, leaveRoom } from "../api";
import { NewRoomModal } from "./NewRoomModal";

interface Props {
  rooms: Room[];
  users: PublicUser[];
  currentUser: PublicUser;
  selectedRoomId: number | null;
  connectionError: string | null;
  onSelectRoom: (roomId: number) => void;
  onRoomsChanged: () => Promise<Room[]>;
  onLogout: () => void;
}

export function Sidebar({
  rooms,
  users,
  currentUser,
  selectedRoomId,
  connectionError,
  onSelectRoom,
  onRoomsChanged,
  onLogout,
}: Props): JSX.Element {
  const [modalType, setModalType] = useState<"channel" | "group" | null>(null);
  const [showDmPicker, setShowDmPicker] = useState(false);

  const channels = useMemo(() => rooms.filter((r) => r.type === "channel"), [rooms]);
  const groups = useMemo(() => rooms.filter((r) => r.type === "group"), [rooms]);
  const dms = useMemo(() => rooms.filter((r) => r.type === "dm"), [rooms]);
  const aiRooms = useMemo(() => rooms.filter((r) => r.type === "ai"), [rooms]);

  function dmDisplayName(room: Room): string {
    // DM 방 이름 "dm:a:b" 에서 상대방 id 를 찾아 표시이름으로 변환
    const ids = room.name.replace("dm:", "").split(":").map(Number);
    const otherId = ids.find((id) => id !== currentUser.id);
    const other = users.find((u) => u.id === otherId);
    return other?.displayName ?? "알 수 없는 사용자";
  }

  async function handleStartDm(userId: number): Promise<void> {
    const room = await createDm(userId);
    await onRoomsChanged();
    onSelectRoom(room.id);
    setShowDmPicker(false);
  }

  async function handleLeave(room: Room): Promise<void> {
    const label = room.type === "dm" ? "이 DM을 목록에서 숨기시겠습니까?" : `'${room.name}' 방에서 나가시겠습니까?`;
    if (!confirm(label)) return;
    await leaveRoom(room.id);
    await onRoomsChanged();
  }

  function renderRoomItem(room: Room, label: string, prefix: string): JSX.Element {
    const active = room.id === selectedRoomId;
    const unread = room.unreadCount ?? 0;
    return (
      <li key={room.id} className={`room-item ${active ? "active" : ""}`}>
        <button className="room-btn" onClick={() => onSelectRoom(room.id)}>
          <span className="room-name">
            {prefix}
            {label}
          </span>
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        {room.type !== "ai" && (
          <button className="room-leave" title="나가기/숨기기" onClick={() => handleLeave(room)}>
            ×
          </button>
        )}
      </li>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="workspace-name">Intra-Chat</div>
        <div className={`conn-status ${connectionError ? "off" : "on"}`}>
          {connectionError ? "연결 끊김 (재연결 시도 중)" : "온라인"}
        </div>
      </div>

      <div className="sidebar-scroll">
        <Section title="AI" items={aiRooms.map((r) => renderRoomItem(r, r.name, "🤖 "))} />
        <Section
          title="채널"
          onAdd={() => setModalType("channel")}
          items={channels.map((r) => renderRoomItem(r, r.name, "# "))}
        />
        <Section
          title="그룹채팅"
          onAdd={() => setModalType("group")}
          items={groups.map((r) => renderRoomItem(r, r.name, "◆ "))}
        />
        <Section
          title="다이렉트 메시지"
          onAdd={() => setShowDmPicker((v) => !v)}
          items={dms.map((r) => renderRoomItem(r, dmDisplayName(r), "@ "))}
        />

        {showDmPicker && (
          <ul className="dm-picker">
            {users
              .filter((u) => u.id !== currentUser.id)
              .map((u) => (
                <li key={u.id}>
                  <button className="dm-picker-item" onClick={() => handleStartDm(u.id)}>
                    <span className={`presence-dot ${u.isOnline ? "online" : ""}`} />
                    {u.displayName}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="me">
          <span className="presence-dot online" />
          <span className="me-name">{currentUser.displayName}</span>
        </div>
        <button className="btn-logout" onClick={onLogout}>
          로그아웃
        </button>
      </div>

      {modalType && (
        <NewRoomModal
          type={modalType}
          users={users.filter((u) => u.id !== currentUser.id)}
          onClose={() => setModalType(null)}
          onCreated={async (room) => {
            await onRoomsChanged();
            onSelectRoom(room.id);
            setModalType(null);
          }}
        />
      )}
    </aside>
  );
}

function Section({
  title,
  items,
  onAdd,
}: {
  title: string;
  items: JSX.Element[];
  onAdd?: () => void;
}): JSX.Element {
  return (
    <div className="section">
      <div className="section-header">
        <span>{title}</span>
        {onAdd && (
          <button className="section-add" title="새로 만들기" onClick={onAdd}>
            +
          </button>
        )}
      </div>
      <ul className="room-list">{items}</ul>
    </div>
  );
}
