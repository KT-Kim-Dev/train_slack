import fs from "node:fs/promises";
import path from "node:path";
import type { CalendarEvent } from "@intra-chat/shared";
import { config } from "../config.js";
import { listAllEventsForRagExport } from "../db/calendar.js";
import { getSettings } from "../db/settings.js";
import { logger } from "../logger.js";
import { invalidateRagSnapshotEntry, syncSharedFolder } from "./rag.js";

export const SCHEDULE_RAG_FILE = "schedule.csv";
const LEGACY_SCHEDULE_RAG_FILE = "schedule.md";

const EXPORT_DEBOUNCE_MS = 3000;
const SYNC_DEBOUNCE_MS = 5000;

const CSV_HEADERS = [
  "id",
  "title",
  "description",
  "location",
  "start_at",
  "end_at",
  "all_day",
  "visibility",
  "reminder_minutes",
  "color",
  "created_by",
  "creator_name",
  "attendee_names",
  "created_at",
  "updated_at",
] as const;

let exportTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function queueBackgroundSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncSharedFolder().catch((err) => {
      logger.debug("캘린더 schedule.csv RAG 동기화 생략", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, SYNC_DEBOUNCE_MS);
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function eventToCsvRow(event: CalendarEvent): string {
  return [
    event.id,
    event.title,
    event.description ?? "",
    event.location ?? "",
    event.startAt,
    event.endAt,
    event.allDay ? 1 : 0,
    event.visibility,
    event.reminderMinutes,
    event.color,
    event.createdBy,
    event.creatorName,
    event.attendees.map((a) => a.displayName).join(";"),
    event.createdAt,
    event.updatedAt,
  ]
    .map((value) => escapeCsvField(value))
    .join(",");
}

function buildScheduleCsv(events: CalendarEvent[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const event of events) {
    lines.push(eventToCsvRow(event));
  }
  return `${lines.join("\n")}\n`;
}

async function removeLegacyScheduleFile(): Promise<void> {
  const legacyPath = path.join(config.ragDocumentFolder, LEGACY_SCHEDULE_RAG_FILE);
  try {
    await fs.unlink(legacyPath);
    invalidateRagSnapshotEntry(LEGACY_SCHEDULE_RAG_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.debug("레거시 schedule.md 제거 생략", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** RAG 폴더에 schedule.csv 를 기록하고 색인 동기화를 예약한다 */
export async function exportCalendarScheduleToRag(): Promise<string | null> {
  const settings = getSettings();
  if (!settings.rag_enabled) return null;

  const events = listAllEventsForRagExport();
  const absolutePath = path.join(config.ragDocumentFolder, SCHEDULE_RAG_FILE);
  await fs.mkdir(config.ragDocumentFolder, { recursive: true });
  await fs.writeFile(absolutePath, buildScheduleCsv(events), "utf8");
  await removeLegacyScheduleFile();

  invalidateRagSnapshotEntry(SCHEDULE_RAG_FILE);
  queueBackgroundSync();

  logger.info("캘린더 일정을 RAG schedule.csv 에 기록", {
    eventCount: events.length,
    path: SCHEDULE_RAG_FILE,
  });
  return SCHEDULE_RAG_FILE;
}

/** 일정 변경 시 디바운스로 schedule.csv 갱신을 예약한다 */
export function scheduleCalendarScheduleExport(): void {
  const settings = getSettings();
  if (!settings.rag_enabled) return;

  if (exportTimer) clearTimeout(exportTimer);
  exportTimer = setTimeout(() => {
    exportTimer = null;
    void exportCalendarScheduleToRag().catch((err) => {
      logger.warn("캘린더 schedule.csv RAG 기록 실패", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, EXPORT_DEBOUNCE_MS);
}
