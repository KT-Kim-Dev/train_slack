import { Router } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { listUsers, toPublicUser } from "../db/users.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** 사내 사용자 목록 (채널 초대/DM 시작 대상 선택용) */
usersRouter.get("/", (req: AuthedRequest, res) => {
  const users = listUsers()
    .filter((u) => u.is_active === 1)
    .map(toPublicUser);
  res.json(users);
});
