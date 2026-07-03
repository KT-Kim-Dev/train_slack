import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  Message,
  Room,
  ServerToClientEvents,
} from "@intra-chat/shared";
import { verifyToken } from "../auth/jwt.js";
import { getUserById, setOnline } from "../db/users.js";
import { insertTextMessage } from "../db/messages.js";
import { getRoomIdsForUser, isMember, markRoomRead } from "../db/rooms.js";
import { logger } from "../logger.js";

interface SocketData {
  userId: number;
  username: string;
}

type IOServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let io: IOServer | null = null;

/** 사용자별 활성 소켓 수 추적 (온라인/오프라인 판정용) */
const onlineSockets = new Map<number, Set<string>>();

function roomChannel(roomId: number): string {
  return `room:${roomId}`;
}

export function getIo(): IOServer {
  if (!io) throw new Error("Socket.IO 가 아직 초기화되지 않았습니다.");
  return io;
}

/** 특정 방의 모든 참여자에게 새 메시지를 브로드캐스트 (FR-11) */
export function broadcastMessage(message: Message): void {
  getIo().to(roomChannel(message.roomId)).emit("message:new", message);
}

/** 방 생성/초대 시 대상 사용자들에게 알림 (사이드바 갱신용) */
export function notifyRoomCreated(room: Room, memberIds: number[]): void {
  const server = getIo();
  for (const [socketId, sock] of server.sockets.sockets) {
    if (memberIds.includes(sock.data.userId)) {
      // 즉시 해당 소켓을 방 채널에 합류시켜 실시간 수신이 가능하도록 함
      sock.join(roomChannel(room.id));
      server.to(socketId).emit("room:created", room);
    }
  }
}

export function initSocket(httpServer: HttpServer, corsOrigin: string[]): IOServer {
  io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    {
      cors: { origin: corsOrigin, credentials: true },
      maxHttpBufferSize: 1e6,
    }
  );

  // 핸드셰이크 단계에서 JWT 인증
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("인증 토큰이 필요합니다."));
      const payload = verifyToken(token);
      const user = getUserById(payload.userId);
      if (!user || user.is_active !== 1) {
        return next(new Error("비활성화되었거나 존재하지 않는 계정입니다."));
      }
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      next();
    } catch {
      next(new Error("유효하지 않은 토큰입니다."));
    }
  });

  io.on("connection", (socket: AppSocket) => {
    const { userId, username } = socket.data;
    handleConnect(socket, userId, username);

    socket.on("room:join", (roomId, ack) => {
      if (!isMember(roomId, userId)) {
        ack?.(false);
        return;
      }
      socket.join(roomChannel(roomId));
      ack?.(true);
    });

    socket.on("room:leave", (roomId) => {
      socket.leave(roomChannel(roomId));
    });

    socket.on("message:send", ({ roomId, content }, ack) => {
      const trimmed = (content ?? "").trim();
      if (!trimmed) {
        ack?.({ ok: false, error: "빈 메시지는 보낼 수 없습니다." });
        return;
      }
      if (!isMember(roomId, userId)) {
        ack?.({ ok: false, error: "이 방의 참여자가 아닙니다." });
        return;
      }
      const message = insertTextMessage({ roomId, senderId: userId, content: trimmed });
      markRoomRead(roomId, userId, message.id);
      broadcastMessage(message);
      logger.info("메시지 전송", { roomId, userId, messageId: message.id });
      ack?.({ ok: true, message });
    });

    socket.on("disconnect", () => handleDisconnect(socket, userId, username));
  });

  logger.info("Socket.IO 초기화 완료");
  return io;
}

function handleConnect(socket: AppSocket, userId: number, username: string): void {
  const set = onlineSockets.get(userId) ?? new Set<string>();
  const wasOffline = set.size === 0;
  set.add(socket.id);
  onlineSockets.set(userId, set);

  // 참여 중인 모든 방 채널에 합류시켜 어느 방에서든 실시간 수신 가능하게 함
  const rooms = getRoomIdsForUser(userId);
  for (const roomId of rooms) socket.join(roomChannel(roomId));

  if (wasOffline) {
    setOnline(userId, true);
    getIo().emit("presence:update", { userId, isOnline: true, lastSeen: null });
    logger.info("온라인 전환", { userId, username });
  }
}

function handleDisconnect(socket: AppSocket, userId: number, username: string): void {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.delete(socket.id);
  if (set.size === 0) {
    onlineSockets.delete(userId);
    const lastSeen = setOnline(userId, false);
    getIo().emit("presence:update", { userId, isOnline: false, lastSeen });
    logger.info("오프라인 전환", { userId, username });
  }
}

/** 특정 사용자의 세션을 강제로 종료한다 (계정 비활성화/삭제 시, FR-04) */
export function disconnectUser(userId: number): void {
  const set = onlineSockets.get(userId);
  if (!set) return;
  const server = getIo();
  for (const socketId of set) {
    server.sockets.sockets.get(socketId)?.disconnect(true);
  }
}
