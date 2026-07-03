import { useCallback, useEffect, useRef, useState } from "react";
import type { AiDeltaEvent, IntegrationsInfo, Message, PublicUser, Room } from "@intra-chat/shared";
import { fetchIntegrations, fetchRooms, fetchUsers, getToken } from "../api";
import { connectSocket, disconnectSocket } from "../socket";
import { Sidebar } from "./Sidebar";
import { ChatRoom } from "./ChatRoom";

/** 활성 채팅방이 등록하는 실시간 이벤트 핸들러 */
export interface ActiveRoomHandlers {
  onMessage: (msg: Message) => void;
  onAiDelta: (payload: AiDeltaEvent) => void;
}

interface Props {
  currentUser: PublicUser;
  onLogout: () => void;
}

export function ChatPage({ currentUser, onLogout }: Props): JSX.Element {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsInfo | null>(null);

  // 활성 방으로 들어온 실시간 이벤트를 ChatRoom 에 전달하기 위한 콜백 등록소
  const activeRoomHandler = useRef<ActiveRoomHandlers | null>(null);
  const selectedRoomIdRef = useRef<number | null>(null);
  selectedRoomIdRef.current = selectedRoomId;

  const reloadRooms = useCallback(async () => {
    const list = await fetchRooms();
    setRooms(list);
    return list;
  }, []);

  // 소켓 연결 및 이벤트 구독
  useEffect(() => {
    const token = getToken();
    if (!token) {
      onLogout();
      return;
    }
    const socket = connectSocket(token);

    socket.on("connect_error", (err) => {
      // 계정 비활성화/삭제 등으로 인증 실패 시 로그아웃 (FR-04)
      setConnectionError(err.message);
      if (/토큰|계정|인증/.test(err.message)) onLogout();
    });
    socket.on("connect", () => setConnectionError(null));

    socket.on("message:new", (message) => {
      if (message.roomId === selectedRoomIdRef.current && activeRoomHandler.current) {
        activeRoomHandler.current.onMessage(message);
      } else {
        // 다른 방 메시지는 미읽음 배지 증가 (FR-09)
        setRooms((prev) =>
          prev.map((r) =>
            r.id === message.roomId ? { ...r, unreadCount: (r.unreadCount ?? 0) + 1 } : r
          )
        );
      }
    });

    socket.on("ai:delta", (payload) => {
      if (payload.roomId === selectedRoomIdRef.current && activeRoomHandler.current) {
        activeRoomHandler.current.onAiDelta(payload);
      }
    });

    socket.on("presence:update", ({ userId, isOnline, lastSeen }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isOnline, lastSeen } : u))
      );
    });

    socket.on("room:created", (room) => {
      setRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [...prev, room]));
    });

    return () => {
      disconnectSocket();
    };
  }, [onLogout]);

  // 초기 데이터 로딩
  useEffect(() => {
    void (async () => {
      try {
        const [roomList] = await Promise.all([reloadRooms(), loadUsers(), loadIntegrations()]);
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
    async function loadIntegrations(): Promise<void> {
      try {
        setIntegrations(await fetchIntegrations());
      } catch {
        /* 연동 정보 로딩 실패는 채팅 기능에 영향 없음 */
      }
    }
  }, [reloadRooms, onLogout]);

  function handleSelectRoom(roomId: number): void {
    setSelectedRoomId(roomId);
    // 배지 초기화
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)));
  }

  const registerActiveHandler = useCallback((handlers: ActiveRoomHandlers | null) => {
    activeRoomHandler.current = handlers;
  }, []);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  return (
    <div className="chat-layout">
      <Sidebar
        rooms={rooms}
        users={users}
        currentUser={currentUser}
        selectedRoomId={selectedRoomId}
        connectionError={connectionError}
        onSelectRoom={handleSelectRoom}
        onRoomsChanged={reloadRooms}
        onLogout={onLogout}
      />
      {selectedRoom ? (
        <ChatRoom
          key={selectedRoom.id}
          room={selectedRoom}
          currentUser={currentUser}
          integrations={integrations}
          registerActiveHandler={registerActiveHandler}
        />
      ) : (
        <div className="empty-room">왼쪽에서 채팅방을 선택하거나 새로 만들어 보세요.</div>
      )}
    </div>
  );
}
