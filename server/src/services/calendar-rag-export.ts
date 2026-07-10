import fs from "node:fs/promises";
import path from "node:path";
import type { CalendarEvent } from "@intra-chat/shared";
import { config } from "../config.js";
import { listAllEventsForRagExport } from "../db/calendar.js";
import { getSettings } from "../db/settings.js";
import { logger } from "../logger.js";
import { invalidateRagSnapshotEntry, syncSharedFolder } from "./rag.js";

export const SCHEDULE_RAG_FILE = "schedule.md";

const EXPORT_DEBOUNCE_MS = 3000;
const SYNC_DEBOUNCE_MS = 5000;

let exportTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function queueBackgroundSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncSharedFolder().catch((err) => {
      logger.debug("캘린더 schedule.md RAG 동기화 생략", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, SYNC_DEBOUNCE_MS);
}

function formatIsoReadable(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function formatEventPeriod(event: CalendarEvent): string {
  if (event.allDay) {
    const start = event.startAt.slice(0, 10);
    const endExclusive = new Date(event.endAt);
    endExclusive.setUTCDate(endExclusive.getUTCDate() - 1);
    const end = endExclusive.toISOString().slice(0, 10);
    return start === end ? `${start} (종일)` : `${start} ~ ${end} (종일)`;
  }
  return `${formatIsoReadable(event.startAt)} ~ ${formatIsoReadable(event.endAt)}`;
}

function formatEventBlock(event: CalendarEvent): string {
  const lines = [
    `### ${event.title}`,
    `- **일정 ID**: ${event.id}`,
    `- **기간**: ${formatEventPeriod(event)}`,
    `- **장소**: ${event.location?.trim() || "없음"}`,
    `- **생성자**: ${event.creatorName}`,
    `- **참석자**: ${
      event.attendees.length > 0
        ? event.attendees.map((a) => a.displayName).join(", ")
        : "없음"
    }`,
    `- **공개 범위**: ${event.visibility === "company" ? "전사 공개" : "비공개 (참석자만)"}`,
    `- **리마인더**: ${event.reminderMinutes > 0 ? `${event.reminderMinutes}분 전` : "없음"}`,
    `- **색상**: ${event.color}`,
  ];

  if (event.description?.trim()) {
    lines.push(`- **설명**: ${event.description.trim()}`);
  }

  return lines.join("\n");
}

function buildScheduleMarkdown(events: CalendarEvent[]): string {
  const updatedAt = new Date().toISOString();
  const header = [
    "# 회사 캘린더 일정",
    "",
    "> 이 문서는 캘린더 일정이 생성·수정·삭제될 때 자동으로 갱신됩니다.",
    `> 최종 갱신: ${updatedAt}`,
    "",
    "AI 어시스턴트는 일정 관련 질문에 답할 때 이 문서를 참고하세요.",
    "",
    "---",
    "",
    `## 일정 목록 (총 ${events.length}건)`,
    "",
  ];

  if (events.length === 0) {
    return [...header, "_등록된 일정이 없습니다._", ""].join("\n");
  }

  const byMonth = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const monthKey = event.startAt.slice(0, 7);
    const list = byMonth.get(monthKey) ?? [];
    list.push(event);
    byMonth.set(monthKey, list);
  }

  const body: string[] = [];
  for (const monthKey of [...byMonth.keys()].sort()) {
    body.push(`## ${monthKey}`, "");
    for (const event of byMonth.get(monthKey)!) {
      body.push(formatEventBlock(event), "");
    }
  }

  return [...header, ...body].join("\n");
}

/** RAG 폴더에 schedule.md 를 기록하고 색인 동기화를 예약한다 */
export async function exportCalendarScheduleToRag(): Promise<string | null> {
  const settings = getSettings();
  if (!settings.rag_enabled) return null;

  const events = listAllEventsForRagExport();
  const absolutePath = path.join(config.ragDocumentFolder, SCHEDULE_RAG_FILE);
  await fs.mkdir(config.ragDocumentFolder, { recursive: true });
  await fs.writeFile(absolutePath, buildScheduleMarkdown(events), "utf8");

  invalidateRagSnapshotEntry(SCHEDULE_RAG_FILE);
  queueBackgroundSync();

  logger.info("캘린더 일정을 RAG schedule.md 에 기록", {
    eventCount: events.length,
    path: SCHEDULE_RAG_FILE,
  });
  return SCHEDULE_RAG_FILE;
}

/** 일정 변경 시 디바운스로 schedule.md 갱신을 예약한다 */
export function scheduleCalendarScheduleExport(): void {
  const settings = getSettings();
  if (!settings.rag_enabled) return;

  if (exportTimer) clearTimeout(exportTimer);
  exportTimer = setTimeout(() => {
    exportTimer = null;
    void exportCalendarScheduleToRag().catch((err) => {
      logger.warn("캘린더 schedule.md RAG 기록 실패", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, EXPORT_DEBOUNCE_MS);
}
