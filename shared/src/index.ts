/**
 * 서버와 클라이언트가 공유하는 타입 정의.
 * 데이터 모델(명세 7장)과 REST/Socket.IO 통신 계약을 한곳에서 관리하여
 * 서버-클라이언트 간 타입 불일치를 방지한다.
 */

// ---------------------------------------------------------------------------
// 도메인 엔티티
// ---------------------------------------------------------------------------

export type RoomType = "channel" | "group" | "dm" | "ai";
export type MessageType = "text" | "file" | "image" | "ai_response" | "card" | "system";

/** 사용자가 설정하는 온라인 상태 (대화가능/바쁨/자리비움) */
export type UserPresenceStatus = "available" | "busy" | "away";

export const PRESENCE_STATUS_LABELS: Record<UserPresenceStatus, string> = {
  available: "대화 가능",
  busy: "바쁨",
  away: "자리 비움",
};

/** 다른 사용자에게 노출 가능한 사용자 공개 정보 (비밀번호 해시 제외) */
export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  isOnline: boolean;
  lastSeen: string | null;
  isAdmin: boolean;
  /** 프로필 이미지 URL (없으면 null → 이니셜 아바타 표시) */
  profileImageUrl: string | null;
  /** 온라인일 때 표시할 사용자 상태 */
  presenceStatus: UserPresenceStatus;
}

export type AiReplyLanguage = "ko" | "en" | "auto";

/** 관리자 UI에서 편집하는 통합 연동 설정 */
export interface AdminSettings {
  ollama_url: string;
  ollama_model: string;
  ollama_timeout_ms: number;
  ai_context_limit: number;
  /** AI 응답 언어 (ko: 한국어, en: English, auto: 질문 언어 따름) */
  ai_reply_language: AiReplyLanguage;
  /** AI system 프롬프트에 추가되는 사용자 지시사항 */
  ai_extra_instructions: string;
  /** thinking 모델의 추론(reasoning) 과정을 채팅에 표시할지 여부 */
  ai_show_reasoning: boolean;
  /** RAG 지식 베이스 사용 여부 */
  rag_enabled: boolean;
  /** RAG 자동 학습 (/ai Q&A 저장) */
  rag_auto_learn: boolean;
  /** Ollama 임베딩 모델명 */
  rag_embedding_model: string;
  /** RAG 검색 시 참고할 최대 조각 수 */
  rag_top_k: number;
  /** RAG 문서를 불러올 폴더 경로 (로컬/네트워크) */
  rag_shared_folder: string;
  /** 마지막 문서 폴더 동기화 시각 (ISO) */
  rag_last_sync_at: string;
  yona_url: string;
  /** 조회/수정 요청 시 서버가 비워서 응답 — 클라이언트에 평문 노출 방지 */
  yona_token: string;
  yona_default_project: string;
  jenkins_url: string;
  jenkins_user: string;
  /** 조회/수정 요청 시 서버가 비워서 응답 — 클라이언트에 평문 노출 방지 */
  jenkins_token: string;
}

/** RAG 지식 베이스 통계 */
export interface RagStats {
  totalChunks: number;
  qaChunks: number;
  documentChunks: number;
  ragEnabled: boolean;
  ragAutoLearn: boolean;
  sharedFolder: string;
  lastSyncAt: string | null;
}

/** 관리자 사용자 목록 (활성 여부 포함) */
export interface AdminUserView extends PublicUser {
  isActive: boolean;
}

/** 문서 폴더 RAG 동기화 결과 */
export interface RagSyncResult {
  filesProcessed: number;
  /** 변경·신규로 재색인한 파일 수 */
  filesUpdated: number;
  /** 변경 없어 건너뛴 파일 수 */
  filesSkipped: number;
  chunksIndexed: number;
  chunksRemoved: number;
  errors: string[];
}

/** RAG 폴더에 등록된 문서 파일 정보 */
export interface RagFileInfo {
  relativePath: string;
  size: number;
  updatedAt: string;
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

export interface ScheduleCardItem {
  id: number;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  creatorName: string;
  attendeeNames: string[];
}

/** 채팅방 일정 조회 카드 (/calendar) 및 참석 변경 DM 알림 */
export interface ScheduleCard {
  kind: "schedule";
  /** 조회 대상 날짜 YYYY-MM-DD (로컬) */
  date: string;
  label: string;
  events: ScheduleCardItem[];
  /** DM 참석자 변경 알림: 추가/삭제 */
  notice?: "added" | "removed";
}

export type CardPayload = IssueCard | BuildCard | ScheduleCard;

// ---------------------------------------------------------------------------
// 캘린더 일정
// ---------------------------------------------------------------------------

export type CalendarVisibility = "private" | "company";
export type CalendarEventAction = "created" | "updated" | "deleted" | "reminder";

export interface CalendarAttendee {
  userId: number;
  displayName: string;
  username: string;
  responseStatus: "invited";
}

export interface CalendarEvent {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  visibility: CalendarVisibility;
  reminderMinutes: number;
  createdBy: number;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  attendees: CalendarAttendee[];
}

export interface CalendarEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  visibility?: CalendarVisibility;
  reminderMinutes?: number;
  attendeeIds?: number[];
}

export interface CalendarEventSocketPayload {
  action: CalendarEventAction;
  event: CalendarEvent;
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

/** Ollama 모델 목록 조회 응답 */
export interface OllamaModelsResponse {
  url: string;
  models: string[];
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
  "presence:update": (payload: {
    userId: number;
    isOnline: boolean;
    lastSeen: string | null;
    presenceStatus: UserPresenceStatus;
  }) => void;
  /** 프로필/상태 변경 또는 신규 사용자 추가 시 전체 사용자 정보 갱신 */
  "user:updated": (user: PublicUser) => void;
  /** 계정 삭제/비활성화 시 사이드바 목록에서 제거 */
  "user:removed": (payload: { userId: number }) => void;
  "room:created": (room: Room) => void;
  /** 숨긴 DM 등이 새 메시지로 다시 목록에 나타날 때 */
  "room:unhidden": (room: Room) => void;
  "ai:delta": (payload: AiDeltaEvent) => void;
  "calendar:event": (payload: CalendarEventSocketPayload) => void;
  /** DM /지진 — 상대방 창 흔들림 */
  "room:earthquake:shake": (payload: { roomId: number }) => void;
  /** @멘션 알림 */
  "mention:notify": (payload: { roomId: number; message: Message; fromUserId: number }) => void;
  "error": (payload: { message: string }) => void;
}

/** 클라이언트 -> 서버 이벤트 */
export interface ClientToServerEvents {
  "room:join": (roomId: number, ack?: (ok: boolean) => void) => void;
  "room:leave": (roomId: number) => void;
  "message:send": (
    payload: { roomId: number; content: string; mentionUserIds?: number[] },
    ack?: (result: { ok: boolean; message?: Message; error?: string }) => void
  ) => void;
  /** AI 질문 요청 (FR-28, FR-29): 서버가 질문을 저장/브로드캐스트 후 스트리밍 응답 */
  "ai:ask": (
    payload: { roomId: number; content: string; model?: string },
    ack?: (result: { ok: boolean; error?: string }) => void
  ) => void;
  /** DM /지진 — 상대방에게 창 흔들림 + 시스템 메시지 */
  "dm:earthquake": (
    payload: { roomId: number },
    ack?: (result: { ok: boolean; message?: Message; error?: string }) => void
  ) => void;
  /** 채널·그룹 /전체지진 — 발신자 제외 참여자 창 흔들림 + 시스템 메시지 */
  "room:mass-earthquake": (
    payload: { roomId: number },
    ack?: (result: { ok: boolean; message?: Message; error?: string }) => void
  ) => void;
  /** @멘션 대상 개별 /지진 */
  "room:targeted-earthquake": (
    payload: { roomId: number; targetUserIds: number[] },
    ack?: (result: { ok: boolean; message?: Message; error?: string }) => void
  ) => void;
}

/** Socket 핸드셰이크 인증 페이로드 */
export interface SocketAuthPayload {
  token: string;
}
