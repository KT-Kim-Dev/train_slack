import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiDeltaEvent,
  CalendarEventSocketPayload,
  IntegrationsInfo,
  Message,
  PublicUser,
  Room,
} from "@intra-chat/shared";
import { fetchIntegrations, fetchRooms, fetchUsers, getToken, updateStoredUser } from "../api";
import {
  notifyCalendarEvent,
  notifyIncomingMessage,
  roomNotificationLabel,
  type NotificationNavTarget,
} from "../notifications";
import { connectSocket, disconnectSocket } from "../socket";
import { sortUsers } from "../utils/sortUsers";
import { Sidebar } from "./Sidebar";
import { ChatRoom } from "./ChatRoom";
import { CalendarPage } from "./CalendarPage";
import { ToastStack } from "./ToastStack";

/** 활성 채팅방이 등록하는 실시간 이벤트 핸들러 */
export interface ActiveRoomHandlers {
  onMessage: (msg: Message) => void;
  onAiDelta: (payload: AiDeltaEvent) => void;
}

interface Props {
  currentUser: PublicUser;
  onLogout: () => void;
  onUserUpdated: (user: PublicUser) => void;
}

export function ChatPage({ currentUser, onLogout, onUserUpdated }: Props): JSX.Element {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [mainView, setMainView] = useState<"chat" | "calendar">("chat");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsInfo | null>(null);
  const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
  const [focusEventId, setFocusEventId] = useState<number | null>(null);

  // 활성 방으로 들어온 실시간 이벤트를 ChatRoom 에 전달하기 위한 콜백 등록소
  const activeRoomHandler = useRef<ActiveRoomHandlers | null>(null);
  const selectedRoomIdRef = useRef<number | null>(null);
  const mainViewRef = useRef<"chat" | "calendar">("chat");
  const currentUserIdRef = useRef(currentUser.id);
  const roomsRef = useRef<Room[]>([]);
  const usersRef = useRef<PublicUser[]>([]);
  const onUserUpdatedRef = useRef(onUserUpdated);
  const onLogoutRef = useRef(onLogout);
  selectedRoomIdRef.current = selectedRoomId;
  mainViewRef.current = mainView;
  currentUserIdRef.current = currentUser.id;
  roomsRef.current = rooms;
  usersRef.current = users;
  onUserUpdatedRef.current = onUserUpdated;
  onLogoutRef.current = onLogout;

  /** presence(온라인/상태)는 users 목록, 프로필(아바타 등)은 App 세션과 병합 */
  const liveFromList = users.find((u) => u.id === currentUser.id);
  const liveCurrentUser: PublicUser = liveFromList
    ? {
        ...currentUser,
        isOnline: liveFromList.isOnline,
        lastSeen: liveFromList.lastSeen,
        presenceStatus: liveFromList.presenceStatus,
        profileImageUrl: liveFromList.profileImageUrl ?? currentUser.profileImageUrl,
      }
    : currentUser;

  const reloadRooms = useCallback(async () => {
    const list = await fetchRooms();
    setRooms(list);
    return list;
  }, []);

  const reloadIntegrations = useCallback(async () => {
    try {
      setIntegrations(await fetchIntegrations());
    } catch {
      /* 연동 정보 로딩 실패는 채팅 기능에 영향 없음 */
    }
  }, []);

  // 소켓 연결 및 이벤트 구독
  useEffect(() => {
    const token = getToken();
    if (!token) {
      onLogoutRef.current();
      return;
    }
    const socket = connectSocket(token);

    socket.on("connect_error", (err) => {
      // 계정 비활성화/삭제 등으로 인증 실패 시 로그아웃 (FR-04)
      setConnectionError(err.message);
      if (/토큰|계정|인증/.test(err.message)) onLogoutRef.current();
    });
    socket.on("connect", () => setConnectionError(null));

    socket.on("message:new", (message) => {
      if (
        mainViewRef.current === "chat" &&
        message.roomId === selectedRoomIdRef.current &&
        activeRoomHandler.current
      ) {
        activeRoomHandler.current.onMessage(message);
      } else {
        setRooms((prev) =>
          prev.map((r) =>
            r.id === message.roomId ? { ...r, unreadCount: (r.unreadCount ?? 0) + 1 } : r
          )
        );

        if (message.senderId !== currentUserIdRef.current && message.messageType !== "system") {
          const room = roomsRef.current.find((r) => r.id === message.roomId);
          if (room && (room.type === "channel" || room.type === "dm" || room.type === "group")) {
            const label = roomNotificationLabel(room, usersRef.current, currentUserIdRef.current);
            notifyIncomingMessage({ room, message, roomLabel: label });
          }
        }
      }
    });

    socket.on("ai:delta", (payload) => {
      if (payload.roomId === selectedRoomIdRef.current && activeRoomHandler.current) {
        activeRoomHandler.current.onAiDelta(payload);
      }
    });

    socket.on("calendar:event", (payload: CalendarEventSocketPayload) => {
      setCalendarRefreshToken((n) => n + 1);
      notifyCalendarEvent(payload.action, payload.event);
    });

    socket.on("room:earthquake:shake", ({ roomId }) => {
      void window.intraChat?.earthquakeShake?.({ roomId });
    });

    socket.on("presence:update", ({ userId, isOnline, lastSeen, presenceStatus }) => {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, isOnline, lastSeen, presenceStatus } : u
        )
      );
    });

    socket.on("user:updated", (user) => {
      setUsers((prev) => {
        const idx = prev.findIndex((u) => u.id === user.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = user;
          return next;
        }
        return sortUsers([...prev, user]);
      });
      if (user.id === currentUserIdRef.current) {
        onUserUpdatedRef.current(user);
        updateStoredUser(user);
      }
    });

    socket.on("user:removed", ({ userId }) => {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    });

    socket.on("room:created", (room) => {
      setRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [...prev, room]));
    });

    socket.on("room:unhidden", (room) => {
      setRooms((prev) => {
        const idx = prev.findIndex((r) => r.id === room.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = room;
          return next;
        }
        return [...prev, room];
      });
    });

    return () => {
      disconnectSocket();
    };
  }, []);

  function handleSelectRoom(roomId: number): void {
    setMainView("chat");
    setSelectedRoomId(roomId);
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)));
  }

  function handleSelectCalendar(): void {
    setMainView("calendar");
  }

  function handleNavigate(target: NotificationNavTarget): void {
    if (target.type === "room") {
      handleSelectRoom(target.roomId);
      return;
    }
    setMainView("calendar");
    setFocusEventId(target.eventId);
  }

  // OS 알림 클릭 시 해당 방/캘린더로 이동
  useEffect(() => {
    const unsub = window.intraChat?.onNotificationNavigate?.((target) => {
      handleNavigate(target);
    });
    return () => unsub?.();
  }, []);

  // 초기 데이터 로딩
  useEffect(() => {
    void (async () => {
      try {
        const [roomList] = await Promise.all([reloadRooms(), loadUsers(), reloadIntegrations()]);
        if (roomList.length > 0 && selectedRoomIdRef.current === null) {
          setSelectedRoomId(roomList[0].id);
        }
      } catch {
        onLogout();
      }
    })();
    async function loadUsers(): Promise<void> {
      setUsers(await fetchUsers());
    }
  }, [reloadRooms, reloadIntegrations, onLogout]);

  const registerActiveHandler = useCallback((handlers: ActiveRoomHandlers | null) => {
    activeRoomHandler.current = handlers;
  }, []);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  return (
    <div className="chat-layout">
      <Sidebar
        rooms={rooms}
        users={users}
        currentUser={liveCurrentUser}
        selectedRoomId={selectedRoomId}
        activeView={mainView}
        connectionError={connectionError}
        onSelectRoom={handleSelectRoom}
        onSelectCalendar={handleSelectCalendar}
        onRoomsChanged={reloadRooms}
        onLogout={onLogout}
        onSettingsSaved={reloadIntegrations}
        onUserUpdated={(user) => {
          onUserUpdated(user);
          updateStoredUser(user);
        }}
      />
      {mainView === "calendar" ? (
        <CalendarPage
          currentUser={liveCurrentUser}
          users={users}
          focusEventId={focusEventId}
          onFocusConsumed={() => setFocusEventId(null)}
          refreshToken={calendarRefreshToken}
        />
      ) : selectedRoom ? (
        <ChatRoom
          key={selectedRoom.id}
          room={selectedRoom}
          currentUser={liveCurrentUser}
          users={users}
          integrations={integrations}
          registerActiveHandler={registerActiveHandler}
        />
      ) : (
        <div className="empty-room">왼쪽에서 채팅방을 선택하거나 새로 만들어 보세요.</div>
      )}
      <ToastStack onNavigate={handleNavigate} />
    </div>
  );
}
