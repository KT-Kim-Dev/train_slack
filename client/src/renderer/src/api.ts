import type {
  LoginResponse,
  Message,
  MessagePage,
  PublicUser,
  Room,
} from "@intra-chat/shared";
import { SERVER_URL } from "./config";

const TOKEN_KEY = "intra-chat-token";
const USER_KEY = "intra-chat-user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): PublicUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as PublicUser) : null;
}

export function saveSession(res: LoginResponse): void {
  localStorage.setItem(TOKEN_KEY, res.token);
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
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

export async function markRoomRead(roomId: number, lastMessageId: number): Promise<void> {
  await request(`/api/rooms/${roomId}/read`, {
    method: "POST",
    body: JSON.stringify({ lastMessageId }),
  });
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
    for (const file of files) form.append("files", file);

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
