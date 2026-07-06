import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import {
  addMember,
  createRoom,
  findDmRoom,
  getMemberIds,
  getRoomById,
  getUnreadCountForUser,
  hideRoom,
  isMember,
  listRoomsForUser,
  markRoomRead,
  removeMember,
  toRoom,
  unhideDmRecipients,
} from "../db/rooms.js";
import { AI_USERNAME } from "../db/index.js";
import { getUserById, toPublicUser } from "../db/users.js";
import { getMessagePage } from "../db/messages.js";
import { notifyRoomCreated, notifyRoomUnhidden } from "../sockets/index.js";
import { logger } from "../logger.js";

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

/** 참여 중인 방 목록 (채널/그룹/DM + 미읽음 수) */
roomsRouter.get("/", (req: AuthedRequest, res) => {
  res.json(listRoomsForUser(req.auth!.userId));
});

/** 방 히스토리 조회 (커서 페이지네이션, FR-13) */
roomsRouter.get("/:id/messages", (req: AuthedRequest, res) => {
  const roomId = Number(req.params.id);
  if (!isMember(roomId, req.auth!.userId)) {
    res.status(403).json({ error: "이 방에 접근할 수 없습니다." });
    return;
  }
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const page = getMessagePage({ roomId, cursor, limit });

  // 최신 메시지를 읽음 처리 (첫 페이지 로딩 시)
  if (!cursor && page.messages.length > 0) {
    const latestId = page.messages[page.messages.length - 1].id;
    markRoomRead(roomId, req.auth!.userId, latestId);
  }
  res.json(page);
});

/** 방 읽음 처리 */
roomsRouter.post("/:id/read", (req: AuthedRequest, res) => {
  const roomId = Number(req.params.id);
  const schema = z.object({ lastMessageId: z.number().int().nonnegative() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "lastMessageId 가 필요합니다." });
    return;
  }
  markRoomRead(roomId, req.auth!.userId, parsed.data.lastMessageId);
  res.json({ ok: true });
});

const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  memberIds: z.array(z.number().int()).default([]),
});

/** 공개 채널 생성 (FR-06) */
roomsRouter.post("/channel", (req: AuthedRequest, res) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "채널명을 입력하세요." });
    return;
  }
  const creator = req.auth!.userId;
  const room = createRoom({ name: parsed.data.name, type: "channel", createdBy: creator });
  const members = new Set<number>([creator, ...parsed.data.memberIds]);
  for (const uid of members) addMember(room.id, uid);

  const roomDto = toRoom(room, 0);
  notifyRoomCreated(roomDto, [...members]);
  logger.info("채널 생성", { roomId: room.id, name: room.name, by: creator });
  res.status(201).json(roomDto);
});

/** 비공개 그룹채팅 생성 (3인 이상, FR-07) */
roomsRouter.post("/group", (req: AuthedRequest, res) => {
  const schema = z.object({
    name: z.string().min(1).max(100),
    memberIds: z.array(z.number().int()).min(2), // 생성자 포함 3인 이상
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "그룹명과 2명 이상의 초대 인원이 필요합니다." });
    return;
  }
  const creator = req.auth!.userId;
  const room = createRoom({ name: parsed.data.name, type: "group", createdBy: creator });
  const members = new Set<number>([creator, ...parsed.data.memberIds]);
  for (const uid of members) addMember(room.id, uid);

  const roomDto = toRoom(room, 0);
  notifyRoomCreated(roomDto, [...members]);
  logger.info("그룹채팅 생성", { roomId: room.id, name: room.name, by: creator });
  res.status(201).json(roomDto);
});

/** 1:1 DM 시작 (기존 방 있으면 재사용, FR-08) */
roomsRouter.post("/dm", (req: AuthedRequest, res) => {
  const schema = z.object({ userId: z.number().int() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "상대 사용자 ID가 필요합니다." });
    return;
  }
  const me = req.auth!.userId;
  const other = parsed.data.userId;
  if (me === other) {
    res.status(400).json({ error: "자기 자신과는 DM 할 수 없습니다." });
    return;
  }
  const otherUser = getUserById(other);
  if (!otherUser) {
    res.status(404).json({ error: "상대 사용자를 찾을 수 없습니다." });
    return;
  }

  const existing = findDmRoom(me, other);
  if (existing) {
    // 숨김 처리되어 있었다면 다시 표시
    hideRoom(existing.id, me, false);
    res.json(toRoom(existing, 0));
    return;
  }

  const room = createRoom({ name: `dm:${me}:${other}`, type: "dm", createdBy: me });
  addMember(room.id, me);
  addMember(room.id, other);
  const roomDto = toRoom(room, 0);
  notifyRoomCreated(roomDto, [me, other]);
  logger.info("DM 생성", { roomId: room.id, me, other });
  res.status(201).json(roomDto);
});

/** 방 나가기 (채널/그룹) 또는 DM 숨김 (FR-10) */
roomsRouter.post("/:id/leave", (req: AuthedRequest, res) => {
  const roomId = Number(req.params.id);
  const room = getRoomById(roomId);
  if (!room || !isMember(roomId, req.auth!.userId)) {
    res.status(404).json({ error: "참여 중인 방이 아닙니다." });
    return;
  }
  if (room.type === "dm") {
    hideRoom(roomId, req.auth!.userId, true);
  } else {
    removeMember(roomId, req.auth!.userId);
  }
  res.json({ ok: true });
});

/** 그룹채팅에 멤버 추가 */
roomsRouter.post("/:id/members", (req: AuthedRequest, res) => {
  const roomId = Number(req.params.id);
  const room = getRoomById(roomId);
  if (!room || room.type !== "group") {
    res.status(400).json({ error: "그룹채팅에만 멤버를 추가할 수 있습니다." });
    return;
  }
  if (!isMember(roomId, req.auth!.userId)) {
    res.status(403).json({ error: "이 방의 참여자가 아닙니다." });
    return;
  }
  const schema = z.object({ memberIds: z.array(z.number().int()).min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "추가할 멤버 ID가 필요합니다." });
    return;
  }
  const added: number[] = [];
  for (const uid of parsed.data.memberIds) {
    if (uid === req.auth!.userId) continue;
    const user = getUserById(uid);
    if (!user || user.is_active !== 1 || user.username === AI_USERNAME) continue;
    if (!isMember(roomId, uid)) {
      addMember(roomId, uid);
      added.push(uid);
    }
  }
  if (added.length > 0) {
    const roomDto = toRoom(room, 0);
    notifyRoomCreated(roomDto, added);
    logger.info("그룹 멤버 추가", { roomId, added });
  }
  res.json({ ok: true, added });
});

/** 방 참여자 목록 */
roomsRouter.get("/:id/members", (req: AuthedRequest, res) => {
  const roomId = Number(req.params.id);
  if (!isMember(roomId, req.auth!.userId)) {
    res.status(403).json({ error: "이 방에 접근할 수 없습니다." });
    return;
  }
  const ids = getMemberIds(roomId);
  const users = ids
    .map((id) => getUserById(id))
    .filter((u): u is NonNullable<typeof u> => !!u && u.username !== AI_USERNAME)
    .map((u) => toPublicUser(u));
  res.json(users);
});
