import {
  eventParticipantIds,
  listDueReminders,
  markReminderSent,
} from "../db/calendar.js";
import { logger } from "../logger.js";
import { notifyCalendarEvent } from "../sockets/index.js";

const POLL_INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function tickReminders(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = listDueReminders();
    for (const event of due) {
      markReminderSent(event.id);
      const targets = eventParticipantIds(event);
      notifyCalendarEvent("reminder", event, targets);
      logger.info("캘린더 리마인더 발송", {
        eventId: event.id,
        title: event.title,
        recipients: targets.length,
      });
    }
  } catch (err) {
    logger.error("캘린더 리마인더 처리 오류", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    ticking = false;
  }
}

export function startCalendarReminderScheduler(): void {
  if (timer) return;
  logger.info("캘린더 리마인더 스케줄러 시작", { intervalSeconds: POLL_INTERVAL_MS / 1000 });
  void tickReminders();
  timer = setInterval(() => {
    void tickReminders();
  }, POLL_INTERVAL_MS);
}
