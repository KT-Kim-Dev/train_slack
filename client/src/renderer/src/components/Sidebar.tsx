import { useMemo, useState } from "react";
import type { PublicUser, Room } from "@intra-chat/shared";
import { PRESENCE_STATUS_LABELS } from "@intra-chat/shared";
import { createDm, leaveRoom } from "../api";
import { QUICK_LINKS } from "../constants/quickLinks";
import { sortUsers } from "../utils/sortUsers";
import { NewRoomModal } from "./NewRoomModal";
import { AdminSettingsModal } from "./AdminSettingsModal";
import { ProfileModal } from "./ProfileModal";
import { UserAvatar } from "./UserAvatar";

const SHOW_OFFLINE_KEY = "intra-chat-show-offline-members";

function readShowOffline(): boolean {
  const raw = localStorage.getItem(SHOW_OFFLINE_KEY);
  return raw !== "false";
}

interface Props {
  rooms: Room[];
  users: PublicUser[];
  currentUser: PublicUser;
  selectedRoomId: number | null;
  activeView: "chat" | "calendar";
  connectionError: string | null;
  onSelectRoom: (roomId: number) => void;
  onSelectCalendar: () => void;
  onRoomsChanged: () => Promise<Room[]>;
  onLogout: () => void;
  onSettingsSaved?: () => void | Promise<void>;
  onUserUpdated: (user: PublicUser) => void;
}

function userStatusLabel(user: PublicUser): string {
  if (!user.isOnline) return "오프라인";
  return PRESENCE_STATUS_LABELS[user.presenceStatus];
}

function presenceDotClass(user: PublicUser): string {
  if (!user.isOnline) return "presence-dot offline";
  return `presence-dot online ${user.presenceStatus}`;
}

export function Sidebar({
  rooms,
  users,
  currentUser,
  selectedRoomId,
  activeView,
  connectionError,
  onSelectRoom,
  onSelectCalendar,
  onRoomsChanged,
  onLogout,
  onSettingsSaved,
  onUserUpdated,
}: Props): JSX.Element {
  const [modalType, setModalType] = useState<"channel" | "group" | null>(null);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showOfflineMembers, setShowOfflineMembers] = useState(readShowOffline);

  const sortedUsers = useMemo(() => sortUsers(users), [users]);
  const visibleUsers = useMemo(() => {
    if (showOfflineMembers) return sortedUsers;
    return sortedUsers.filter((u) => u.isOnline || u.id === currentUser.id);
  }, [sortedUsers, showOfflineMembers, currentUser.id]);
  const otherUsers = useMemo(
    () => sortedUsers.filter((u) => u.id !== currentUser.id),
    [sortedUsers, currentUser.id]
  );

  const channels = useMemo(() => rooms.filter((r) => r.type === "channel"), [rooms]);
  const groups = useMemo(() => rooms.filter((r) => r.type === "group"), [rooms]);
  const dms = useMemo(() => rooms.filter((r) => r.type === "dm"), [rooms]);
  const aiRooms = useMemo(() => rooms.filter((r) => r.type === "ai"), [rooms]);

  function dmDisplayName(room: Room): string {
    const ids = room.name.replace("dm:", "").split(":").map(Number);
    const otherId = ids.find((id) => id !== currentUser.id);
    const other = users.find((u) => u.id === otherId);
    return other?.displayName ?? "알 수 없는 사용자";
  }

  function toggleShowOffline(): void {
    setShowOfflineMembers((prev) => {
      const next = !prev;
      localStorage.setItem(SHOW_OFFLINE_KEY, String(next));
      return next;
    });
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

  function openQuickLink(url: string): void {
    void window.intraChat?.openExternalUrl?.(url);
  }

  function renderRoomItem(room: Room, label: string, prefix: string): JSX.Element {
    const active = activeView === "chat" && room.id === selectedRoomId;
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

  function renderUserRow(user: PublicUser, onClick?: () => void): JSX.Element {
    return (
      <li key={user.id} className="user-list-item">
        <button type="button" className="user-list-btn" onClick={onClick}>
          <UserAvatar user={user} size={28} />
          <span className="user-list-meta">
            <span className="user-list-name">{user.displayName}</span>
            <span className="user-list-status">
              <span className={presenceDotClass(user)} />
              {userStatusLabel(user)}
            </span>
          </span>
        </button>
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
        <div className="section">
          <div className="section-header">
            <span>멤버 ({visibleUsers.length})</span>
            <button
              type="button"
              className={`section-toggle ${showOfflineMembers ? "on" : "off"}`}
              title={showOfflineMembers ? "오프라인 사용자 숨기기" : "오프라인 사용자 표시"}
              onClick={toggleShowOffline}
            >
              {showOfflineMembers ? "오프라인 ON" : "오프라인 OFF"}
            </button>
          </div>
          <ul className="user-list">
            {visibleUsers.map((u) =>
              renderUserRow(
                u,
                u.id === currentUser.id
                  ? () => setShowProfile(true)
                  : () => void handleStartDm(u.id)
              )
            )}
          </ul>
        </div>

        <Section
          title="채널"
          onAdd={() => setModalType("channel")}
          items={channels.map((r) => renderRoomItem(r, r.name, "# "))}
        />

        <Section title="AI" items={aiRooms.map((r) => renderRoomItem(r, r.name, "🤖 "))} />

        <div className="section">
          <ul className="room-list">
            <li className={`room-item ${activeView === "calendar" ? "active" : ""}`}>
              <button type="button" className="room-btn" onClick={onSelectCalendar}>
                <span className="room-name">📅 캘린더</span>
              </button>
            </li>
          </ul>
        </div>

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
            {otherUsers.map((u) => (
              <li key={u.id}>
                <button className="dm-picker-item" onClick={() => void handleStartDm(u.id)}>
                  <UserAvatar user={u} size={24} />
                  <span className="user-list-meta">
                    <span>{u.displayName}</span>
                    <span className="user-list-status">
                      <span className={presenceDotClass(u)} />
                      {userStatusLabel(u)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="section">
          <div className="section-header">
            <span>링크</span>
          </div>
          <ul className="room-list">
            {QUICK_LINKS.map((link) => (
              <li key={link.url} className="room-item">
                <button type="button" className="room-btn" onClick={() => openQuickLink(link.url)}>
                  <span className="room-name">🔗 {link.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="sidebar-footer">
        <button type="button" className="me profile-trigger" onClick={() => setShowProfile(true)}>
          <UserAvatar user={currentUser} size={28} />
          <span className="me-meta">
            <span className="me-name">{currentUser.displayName}</span>
            <span className="me-status">
              <span className={presenceDotClass(currentUser)} />
              {userStatusLabel(currentUser)}
            </span>
          </span>
          {currentUser.isAdmin && (
            <span className="admin-badge" title="관리자">
              ⚙
            </span>
          )}
        </button>
        <div className="footer-actions">
          {currentUser.isAdmin && (
            <button className="btn-settings" title="연동 설정" onClick={() => setShowSettings(true)}>
              설정
            </button>
          )}
          <button className="btn-logout" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </div>

      {showProfile && (
        <ProfileModal
          user={currentUser}
          onClose={() => setShowProfile(false)}
          onUpdated={onUserUpdated}
        />
      )}

      {showSettings && (
        <AdminSettingsModal
          currentUserId={currentUser.id}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            await onSettingsSaved?.();
          }}
        />
      )}

      {modalType && (
        <NewRoomModal
          type={modalType}
          users={otherUsers}
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
