import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  Message,
  ServerToClientEvents,
} from "@intra-chat/shared";
import { SERVER_URL } from "./config";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/** 토큰으로 인증된 Socket 연결을 생성한다 (자동 재연결 활성화, 비기능 요구사항: 가용성) */
export function connectSocket(token: string): AppSocket {
  if (socket) socket.disconnect();
  socket = io(SERVER_URL, {
    auth: { token },
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** 메시지 전송 (ack 기반 Promise 래핑) */
export function sendMessage(roomId: number, content: string): Promise<Message> {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error("소켓이 연결되지 않았습니다."));
    socket.emit("message:send", { roomId, content }, (result) => {
      if (result.ok && result.message) resolve(result.message);
      else reject(new Error(result.error ?? "메시지 전송에 실패했습니다."));
    });
  });
}

export function joinRoom(roomId: number): void {
  socket?.emit("room:join", roomId);
}

/** AI에게 질문 (FR-28, FR-29). 응답은 ai:delta 이벤트로 스트리밍된다. */
export function askAi(roomId: number, content: string, model?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error("소켓이 연결되지 않았습니다."));
    socket.emit("ai:ask", { roomId, content, model }, (result) => {
      if (result.ok) resolve();
      else reject(new Error(result.error ?? "AI 요청에 실패했습니다."));
    });
  });
}
