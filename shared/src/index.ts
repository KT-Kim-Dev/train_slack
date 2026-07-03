/**
 * 서버와 클라이언트가 공유하는 타입 정의.
 * 데이터 모델(명세 7장)과 REST/Socket.IO 통신 계약을 한곳에서 관리하여
 * 서버-클라이언트 간 타입 불일치를 방지한다.
 */

// ---------------------------------------------------------------------------
// 도메인 엔티티
// ---------------------------------------------------------------------------

export type RoomType = "channel" | "group" | "dm" | "ai";
export type MessageType = "text" | "file" | "image" | "ai_response" | "card";

/** 다른 사용자에게 노출 가능한 사용자 공개 정보 (비밀번호 해시 제외) */
export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  isOnline: boolean;
  lastSeen: string | null;
  isAdmin: boolean;
}

/** 관리자 UI에서 편집하는 통합 연동 설정 */
export interface AdminSettings {
  ollama_url: string;
  ollama_model: string;
  ollama_timeout_ms: number;
  ai_context_limit: number;
  yona_url: string;
  /** 조회/수정 요청 시 서버가 비워서 응답 — 클라이언트에 평문 노출 방지 */
  yona_token: string;
  yona_default_project: string;
  jenkins_url: string;
  jenkins_user: string;
  /** 조회/수정 요청 시 서버가 비워서 응답 — 클라이언트에 평문 노출 방지 */
  jenkins_token: string;
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
  /** 카드 메시지(이슈/빌드)의 구조화 데이터 (message_type='card') */
  metadata: CardPayload | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 카드 메시지 (Yona 이슈 / Jenkins 빌드)
// ---------------------------------------------------------------------------

export interface IssueCard {
  kind: "issue";
  issueId: number | string;
  title: string;
  assignee: string | null;
  priority: string | null;
  status: string | null;
  dueDate: string | null;
  url: string | null;
}

export interface BuildCard {
  kind: "build";
  /** started: 빌드 시작, finished: 빌드 완료, status: 상태 조회 결과 */
  phase: "started" | "finished" | "status";
  project: string;
  buildNumber: number | null;
  status: string | null;
  durationSec: number | null;
  logUrl: string | null;
}

export type CardPayload = IssueCard | BuildCard;

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
// 업무 연동 REST 요청/응답 (Yona / Jenkins / AI)
// ---------------------------------------------------------------------------

export interface CreateIssueRequest {
  roomId: number;
  title: string;
  description?: string;
  assignee?: string;
  project?: string;
  labels?: string[];
}

export interface CreateIssueResponse {
  issueId: number | string;
  url: string;
}

export interface BuildStartResponse {
  buildNumber: number | null;
  queuedAt: string | null;
}

export interface BuildStatusResponse {
  status: string;
  durationSec: number | null;
  logUrl: string | null;
}

/** 사용 가능한 Ollama 모델 목록 및 연동 활성화 여부 */
export interface IntegrationsInfo {
  ai: { enabled: boolean; models: string[]; defaultModel: string | null };
  yona: { enabled: boolean };
  jenkins: { enabled: boolean };
}

// ---------------------------------------------------------------------------
// Socket.IO 이벤트 계약
// ---------------------------------------------------------------------------

/** AI 스트리밍 응답의 증분 이벤트 (FR-30) */
export interface AiDeltaEvent {
  roomId: number;
  messageId: number;
  delta: string;
  done: boolean;
  elapsedMs?: number;
  error?: string;
}

/** 서버 -> 클라이언트 이벤트 */
export interface ServerToClientEvents {
  "message:new": (message: Message) => void;
  "presence:update": (payload: { userId: number; isOnline: boolean; lastSeen: string | null }) => void;
  "room:created": (room: Room) => void;
  "ai:delta": (payload: AiDeltaEvent) => void;
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
  /** AI 질문 요청 (FR-28, FR-29): 서버가 질문을 저장/브로드캐스트 후 스트리밍 응답 */
  "ai:ask": (
    payload: { roomId: number; content: string; model?: string },
    ack?: (result: { ok: boolean; error?: string }) => void
  ) => void;
}

/** Socket 핸드셰이크 인증 페이로드 */
export interface SocketAuthPayload {
  token: string;
}
