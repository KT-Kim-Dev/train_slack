/**
 * 서버와 클라이언트가 공유하는 타입 정의.
 * 데이터 모델(명세 7장)과 REST/Socket.IO 통신 계약을 한곳에서 관리하여
 * 서버-클라이언트 간 타입 불일치를 방지한다.
 */

// ---------------------------------------------------------------------------
// 도메인 엔티티
// ---------------------------------------------------------------------------

export type RoomType = "channel" | "group" | "dm";
export type MessageType = "text" | "file" | "image";

/** 다른 사용자에게 노출 가능한 사용자 공개 정보 (비밀번호 해시 제외) */
export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  isOnline: boolean;
  lastSeen: string | null;
}

export interface Room {
  id: number;
  name: string;
  type: RoomType;
  createdBy: number;
  createdAt: string;
  /** 미읽음 메시지 수 (사이드바 배지용, 서버가 사용자별로 계산) */
  unreadCount?: number;
}

export interface Message {
  id: number;
  roomId: number;
  senderId: number;
  senderName: string;
  messageType: MessageType;
  /** 텍스트 메시지 본문 (파일/이미지 메시지는 캡션 용도로 비어 있을 수 있음) */
  content: string | null;
  fileName: string | null;
  /** 다운로드/미리보기용 상대 경로 (예: /api/files/123) */
  fileUrl: string | null;
  fileSize: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// REST API 요청/응답
// ---------------------------------------------------------------------------

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: PublicUser;
}

export interface MessagePage {
  messages: Message[];
  /** 더 이전 메시지를 조회할 때 사용할 커서 (가장 오래된 메시지 id). null이면 더 없음 */
  nextCursor: number | null;
  hasMore: boolean;
}

export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------------------
// Socket.IO 이벤트 계약
// ---------------------------------------------------------------------------

/** 서버 -> 클라이언트 이벤트 */
export interface ServerToClientEvents {
  "message:new": (message: Message) => void;
  "presence:update": (payload: { userId: number; isOnline: boolean; lastSeen: string | null }) => void;
  "room:created": (room: Room) => void;
  "error": (payload: { message: string }) => void;
}

/** 클라이언트 -> 서버 이벤트 */
export interface ClientToServerEvents {
  "room:join": (roomId: number, ack?: (ok: boolean) => void) => void;
  "room:leave": (roomId: number) => void;
  "message:send": (
    payload: { roomId: number; content: string },
    ack?: (result: { ok: boolean; message?: Message; error?: string }) => void
  ) => void;
}

/** Socket 핸드셰이크 인증 페이로드 */
export interface SocketAuthPayload {
  token: string;
}
