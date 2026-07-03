import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { config } from "../config.js";
import {
  createUser,
  deleteUser,
  getUserById,
  getUserByUsername,
  listUsers,
  setActive,
  toPublicUser,
} from "../db/users.js";
import { disconnectUser } from "../sockets/index.js";
import { logger } from "../logger.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

/** 관리자 권한 확인: config.adminUsernames 에 포함된 사용자만 허용 */
adminRouter.use((req: AuthedRequest, res, next) => {
  if (!config.adminUsernames.includes(req.auth!.username)) {
    res.status(403).json({ error: "관리자 권한이 필요합니다." });
    return;
  }
  next();
});

/** 전체 사용자 목록 (활성/비활성 포함) */
adminRouter.get("/users", (_req, res) => {
  res.json(listUsers().map(toPublicUser));
});

/** 계정 생성 (FR-01, CLI 대안) */
adminRouter.post("/users", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(50),
    password: z.string().min(4),
    displayName: z.string().min(1).max(50),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "username/password/displayName 을 확인하세요." });
    return;
  }
  if (getUserByUsername(parsed.data.username)) {
    res.status(409).json({ error: "이미 존재하는 아이디입니다." });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = createUser({
    username: parsed.data.username,
    passwordHash,
    displayName: parsed.data.displayName,
  });
  logger.info("관리자 계정 생성", { userId: user.id, username: user.username });
  res.status(201).json(toPublicUser(user));
});

/** 계정 비활성화 (FR-04) - 세션 즉시 종료 */
adminRouter.post("/users/:id/deactivate", (req, res) => {
  const id = Number(req.params.id);
  if (!getUserById(id)) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    return;
  }
  setActive(id, false);
  disconnectUser(id);
  logger.info("계정 비활성화", { userId: id });
  res.json({ ok: true });
});

/** 계정 활성화 */
adminRouter.post("/users/:id/activate", (req, res) => {
  const id = Number(req.params.id);
  if (!getUserById(id)) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    return;
  }
  setActive(id, true);
  res.json({ ok: true });
});

/** 계정 삭제 (FR-04) - 세션 즉시 종료 */
adminRouter.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getUserById(id)) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    return;
  }
  disconnectUser(id);
  deleteUser(id);
  logger.info("계정 삭제", { userId: id });
  res.json({ ok: true });
});
