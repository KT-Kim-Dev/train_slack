import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { getMessagesForRagExport } from "../db/messages.js";
import { getRoomById } from "../db/rooms.js";
import { getSettings } from "../db/settings.js";
import { logger } from "../logger.js";
import { invalidateRagSnapshotEntry, syncSharedFolder } from "./rag.js";

const AI_UPLOADS_DIR = "ai-uploads";
const CONVERSATIONS_DIR = "conversations";
const EXPORT_DEBOUNCE_MS = 3000;
const SYNC_DEBOUNCE_MS = 5000;

const roomExportTimers = new Map<number, ReturnType<typeof setTimeout>>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function sanitizeFileSegment(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
}

async function ensureRagDirs(): Promise<void> {
  await fs.mkdir(path.join(config.ragDocumentFolder, AI_UPLOADS_DIR), { recursive: true });
  await fs.mkdir(path.join(config.ragDocumentFolder, CONVERSATIONS_DIR), { recursive: true });
}

function conversationFileName(roomId: number, roomType: string, roomName: string): string {
  const safeName = sanitizeFileSegment(roomName);
  switch (roomType) {
    case "channel":
      return `channel-${roomId}-${safeName || "unnamed"}.md`;
    case "group":
      return `group-${roomId}-${safeName || "unnamed"}.md`;
    case "dm":
      return `dm-${roomId}.md`;
    case "ai":
      return `ai-${roomId}-${safeName || "assistant"}.md`;
    default:
      return `room-${roomId}.md`;
  }
}

function formatMessageLine(msg: {
  messageType: string;
  content: string | null;
  fileName: string | null;
  senderName: string;
  createdAt: string;
}): string | null {
  const time = msg.createdAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");
  switch (msg.messageType) {
    case "text":
      return msg.content?.trim()
        ? `[${time}] ${msg.senderName}: ${msg.content.trim()}`
        : null;
    case "ai_response":
      return msg.content?.trim()
        ? `[${time}] AI: ${msg.content.trim()}`
        : null;
    case "file":
    case "image":
      return `[${time}] ${msg.senderName}: [첨부파일: ${msg.fileName ?? "파일"}]`;
    case "card":
      return msg.content?.trim()
        ? `[${time}] ${msg.senderName}: [카드] ${msg.content.trim()}`
        : `[${time}] ${msg.senderName}: [카드 메시지]`;
    default:
      return null;
  }
}

function queueBackgroundSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncSharedFolder().catch((err) => {
      logger.debug("RAG 백그라운드 동기화 생략", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, SYNC_DEBOUNCE_MS);
}

/**
 * AI 어시스턴트 방에 업로드된 파일을 RAG/ai-uploads 에 복사한다.
 */
export async function copyAiUploadToRag(sourcePath: string, fileName: string): Promise<string | null> {
  const settings = getSettings();
  if (!settings.rag_enabled) return null;

  await ensureRagDirs();
  const safeName = sanitizeFileSegment(fileName) || "upload";
  const destName = `${Date.now()}-${safeName}`;
  const relativePath = `${AI_UPLOADS_DIR}/${destName}`;
  const destPath = path.join(config.ragDocumentFolder, relativePath);

  await fs.copyFile(sourcePath, destPath);
  invalidateRagSnapshotEntry(relativePath);
  queueBackgroundSync();

  logger.info("AI 업로드 파일을 RAG 폴더에 저장", { fileName, relativePath });
  return relativePath;
}

/**
 * 채널/그룹/DM/AI 방 대화를 RAG/conversations 에 마크다운으로 기록한다.
 */
export async function exportRoomConversationToRag(roomId: number): Promise<string | null> {
  const settings = getSettings();
  if (!settings.rag_enabled) return null;

  const room = getRoomById(roomId);
  if (!room) return null;

  await ensureRagDirs();
  const fileName = conversationFileName(room.id, room.type, room.name);
  const relativePath = `${CONVERSATIONS_DIR}/${fileName}`;
  const absolutePath = path.join(config.ragDocumentFolder, relativePath);

  const messages = getMessagesForRagExport(roomId);
  const lines = messages
    .map(formatMessageLine)
    .filter((line): line is string => line !== null);

  const header = [
    `# ${room.name}`,
    ``,
    `- 방 ID: ${room.id}`,
    `- 유형: ${room.type}`,
    `- 최종 갱신: ${new Date().toISOString()}`,
    `- 메시지 수: ${lines.length}`,
    ``,
    `---`,
    ``,
  ];

  await fs.writeFile(absolutePath, [...header, ...lines, ""].join("\n"), "utf8");
  invalidateRagSnapshotEntry(relativePath);
  queueBackgroundSync();

  logger.debug("채팅방 대화를 RAG 폴더에 기록", { roomId, relativePath, messageCount: lines.length });
  return relativePath;
}

/** 메시지 발생 시 디바운스로 대화보내기를 예약한다 */
export function scheduleRoomConversationExport(roomId: number): void {
  const settings = getSettings();
  if (!settings.rag_enabled) return;

  const existing = roomExportTimers.get(roomId);
  if (existing) clearTimeout(existing);

  roomExportTimers.set(
    roomId,
    setTimeout(() => {
      roomExportTimers.delete(roomId);
      void exportRoomConversationToRag(roomId).catch((err) => {
        logger.warn("채팅방 RAG보내기 실패", {
          roomId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, EXPORT_DEBOUNCE_MS)
  );
}

/** 서버 시작 시 기존 방 대화를 한 번보낸다 */
export async function exportAllRoomConversations(): Promise<void> {
  const settings = getSettings();
  if (!settings.rag_enabled) return;

  const rooms = db.prepare("SELECT id FROM rooms").all() as { id: number }[];
  for (const { id } of rooms) {
    try {
      await exportRoomConversationToRag(id);
    } catch (err) {
      logger.warn("초기 RAG 대화보내기 실패", {
        roomId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
