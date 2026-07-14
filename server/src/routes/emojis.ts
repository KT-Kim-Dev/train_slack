import fs from "node:fs";
import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { verifyToken } from "../auth/jwt.js";
import { getUserById } from "../db/users.js";
import { config } from "../config.js";
import { isMember, markRoomRead } from "../db/rooms.js";
import { insertFileMessage } from "../db/messages.js";
import { broadcastMessage } from "../sockets/index.js";
import { scheduleRoomConversationExport } from "../services/rag-export.js";
import { logger } from "../logger.js";
import {
  isEmojiFile,
  listEmojis,
  parseEmojiId,
  resolveEmojiPath,
} from "../services/emojis.js";
import { buildStoredFileName, resolveDownloadContentType } from "../utils/binary-file.js";
import { decodeUploadFileName } from "../utils/filename.js";

export const emojisRouter = Router();

function allowTokenInQuery(req: AuthedRequest, res: import("express").Response, next: () => void): void {
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

const emojiUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.emojisCustomDir),
    filename: (_req, file, cb) => {
      const decoded = decodeUploadFileName(file.originalname);
      const ext = path.extname(decoded).toLowerCase() || ".gif";
      const base = path.basename(decoded, ext).replace(/[^\w.-]+/g, "_").slice(0, 40) || "emoji";
      cb(null, `${base}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isEmojiFile(file.originalname) || /^image\/(gif|jpeg|png|webp)$/i.test(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("gif, jpg, png, webp 이미지만 업로드할 수 있습니다."));
  },
});

emojisRouter.get("/", requireAuth, async (_req, res) => {
  const emojis = await listEmojis();
  res.json(emojis);
});

emojisRouter.post("/", requireAuth, (req: AuthedRequest, res, next) => {
  emojiUpload.single("emoji")(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "이모티콘 파일은 5MB 이하여야 합니다."
          : err instanceof Error
            ? err.message
            : "업로드 실패";
      res.status(400).json({ error: message });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "업로드할 파일이 없습니다." });
      return;
    }
    logger.info("이모티콘 업로드", { userId: req.auth!.userId, fileName: file.filename });
    void listEmojis().then((items) => {
      const uploaded = items.find((e) => e.category === "custom" && e.fileName === file.filename);
      res.status(201).json(uploaded ?? {
        id: `custom:${file.filename}`,
        fileName: file.filename,
        category: "custom",
        url: `/api/emojis/custom/${encodeURIComponent(file.filename)}`,
        uploadedBy: null,
      });
    });
  });
});

/** 채팅방에 이모티콘(이미지/GIF) 메시지 전송 */
emojisRouter.post("/rooms/:roomId/send", requireAuth, async (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const emojiId = typeof req.body?.emojiId === "string" ? req.body.emojiId.trim() : "";
  const parsed = parseEmojiId(emojiId);
  if (!parsed) {
    res.status(400).json({ error: "유효하지 않은 이모티콘입니다." });
    return;
  }
  if (!isMember(roomId, req.auth!.userId)) {
    res.status(403).json({ error: "이 방에 메시지를 보낼 수 없습니다." });
    return;
  }

  const sourcePath = resolveEmojiPath(parsed.category, parsed.fileName);
  if (!sourcePath) {
    res.status(404).json({ error: "이모티콘 파일을 찾을 수 없습니다." });
    return;
  }

  const stat = fs.statSync(sourcePath);
  const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const storedName = buildStoredFileName(parsed.fileName, unique, resolveDownloadContentType(sourcePath, "image"));
  const destPath = path.join(config.uploadDir, storedName);
  await fsp.copyFile(sourcePath, destPath);

  const message = insertFileMessage({
    roomId,
    senderId: req.auth!.userId,
    messageType: "image",
    fileName: parsed.fileName,
    filePath: destPath,
    fileSize: stat.size,
    metadata: { kind: "emoji" },
  });
  markRoomRead(roomId, req.auth!.userId, message.id);
  broadcastMessage(message);
  scheduleRoomConversationExport(roomId);
  logger.info("이모티콘 메시지 전송", { roomId, userId: req.auth!.userId, emojiId });
  res.status(201).json(message);
});

emojisRouter.get("/:category/:fileName", allowTokenInQuery, (req: AuthedRequest, res) => {
  const category = req.params.category;
  if (category !== "builtin" && category !== "custom") {
    res.status(404).json({ error: "이모티콘을 찾을 수 없습니다." });
    return;
  }
  const filePath = resolveEmojiPath(category, req.params.fileName);
  if (!filePath) {
    res.status(404).json({ error: "이모티콘을 찾을 수 없습니다." });
    return;
  }
  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type", resolveDownloadContentType(filePath, "image"));
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "public, max-age=86400");
  createReadStream(filePath).pipe(res);
});
