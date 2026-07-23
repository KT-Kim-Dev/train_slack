import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type {
  CalendarEvent,
  CalendarEventAction,
  ClientToServerEvents,
  Message,
  PublicUser,
  Room,
  ServerToClientEvents,
} from "@intra-chat/shared";
import { verifyToken } from "../auth/jwt.js";
import { getUserById, setOnline, toPublicUser, userIgnoresEarthquake } from "../db/users.js";
import {
  getContextMessages,
  insertAiPlaceholder,
  insertEarthquakeIgnoredSystemMessage,
  insertEarthquakeSystemMessage,
  insertMassEarthquakeSystemMessage,
  insertTargetedEarthquakeSystemMessage,
  getMessageInRoom,
  insertTextMessage,
  setMessageContent,
} from "../db/messages.js";
import { getRoomById, getRoomIdsForUser, getUnreadCountForUser, getDmPeerId, getActiveMemberIds, isMember, markRoomRead, toRoom, unhideDmRecipients } from "../db/rooms.js";
import { getSettings } from "../db/settings.js";
import { logCommand } from "../db/integrations.js";
import { appendRagContext, buildAiSystemPrompt } from "../services/ai-prompt.js";
import { chatStream, IntegrationError } from "../services/ollama.js";
import { indexQaPair, retrieveRagContext } from "../services/rag.js";
import { scheduleRoomConversationExport } from "../services/rag-export.js";
import { logger } from "../logger.js";

interface SocketData {
  userId: number;
  username: string;
}

type IOServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let io: IOServer | null = null;

/** /지진·/전체지진 스팸 방지 (kind:roomId:senderId → timestamp) */
const earthquakeCooldown = new Map<string, number>();
const EARTHQUAKE_COOLDOWN_MS = 3000;

function emitEarthquakeShake(userIds: number[], roomId: number): void {
  const server = getIo();
  for (const targetId of userIds) {
    server.to(userChannel(targetId)).emit("room:earthquake:shake", { roomId });
  }
}

/** 지진 대상별 처리 — 무시 설정 시 시스템 메시지, 아니면 창 흔들림 */
function deliverEarthquakeEffects(roomId: number, targetUserIds: number[]): void {
  for (const targetId of [...new Set(targetUserIds)]) {
    if (userIgnoresEarthquake(targetId)) {
      const message = insertEarthquakeIgnoredSystemMessage({ roomId, userId: targetId });
      broadcastMessage(message);
      scheduleRoomConversationExport(roomId);
    } else {
      emitEarthquakeShake([targetId], roomId);
    }
  }
}

function checkEarthquakeCooldown(kind: string, roomId: number, userId: number): string | null {
  const cooldownKey = `${kind}:${roomId}:${userId}`;
  const lastAt = earthquakeCooldown.get(cooldownKey) ?? 0;
  const now = Date.now();
  if (now - lastAt < EARTHQUAKE_COOLDOWN_MS) {
    return "잠시 후 다시 시도해 주세요.";
  }
  earthquakeCooldown.set(cooldownKey, now);
  return null;
}

/** 사용자별 활성 소켓 수 추적 (온라인/오프라인 판정용) */
const onlineSockets = new Map<number, Set<string>>();

function roomChannel(roomId: number): string {
  return `room:${roomId}`;
}

function userChannel(userId: number): string {
  return `user:${userId}`;
}

/** 캘린더 일정 변경/리마인더를 대상 사용자에게 전달 */
export function notifyCalendarEvent(
  action: CalendarEventAction,
  event: CalendarEvent,
  userIds: number[]
): void {
  const server = getIo();
  const payload = { action, event };
  for (const userId of [...new Set(userIds)]) {
    server.to(userChannel(userId)).emit("calendar:event", payload);
  }
}

export function getIo(): IOServer {
  if (!io) throw new Error("Socket.IO 가 아직 초기화되지 않았습니다.");
  return io;
}

/** 특정 방의 모든 참여자에게 새 메시지를 브로드캐스트 (FR-11) */
export function broadcastMessage(message: Message): void {
  const room = getRoomById(message.roomId);
  if (room?.type === "dm") {
    const unhiddenIds = unhideDmRecipients(message.roomId, message.senderId);
    if (unhiddenIds.length > 0) {
      notifyRoomUnhidden(room, unhiddenIds);
    }
  }
  getIo().to(roomChannel(message.roomId)).emit("message:new", message);
}

/** 프로필/상태 변경 또는 신규 사용자 추가 시 멤버 목록 갱신 */
export function broadcastUserUpdated(user: PublicUser): void {
  getIo().emit("user:updated", user);
}

/** 계정 삭제/비활성화 시 멤버 목록에서 제거 */
export function broadcastUserRemoved(userId: number): void {
  getIo().emit("user:removed", { userId });
}

function emitPresenceUpdate(userId: number): void {
  const user = getUserById(userId);
  if (!user) return;
  const publicUser = toPublicUser(user);
  getIo().emit("presence:update", {
    userId,
    isOnline: publicUser.isOnline,
    lastSeen: publicUser.lastSeen,
    presenceStatus: publicUser.presenceStatus,
  });
}

/** 방 생성/초대 시 대상 사용자들에게 알림 (사이드바 갱신용) */
export function notifyRoomCreated(room: Room, memberIds: number[]): void {
  const server = getIo();
  for (const [socketId, sock] of server.sockets.sockets) {
    if (memberIds.includes(sock.data.userId)) {
      sock.join(roomChannel(room.id));
      server.to(socketId).emit("room:created", room);
    }
  }
}

/** 숨긴 DM 이 새 메시지로 다시 나타날 때 대상 사용자에게 알림 */
export function notifyRoomUnhidden(roomRow: ReturnType<typeof getRoomById>, userIds: number[]): void {
  if (!roomRow) return;
  const server = getIo();
  for (const [socketId, sock] of server.sockets.sockets) {
    if (userIds.includes(sock.data.userId)) {
      const unread = getUnreadCountForUser(roomRow.id, sock.data.userId);
      const room = toRoom(roomRow, unread);
      sock.join(roomChannel(room.id));
      server.to(socketId).emit("room:unhidden", room);
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

    socket.on("message:send", ({ roomId, content, mentionUserIds, replyToMessageId }, ack) => {
      const trimmed = (content ?? "").trim();
      if (!trimmed) {
        ack?.({ ok: false, error: "빈 메시지는 보낼 수 없습니다." });
        return;
      }
      if (!isMember(roomId, userId)) {
        ack?.({ ok: false, error: "이 방의 참여자가 아닙니다." });
        return;
      }

      let parentMessageId: number | null = null;
      if (replyToMessageId != null) {
        const parent = getMessageInRoom(replyToMessageId, roomId);
        if (!parent) {
          ack?.({ ok: false, error: "답글 대상 메시지를 찾을 수 없습니다." });
          return;
        }
        if (parent.messageType === "system") {
          ack?.({ ok: false, error: "시스템 메시지에는 답글할 수 없습니다." });
          return;
        }
        parentMessageId = parent.id;
      }

      const message = insertTextMessage({
        roomId,
        senderId: userId,
        content: trimmed,
        parentMessageId,
      });
      markRoomRead(roomId, userId, message.id);
      broadcastMessage(message);
      scheduleRoomConversationExport(roomId);

      const memberSet = new Set(getActiveMemberIds(roomId));
      for (const targetId of mentionUserIds ?? []) {
        if (targetId === userId || !memberSet.has(targetId)) continue;
        getIo().to(userChannel(targetId)).emit("mention:notify", {
          roomId,
          message,
          fromUserId: userId,
        });
      }

      logger.info("메시지 전송", { roomId, userId, messageId: message.id });
      ack?.({ ok: true, message });
    });

    socket.on("ai:ask", ({ roomId, content, model }, ack) => {
      const trimmed = (content ?? "").trim();
      if (!trimmed) {
        ack?.({ ok: false, error: "질문 내용이 비어 있습니다." });
        return;
      }
      if (!isMember(roomId, userId)) {
        ack?.({ ok: false, error: "이 방의 참여자가 아닙니다." });
        return;
      }
      ack?.({ ok: true });
      void handleAiAsk(roomId, userId, trimmed, model);
    });

    socket.on("dm:earthquake", ({ roomId }, ack) => {
      const room = getRoomById(roomId);
      if (!room || room.type !== "dm") {
        ack?.({ ok: false, error: "다이렉트 메시지에서만 사용할 수 있습니다." });
        return;
      }
      if (!isMember(roomId, userId)) {
        ack?.({ ok: false, error: "이 방의 참여자가 아닙니다." });
        return;
      }

      const cooldownError = checkEarthquakeCooldown("dm", roomId, userId);
      if (cooldownError) {
        ack?.({ ok: false, error: cooldownError });
        return;
      }

      const message = insertEarthquakeSystemMessage({ roomId, userId });
      markRoomRead(roomId, userId, message.id);
      broadcastMessage(message);
      scheduleRoomConversationExport(roomId);

      const peerId = getDmPeerId(roomId, userId);
      if (peerId) {
        deliverEarthquakeEffects(roomId, [peerId]);
      }

      logger.info("DM 지진", { roomId, userId, messageId: message.id });
      ack?.({ ok: true, message });
    });

    socket.on("room:mass-earthquake", ({ roomId }, ack) => {
      const room = getRoomById(roomId);
      if (!room || (room.type !== "channel" && room.type !== "group")) {
        ack?.({ ok: false, error: "채널 또는 그룹채팅에서만 사용할 수 있습니다." });
        return;
      }
      if (!isMember(roomId, userId)) {
        ack?.({ ok: false, error: "이 방의 참여자가 아닙니다." });
        return;
      }

      const cooldownError = checkEarthquakeCooldown("mass", roomId, userId);
      if (cooldownError) {
        ack?.({ ok: false, error: cooldownError });
        return;
      }

      const message = insertMassEarthquakeSystemMessage({ roomId, userId });
      markRoomRead(roomId, userId, message.id);
      broadcastMessage(message);
      scheduleRoomConversationExport(roomId);

      const targets = getActiveMemberIds(roomId, userId);
      deliverEarthquakeEffects(roomId, targets);

      logger.info("전체지진", { roomId, roomType: room.type, userId, targetCount: targets.length, messageId: message.id });
      ack?.({ ok: true, message });
    });

    socket.on("room:targeted-earthquake", ({ roomId, targetUserIds }, ack) => {
      const room = getRoomById(roomId);
      if (!room || room.type === "ai") {
        ack?.({ ok: false, error: "이 방에서는 사용할 수 없습니다." });
        return;
      }
      if (!isMember(roomId, userId)) {
        ack?.({ ok: false, error: "이 방의 참여자가 아닙니다." });
        return;
      }

      const uniqueTargets = [...new Set(targetUserIds ?? [])].filter((id) => id !== userId);
      if (uniqueTargets.length === 0) {
        ack?.({ ok: false, error: "지진 대상 사용자를 @멘션으로 지정해 주세요." });
        return;
      }

      const memberSet = new Set(getActiveMemberIds(roomId));
      const validTargets = uniqueTargets.filter((id) => memberSet.has(id));
      if (validTargets.length === 0) {
        ack?.({ ok: false, error: "멘션한 사용자가 이 방의 참여자가 아닙니다." });
        return;
      }

      const cooldownError = checkEarthquakeCooldown("target", roomId, userId);
      if (cooldownError) {
        ack?.({ ok: false, error: cooldownError });
        return;
      }

      const message = insertTargetedEarthquakeSystemMessage({
        roomId,
        userId,
        targetUserIds: validTargets,
      });
      markRoomRead(roomId, userId, message.id);
      broadcastMessage(message);
      scheduleRoomConversationExport(roomId);
      deliverEarthquakeEffects(roomId, validTargets);

      logger.info("개별 지진", { roomId, userId, targetCount: validTargets.length, messageId: message.id });
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

  // 사용자 개인 채널 (캘린더 알림 등)
  socket.join(userChannel(userId));

  // 참여 중인 모든 방 채널에 합류시켜 어느 방에서든 실시간 수신 가능하게 함
  const rooms = getRoomIdsForUser(userId);
  for (const roomId of rooms) socket.join(roomChannel(roomId));

  if (wasOffline) {
    setOnline(userId, true);
    emitPresenceUpdate(userId);
    logger.info("온라인 전환", { userId, username });
  }
}

function handleDisconnect(socket: AppSocket, userId: number, username: string): void {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.delete(socket.id);
  if (set.size === 0) {
    onlineSockets.delete(userId);
    setOnline(userId, false);
    emitPresenceUpdate(userId);
    logger.info("오프라인 전환", { userId, username });
  }
}

/**
 * AI 질문 처리 (FR-28~34).
 * 1) 사용자의 질문을 텍스트 메시지로 저장/브로드캐스트
 * 2) AI 응답 자리표시자 생성 후 브로드캐스트
 * 3) Ollama 스트리밍으로 delta 를 방에 순차 전송, 완료 시 내용 확정/저장
 */
async function handleAiAsk(
  roomId: number,
  userId: number,
  content: string,
  model?: string
): Promise<void> {
  const server = getIo();

  // 1) 질문 메시지 저장/브로드캐스트
  const question = insertTextMessage({ roomId, senderId: userId, content });
  markRoomRead(roomId, userId, question.id);
  broadcastMessage(question);
  scheduleRoomConversationExport(roomId);

  // 2) AI 응답 자리표시자 — 발신자를 질문한 사용자로 표시 (message_type으로 AI 여부 구분)
  const placeholder = insertAiPlaceholder({ roomId, senderId: userId });
  broadcastMessage(placeholder);

  // 3) 컨텍스트 구성 (FR-31) + RAG 참고 지식
  const aiSettings = getSettings();
  const history = getContextMessages(roomId, aiSettings.ai_context_limit);
  let systemPrompt = buildAiSystemPrompt(aiSettings);
  if (aiSettings.rag_enabled) {
    const ragContext = await retrieveRagContext(content);
    systemPrompt = appendRagContext(systemPrompt, ragContext);
  }
  const messages = [{ role: "system" as const, content: systemPrompt }, ...history];

  const startedAt = Date.now();
  let accumulated = "";
  try {
    accumulated = await chatStream({
      messages,
      model,
      onDelta: (delta) => {
        server.to(roomChannel(roomId)).emit("ai:delta", {
          roomId,
          messageId: placeholder.id,
          delta,
          done: false,
        });
      },
    });
    setMessageContent(placeholder.id, accumulated);
    const elapsedMs = Date.now() - startedAt;
    server.to(roomChannel(roomId)).emit("ai:delta", {
      roomId,
      messageId: placeholder.id,
      delta: "",
      done: true,
      elapsedMs,
    });
    logCommand({ userId, command: "/ai", parameter: content.slice(0, 200), success: true, elapsedMs });
    if (aiSettings.rag_enabled && aiSettings.rag_auto_learn) {
      void indexQaPair(content, accumulated);
    }
    scheduleRoomConversationExport(roomId);
  } catch (err) {
    const errorMsg =
      err instanceof IntegrationError ? err.message : "AI 응답 처리 중 오류가 발생했습니다.";
    setMessageContent(placeholder.id, `⚠️ ${errorMsg}`);
    server.to(roomChannel(roomId)).emit("ai:delta", {
      roomId,
      messageId: placeholder.id,
      delta: `⚠️ ${errorMsg}`,
      done: true,
      error: errorMsg,
    });
    logCommand({
      userId,
      command: "/ai",
      parameter: content.slice(0, 200),
      success: false,
      elapsedMs: Date.now() - startedAt,
    });
    logger.warn("AI 응답 실패", { roomId, userId, error: errorMsg });
    scheduleRoomConversationExport(roomId);
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
