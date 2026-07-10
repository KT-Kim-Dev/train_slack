import fs from "node:fs";
import { config } from "../config.js";
import { getSettings } from "../db/settings.js";
import { logger } from "../logger.js";
import { syncSharedFolder } from "./rag.js";
import { exportAllRoomConversations } from "./rag-export.js";
import { exportCalendarScheduleToRag } from "./calendar-rag-export.js";

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let syncing = false;

async function runScheduledSync(): Promise<void> {
  const settings = getSettings();
  if (!settings.rag_enabled) return;
  if (syncing) {
    logger.debug("RAG 자동 동기화 건너뜀 — 이전 작업 진행 중");
    return;
  }

  syncing = true;
  try {
    const result = await syncSharedFolder();
    logger.info("RAG 자동 동기화 완료", {
      filesProcessed: result.filesProcessed,
      filesUpdated: result.filesUpdated,
      filesSkipped: result.filesSkipped,
      chunksIndexed: result.chunksIndexed,
      chunksRemoved: result.chunksRemoved,
      errors: result.errors.length,
    });
  } catch (err) {
    logger.debug("RAG 자동 동기화 생략", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    syncing = false;
  }
}

/** 10분마다 서버 RAG 폴더를 확인해 변경된 문서만 동기화한다 */
export function startRagScheduler(): void {
  if (timer) return;

  if (!fs.existsSync(config.ragDocumentFolder)) {
    try {
      fs.mkdirSync(config.ragDocumentFolder, { recursive: true });
      logger.info("RAG 폴더 생성", { folder: config.ragDocumentFolder });
    } catch {
      logger.warn("RAG 폴더를 생성하지 못했습니다.", { folder: config.ragDocumentFolder });
    }
  }

  setTimeout(() => {
    void exportAllRoomConversations()
      .then(() => exportCalendarScheduleToRag())
      .finally(() => {
        void runScheduledSync();
      });
  }, STARTUP_DELAY_MS);

  timer = setInterval(() => {
    void runScheduledSync();
  }, SYNC_INTERVAL_MS);

  logger.info("RAG 자동 동기화 스케줄러 시작", {
    intervalMinutes: SYNC_INTERVAL_MS / 60000,
    startupDelaySeconds: STARTUP_DELAY_MS / 1000,
  });
}

export function stopRagScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
