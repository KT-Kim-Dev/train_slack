import path from "node:path";
import fs from "node:fs";
import { Router } from "express";
import multer from "multer";
import type { NextFunction, Response } from "express";
import { z } from "zod";
import type { UserPresenceStatus } from "@intra-chat/shared";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { verifyToken } from "../auth/jwt.js";
import { config } from "../config.js";
import {
  getUserById,
  listActiveUsers,
  setPresenceStatus,
  setProfileImagePath,
  toPublicUser,
} from "../db/users.js";
import { broadcastUserUpdated } from "../sockets/index.js";
import { decodeUploadFileName } from "../utils/filename.js";

export const usersRouter = Router();

const AVATAR_MIME = /^image\/(jpeg|png|gif|webp)$/i;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.avatarsDir),
  filename: (req, file, cb) => {
    const userId = (req as AuthedRequest).auth?.userId;
    if (!userId) {
      cb(new Error("인증이 필요합니다."), "");
      return;
    }
    const ext = path.extname(decodeUploadFileName(file.originalname)).toLowerCase() || ".jpg";
    cb(null, `user-${userId}-${Date.now()}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_AVATAR_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_MIME.test(file.mimetype)) {
      cb(new Error("JPEG, PNG, GIF, WebP 이미지만 업로드할 수 있습니다."));
      return;
    }
    cb(null, true);
  },
});

/** 이미지 태그 등에서 Authorization 헤더 대신 ?token= 쿼리로 인증 */
function allowTokenInQuery(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const headerToken = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  const token = headerToken ?? (req.query.token as string | undefined);
  if (!token) {
    res.status(401).json({ error: "인증 토큰이 없습니다." });
    return;
  }
  try {
    const payload = verifyToken(token);
    const user = getUserById(payload.userId);
    if (!user || user.is_active !== 1) {
      res.status(401).json({ error: "비활성화되었거나 존재하지 않는 계정입니다." });
      return;
    }
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "유효하지 않은 토큰입니다." });
  }
}

/** 프로필 이미지 조회 — img 태그용 ?token= 인증 (전역 requireAuth 제외) */
usersRouter.get("/:id/avatar", allowTokenInQuery, (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user?.profile_image_path || !fs.existsSync(user.profile_image_path)) {
    res.status(404).json({ error: "프로필 이미지가 없습니다." });
    return;
  }
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.resolve(user.profile_image_path));
});

usersRouter.use(requireAuth);

/** 내 온라인 상태 변경 (대화가능/바쁨/자리비움) */
usersRouter.put("/me/status", (req: AuthedRequest, res) => {
  const schema = z.object({
    status: z.enum(["available", "busy", "away"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "status 는 available, busy, away 중 하나여야 합니다." });
    return;
  }
  const userId = req.auth!.userId;
  setPresenceStatus(userId, parsed.data.status as UserPresenceStatus);
  const user = getUserById(userId)!;
  const publicUser = toPublicUser(user);
  broadcastUserUpdated(publicUser);
  res.json(publicUser);
});

/** 내 프로필 이미지 업로드 (기존 파일은 덮어씀) */
usersRouter.post("/me/avatar", (req: AuthedRequest, res) => {
  avatarUpload.single("avatar")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "프로필 이미지는 5MB 이하여야 합니다." });
        return;
      }
      const message = err instanceof Error ? err.message : "업로드에 실패했습니다.";
      res.status(400).json({ error: message });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "업로드할 이미지가 없습니다." });
      return;
    }
    const userId = req.auth!.userId;
    const existing = getUserById(userId);
    if (existing?.profile_image_path && existing.profile_image_path !== file.path) {
      try {
        fs.unlinkSync(existing.profile_image_path);
      } catch {
        /* 이전 파일 삭제 실패는 무시 */
      }
    }
    setProfileImagePath(userId, file.path);
    const publicUser = toPublicUser(getUserById(userId)!);
    broadcastUserUpdated(publicUser);
    res.json(publicUser);
  });
});

/** 사내 사용자 목록 (멤버 사이드바 / 채널 초대 / DM 대상) */
usersRouter.get("/", (_req, res) => {
  const users = listActiveUsers().map(toPublicUser);
  res.json(users);
});
