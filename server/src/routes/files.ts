import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { verifyToken } from "../auth/jwt.js";
import { getUserById } from "../db/users.js";
import { config } from "../config.js";
import { isMember, markRoomRead } from "../db/rooms.js";
import { getFileMeta, insertFileMessage } from "../db/messages.js";
import { broadcastMessage } from "../sockets/index.js";
import { logger } from "../logger.js";

export const filesRouter = Router();

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp|bmp)$/i;

/**
 * 이미지 <img src> 등에서 Authorization 헤더를 붙이기 어려운 경우를 위해
 * 헤더 또는 쿼리스트링(?token=) 두 방식 모두로 JWT 인증을 허용한다.
 */
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

// 원본 파일명은 DB에 저장하고, 실제 저장 파일명은 충돌 방지를 위해 랜덤 접두어를 붙인다.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  // FR-24: 확장자 제한이 필요하면 여기에서 file.originalname/mimetype 기반으로 차단 가능.
  // PoC 단계에서는 제한 없이 허용한다.
});

/**
 * 파일/이미지 업로드 (FR-16~FR-23).
 * 다중 파일을 지원하며, 각 파일을 하나의 메시지로 저장하고 실시간 브로드캐스트한다.
 */
filesRouter.post(
  "/rooms/:id/files",
  requireAuth,
  (req: AuthedRequest, res, next) => {
    const roomId = Number(req.params.id);
    if (!isMember(roomId, req.auth!.userId)) {
      res.status(403).json({ error: "이 방에 파일을 올릴 수 없습니다." });
      return;
    }
    upload.array("files")(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          const mb = Math.round(config.maxFileSize / (1024 * 1024));
          res.status(413).json({ error: `파일 크기가 제한(${mb}MB)을 초과했습니다.` });
          return;
        }
        next(err);
        return;
      }
      handleUploaded(req, res, roomId);
    });
  }
);

function handleUploaded(req: AuthedRequest, res: import("express").Response, roomId: number): void {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "업로드할 파일이 없습니다." });
    return;
  }
  const senderId = req.auth!.userId;
  const created = files.map((f) => {
    const messageType = IMAGE_MIME.test(f.mimetype) ? "image" : "file";
    const message = insertFileMessage({
      roomId,
      senderId,
      messageType,
      fileName: f.originalname,
      filePath: f.path,
      fileSize: f.size,
    });
    broadcastMessage(message);
    return message;
  });
  const last = created[created.length - 1];
  markRoomRead(roomId, senderId, last.id);
  logger.info("파일 업로드", { roomId, senderId, count: created.length });
  res.status(201).json({ messages: created });
}

/**
 * 파일 다운로드/미리보기 (FR-21, FR-22).
 * 이미지는 인라인(브라우저 미리보기), 그 외는 첨부(다운로드)로 응답한다.
 */
filesRouter.get("/files/:id", allowTokenInQuery, (req: AuthedRequest, res) => {
  const messageId = Number(req.params.id);
  const meta = getFileMeta(messageId);
  if (!meta || !fs.existsSync(meta.filePath)) {
    res.status(404).json({ error: "파일을 찾을 수 없습니다." });
    return;
  }
  const disposition = meta.messageType === "image" ? "inline" : "attachment";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`
  );
  res.sendFile(path.resolve(meta.filePath));
});
