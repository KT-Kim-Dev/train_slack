import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { LoginResponse } from "@intra-chat/shared";
import { getUserByUsername, toPublicUser } from "../db/users.js";
import { addMember } from "../db/rooms.js";
import { getDefaultChannelId } from "../db/index.js";
import { ensureAiRoom } from "../db/integrations.js";
import { config } from "../config.js";
import { signToken } from "../auth/jwt.js";
import { logger } from "../logger.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
    return;
  }

  const { username, password } = parsed.data;
  const user = getUserByUsername(username);
  if (!user || user.is_active !== 1) {
    // 계정 존재 여부를 노출하지 않도록 동일한 메시지 사용
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return;
  }

  // 로그인 사용자를 기본 공개 채널에 자동 합류시키고, AI 전용 채팅방을 보장한다 (FR-27).
  addMember(getDefaultChannelId(), user.id);
  ensureAiRoom(user.id, config.ai.defaultModel);

  const token = signToken({ userId: user.id, username: user.username });
  logger.info("로그인 성공", { userId: user.id, username: user.username });

  const response: LoginResponse = { token, user: toPublicUser(user) };
  res.json(response);
});
