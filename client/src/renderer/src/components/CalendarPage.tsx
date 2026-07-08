import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { CalendarEvent, PublicUser } from "@intra-chat/shared";
import { fetchCalendarEvents } from "../api";
import { assignEventColors } from "../utils/eventColors";
import { EventModal } from "./EventModal";

interface Props {
  currentUser: PublicUser;
  users: PublicUser[];
  /** 알림에서 열 일정 id */
  focusEventId?: number | null;
  onFocusConsumed?: () => void;
  /** 소켓 등으로 외부에서 갱신 요청할 때 증가시키는 카운터 */
  refreshToken?: number;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthRangeIso(year: number, month: number): { from: string; to: string } {
  // 달력 그리드: 해당 월을 포함하는 주 전체 (앞뒤 패딩)
  const first = startOfMonth(year, month);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const last = new Date(year, month + 1, 0);
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));
  gridEnd.setHours(23, 59, 59, 999);
  return { from: gridStart.toISOString(), to: gridEnd.toISOString() };
}

function formatTimeChip(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 이벤트가 해당 로컬 날짜(YYYY-MM-DD)에 걸쳐 있는지 */
function eventTouchesDay(event: CalendarEvent, ymd: string): boolean {
  const dayStart = new Date(`${ymd}T00:00:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  return start < dayEnd && end > dayStart;
}

export function CalendarPage({
  currentUser,
  users,
  focusEventId,
  onFocusConsumed,
  refreshToken = 0,
}: Props): JSX.Element {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date().getFullYear(), new Date().getMonth()));
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalEvent, setModalEvent] = useState<CalendarEvent | null>(null);
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = monthRangeIso(year, month);
      const list = await fetchCalendarEvents({ from, to, scope });
      setEvents(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "일정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, month, scope]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (focusEventId == null) return;
    const found = events.find((e) => e.id === focusEventId);
    if (found) {
      setModalEvent(found);
      setCreatingDate(null);
      setShowModal(true);
      onFocusConsumed?.();
      return;
    }
    // 목록에 없으면 API 단건은 생략하고 재로드 후 재시도
    void (async () => {
      try {
        const { from, to } = monthRangeIso(year, month);
        const list = await fetchCalendarEvents({ from, to, scope: "all" });
        setEvents(list);
        const hit = list.find((e) => e.id === focusEventId);
        if (hit) {
          setModalEvent(hit);
          setCreatingDate(null);
          setShowModal(true);
        }
      } finally {
        onFocusConsumed?.();
      }
    })();
  }, [focusEventId, events, year, month, onFocusConsumed]);

  const days = useMemo(() => {
    const first = startOfMonth(year, month);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [year, month]);

  const eventColors = useMemo(() => assignEventColors(events), [events]);

  const todayYmd = toLocalYmd(new Date());
  const titleLabel = `${year}년 ${month + 1}월`;

  function openCreate(ymd?: string): void {
    setModalEvent(null);
    setCreatingDate(ymd ?? todayYmd);
    setShowModal(true);
  }

  function openEvent(event: CalendarEvent, e: MouseEvent): void {
    e.stopPropagation();
    setModalEvent(event);
    setCreatingDate(null);
    setShowModal(true);
  }

  return (
    <div className="calendar-page">
      <header className="calendar-toolbar">
        <div className="calendar-toolbar-left">
          <h1 className="calendar-title">캘린더</h1>
          <div className="calendar-nav">
            <button type="button" className="btn-secondary" onClick={() => setCursor(addMonths(cursor, -1))}>
              ‹
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCursor(startOfMonth(new Date().getFullYear(), new Date().getMonth()))}
            >
              오늘
            </button>
            <button type="button" className="btn-secondary" onClick={() => setCursor(addMonths(cursor, 1))}>
              ›
            </button>
            <span className="calendar-month-label">{titleLabel}</span>
          </div>
        </div>
        <div className="calendar-toolbar-right">
          <div className="calendar-scope-toggle">
            <button
              type="button"
              className={`scope-btn ${scope === "all" ? "active" : ""}`}
              onClick={() => setScope("all")}
            >
              전체 일정
            </button>
            <button
              type="button"
              className={`scope-btn ${scope === "mine" ? "active" : ""}`}
              onClick={() => setScope("mine")}
            >
              내 일정
            </button>
          </div>
          <button type="button" className="btn-primary" onClick={() => openCreate()}>
            만들기
          </button>
        </div>
      </header>

      {error && <div className="calendar-error">{error}</div>}
      {loading && <div className="calendar-loading">불러오는 중…</div>}

      <div className="calendar-grid">
        <div className="calendar-weekday-row">
          {WEEKDAYS.map((w, idx) => (
            <div
              key={w}
              className={`calendar-weekday ${idx === 0 || idx === 6 ? "weekend" : ""}`}
            >
              {w}
            </div>
          ))}
        </div>
        <div className="calendar-days">
          {days.map((day) => {
            const ymd = toLocalYmd(day);
            const inMonth = day.getMonth() === month;
            const isToday = ymd === todayYmd;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const dayEvents = events.filter((ev) => eventTouchesDay(ev, ymd));
            return (
              <button
                key={ymd}
                type="button"
                className={`calendar-day ${inMonth ? "" : "outside"} ${isToday ? "today" : ""}`}
                onClick={() => openCreate(ymd)}
              >
                <span className={`calendar-day-num ${isWeekend ? "weekend" : ""}`}>
                  {day.getDate()}
                </span>
                <div className="calendar-day-events">
                  {dayEvents.slice(0, 3).map((ev) => {
                    const color = eventColors.get(ev.id) ?? "#1a73e8";
                    return (
                      <span
                        key={`${ev.id}-${ymd}`}
                        className="calendar-chip"
                        style={{ backgroundColor: color }}
                        title={ev.title}
                        onClick={(e) => openEvent(ev, e)}
                      >
                        {!ev.allDay && <span className="chip-time">{formatTimeChip(ev.startAt)}</span>}
                        <span className="chip-title">{ev.title}</span>
                      </span>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <span className="calendar-more">+{dayEvents.length - 3}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {showModal && (
        <EventModal
          event={modalEvent}
          defaultDate={creatingDate}
          users={users}
          currentUser={currentUser}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            void load();
          }}
          onDeleted={() => {
            setShowModal(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
