import type {
  AdminSettings,
  AdminUserView,
  BuildStartResponse,
  BuildStatusResponse,
  CalendarEvent,
  CalendarEventInput,
  CreateIssueRequest,
  CreateIssueResponse,
  EmojiItem,
  IntegrationsInfo,
  IssueCard,
  LoginResponse,
  Message,
  MessagePage,
  OllamaModelsResponse,
  PublicUser,
  RagStats,
  RagSyncResult,
  Room,
  ScheduleCard,
  UserPreferences,
  UserPresenceStatus,
} from "@intra-chat/shared";
import { SERVER_URL } from "./config";

const TOKEN_KEY = "intra-chat-token";
const USER_KEY = "intra-chat-user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): PublicUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<PublicUser>;
  if (parsed.id == null || !parsed.username || !parsed.displayName) return null;
  return {
    id: parsed.id,
    username: parsed.username,
    displayName: parsed.displayName,
    isOnline: parsed.isOnline ?? false,
    lastSeen: parsed.lastSeen ?? null,
    isAdmin: parsed.isAdmin ?? false,
    profileImageUrl: parsed.profileImageUrl ?? null,
    presenceStatus: parsed.presenceStatus ?? "available",
  };
}

export function saveSession(res: LoginResponse): void {
  localStorage.setItem(TOKEN_KEY, res.token);
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function updateStoredUser(user: PublicUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${SERVER_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* JSON 파싱 실패 시 기본 메시지 사용 */
    }
    throw new ApiError(message);
  }
  return (await res.json()) as T;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchRooms(): Promise<Room[]> {
  return request<Room[]>("/api/rooms");
}

export async function fetchMessages(roomId: number, cursor?: number | null): Promise<MessagePage> {
  const query = cursor ? `?cursor=${cursor}` : "";
  return request<MessagePage>(`/api/rooms/${roomId}/messages${query}`);
}

export async function fetchUsers(): Promise<PublicUser[]> {
  return request<PublicUser[]>("/api/users");
}

export async function updateMyStatus(status: UserPresenceStatus): Promise<PublicUser> {
  return request<PublicUser>("/api/users/me/status", {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export async function fetchMyPreferences(): Promise<UserPreferences> {
  return request<UserPreferences>("/api/users/me/preferences");
}

export async function updateMyPreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
  return request<UserPreferences>("/api/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(prefs),
  });
}

/** 프로필 이미지 URL (쿼리 토큰 + 캐시 무효화) */
export function avatarUrl(
  userId: number,
  profileImageUrl?: string | null,
  cacheBust?: string | number
): string {
  const token = getToken();
  const base = profileImageUrl?.startsWith("/")
    ? `${SERVER_URL}${profileImageUrl}`
    : `${SERVER_URL}/api/users/${userId}/avatar`;
  const joiner = base.includes("?") ? "&" : "?";
  let url = `${base}${joiner}token=${encodeURIComponent(token ?? "")}`;
  if (cacheBust != null) {
    url += `&_=${encodeURIComponent(String(cacheBust))}`;
  }
  return url;
}

export function uploadAvatar(file: File): Promise<PublicUser> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("avatar", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVER_URL}/api/users/me/avatar`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as PublicUser);
      } else {
        let message = `업로드 실패 (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.error) message = body.error;
        } catch {
          /* 무시 */
        }
        reject(new ApiError(message));
      }
    });
    xhr.addEventListener("error", () => reject(new ApiError("네트워크 오류로 업로드에 실패했습니다.")));
    xhr.send(form);
  });
}

export async function createChannel(name: string, memberIds: number[]): Promise<Room> {
  return request<Room>("/api/rooms/channel", {
    method: "POST",
    body: JSON.stringify({ name, memberIds }),
  });
}

export async function createGroup(name: string, memberIds: number[]): Promise<Room> {
  return request<Room>("/api/rooms/group", {
    method: "POST",
    body: JSON.stringify({ name, memberIds }),
  });
}

export async function createDm(userId: number): Promise<Room> {
  return request<Room>("/api/rooms/dm", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function leaveRoom(roomId: number): Promise<void> {
  await request(`/api/rooms/${roomId}/leave`, { method: "POST" });
}

export async function fetchRoomMembers(roomId: number): Promise<PublicUser[]> {
  return request<PublicUser[]>(`/api/rooms/${roomId}/members`);
}

export async function addRoomMembers(roomId: number, memberIds: number[]): Promise<void> {
  await request(`/api/rooms/${roomId}/members`, {
    method: "POST",
    body: JSON.stringify({ memberIds }),
  });
}

export async function fetchAdminUsers(): Promise<AdminUserView[]> {
  return request<AdminUserView[]>("/api/admin/users");
}

export async function createAdminUser(params: {
  username: string;
  password: string;
  displayName: string;
}): Promise<AdminUserView> {
  return request<AdminUserView>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function deactivateAdminUser(userId: number): Promise<void> {
  await request(`/api/admin/users/${userId}/deactivate`, { method: "POST" });
}

export async function activateAdminUser(userId: number): Promise<void> {
  await request(`/api/admin/users/${userId}/activate`, { method: "POST" });
}

export async function deleteAdminUser(userId: number): Promise<void> {
  await request(`/api/admin/users/${userId}`, { method: "DELETE" });
}

export async function markRoomRead(roomId: number, lastMessageId: number): Promise<void> {
  await request(`/api/rooms/${roomId}/read`, {
    method: "POST",
    body: JSON.stringify({ lastMessageId }),
  });
}

// ---------------------------------------------------------------------------
// v3: 업무 연동 API (AI / Yona / Jenkins)
// ---------------------------------------------------------------------------

export async function fetchIntegrations(): Promise<IntegrationsInfo> {
  return request<IntegrationsInfo>("/api/integrations");
}

export async function fetchAdminSettings(): Promise<AdminSettings> {
  return request<AdminSettings>("/api/admin/settings");
}

export async function saveAdminSettings(settings: Partial<AdminSettings>): Promise<void> {
  await request<{ ok: boolean }>("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** Ollama URL에서 사용 가능한 모델 목록 조회 */
export async function fetchOllamaModels(url?: string): Promise<OllamaModelsResponse> {
  const query = url?.trim() ? `?url=${encodeURIComponent(url.trim())}` : "";
  return request<OllamaModelsResponse>(`/api/admin/settings/ollama-models${query}`);
}

export async function fetchRagStats(): Promise<RagStats> {
  return request<RagStats>("/api/admin/rag/stats");
}

export async function syncRagFolder(): Promise<RagSyncResult> {
  return request<RagSyncResult>("/api/admin/rag/sync-folder", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Yona 이슈 조회 — 결과 카드는 서버가 방에 브로드캐스트 (FR-35) */
export async function fetchIssue(issueId: string, roomId: number): Promise<IssueCard> {
  return request<IssueCard>(`/api/yona/issues/${encodeURIComponent(issueId)}?roomId=${roomId}`);
}

/** Yona 이슈 생성 (FR-36) */
export async function createIssue(payload: CreateIssueRequest): Promise<CreateIssueResponse> {
  return request<CreateIssueResponse>("/api/yona/issues", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Jenkins 빌드 실행 (FR-40) — 확인 절차는 UI에서 선행 */
export async function startBuild(project: string, roomId: number): Promise<BuildStartResponse> {
  return request<BuildStartResponse>("/api/jenkins/build/start", {
    method: "POST",
    body: JSON.stringify({ project, roomId }),
  });
}

/** Jenkins 빌드 상태 조회 (FR-43) */
export async function fetchBuildStatus(
  project: string,
  roomId: number
): Promise<BuildStatusResponse> {
  return request<BuildStatusResponse>(
    `/api/jenkins/build/${encodeURIComponent(project)}/status?roomId=${roomId}`
  );
}

// ---------------------------------------------------------------------------
// 캘린더
// ---------------------------------------------------------------------------

export async function fetchCalendarEvents(params: {
  from: string;
  to: string;
  scope?: "mine" | "all";
}): Promise<CalendarEvent[]> {
  const scope = params.scope ?? "mine";
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    scope,
  });
  return request<CalendarEvent[]>(`/api/calendar/events?${q.toString()}`);
}

export async function fetchCalendarEvent(id: number): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/api/calendar/events/${id}`);
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  return request<CalendarEvent>("/api/calendar/events", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCalendarEvent(
  id: number,
  input: CalendarEventInput
): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/api/calendar/events/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteCalendarEvent(id: number): Promise<void> {
  await request(`/api/calendar/events/${id}`, { method: "DELETE" });
}

/** 특정일 일정을 조회하고 채팅방에 카드로 게시 */
export async function fetchScheduleForRoom(params: {
  roomId: number;
  date: string;
  from: string;
  to: string;
  scope?: "mine" | "all";
}): Promise<ScheduleCard> {
  const q = new URLSearchParams({
    roomId: String(params.roomId),
    date: params.date,
    from: params.from,
    to: params.to,
    scope: params.scope ?? "all",
  });
  return request<ScheduleCard>(`/api/calendar/schedule?${q.toString()}`);
}

/** 오늘~+30일 일정을 조회하고 채팅방에 카드로 게시 */
export async function fetchMonthScheduleForRoom(params: {
  roomId: number;
  scope?: "mine" | "all";
}): Promise<ScheduleCard> {
  const q = new URLSearchParams({
    roomId: String(params.roomId),
    scope: params.scope ?? "all",
  });
  return request<ScheduleCard>(`/api/calendar/schedule/month30?${q.toString()}`);
}

/** /rag 명령 — RAG 폴더 파일 목록을 채팅방에 게시 */
export async function fetchRagFileList(roomId: number): Promise<Message> {
  const q = new URLSearchParams({ roomId: String(roomId) });
  const res = await request<{ message: Message; files: unknown[] }>(
    `/api/integrations/rag/files?${q.toString()}`
  );
  return res.message;
}

/** 파일 다운로드/미리보기용 URL (쿼리 토큰 포함) */
export function fileUrl(relativeUrl: string): string {
  const token = getToken();
  return `${SERVER_URL}${relativeUrl}?token=${encodeURIComponent(token ?? "")}`;
}

/**
 * 파일 업로드 (진행률 콜백 지원, FR-16~FR-18).
 * fetch 는 업로드 진행률을 제공하지 않으므로 XMLHttpRequest 를 사용한다.
 */
export function uploadFiles(
  roomId: number,
  files: File[],
  onProgress: (percent: number) => void
): Promise<{ messages: Message[] }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVER_URL}/api/rooms/${roomId}/files`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let message = `업로드 실패 (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.error) message = body.error;
        } catch {
          /* 무시 */
        }
        reject(new ApiError(message));
      }
    });
    xhr.addEventListener("error", () => reject(new ApiError("네트워크 오류로 업로드에 실패했습니다.")));
    xhr.send(form);
  });
}

export async function fetchEmojis(): Promise<EmojiItem[]> {
  return request<EmojiItem[]>("/api/emojis");
}

export function emojiAssetUrl(relativeUrl: string): string {
  return fileUrl(relativeUrl);
}

export async function uploadEmoji(file: File): Promise<EmojiItem> {
  const form = new FormData();
  form.append("emoji", file, file.name);
  const token = getToken();
  const res = await fetch(`${SERVER_URL}/api/emojis`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let message = `업로드 실패 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message);
  }
  return res.json() as Promise<EmojiItem>;
}

export async function sendEmojiMessage(roomId: number, emojiId: string): Promise<Message> {
  return request<Message>(`/api/emojis/rooms/${roomId}/send`, {
    method: "POST",
    body: JSON.stringify({ emojiId }),
  });
}
