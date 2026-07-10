import { useMemo, useState } from "react";
import type { CalendarEvent, CalendarEventColor, CalendarEventInput, PublicUser } from "@intra-chat/shared";
import {
  CALENDAR_EVENT_COLORS,
  DEFAULT_CALENDAR_EVENT_COLOR,
} from "@intra-chat/shared";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "../api";

interface Props {
  event: CalendarEvent | null;
  /** 새 일정일 때 프리필 날짜 (로컬 YYYY-MM-DD) */
  defaultDate?: string | null;
  users: PublicUser[];
  currentUser: PublicUser;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
  onDeleted: (eventId: number) => void;
}

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayLocalDate(): string {
  return toLocalDateInput(new Date().toISOString());
}

/** 종일: 로컬 날짜 → UTC 자정 ISO (start inclusive, end exclusive next day) */
function allDayRangeToIso(startDate: string, endDate: string): { startAt: string; endAt: string } {
  const start = new Date(`${startDate}T00:00:00`);
  const endExclusive = new Date(`${endDate}T00:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { startAt: start.toISOString(), endAt: endExclusive.toISOString() };
}

function timedRangeToIso(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
): { startAt: string; endAt: string } {
  const start = new Date(`${startDate}T${startTime}:00`);
  const end = new Date(`${endDate}T${endTime}:00`);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function EventModal({
  event,
  defaultDate,
  users,
  currentUser,
  onClose,
  onSaved,
  onDeleted,
}: Props): JSX.Element {
  const isEdit = event != null;
  const canEdit = !isEdit || event.createdBy === currentUser.id;

  const initialAllDay = event?.allDay ?? false;
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(initialAllDay);
  const [visibility, setVisibility] = useState<"private" | "company">(
    event?.visibility ?? "company"
  );
  const [reminderMinutes, setReminderMinutes] = useState(event?.reminderMinutes ?? 10);
  const [color, setColor] = useState<CalendarEventColor>(
    event?.color ?? DEFAULT_CALENDAR_EVENT_COLOR
  );
  const [startDate, setStartDate] = useState(
    event ? toLocalDateInput(event.startAt) : defaultDate ?? todayLocalDate()
  );
  const [endDate, setEndDate] = useState(() => {
    if (!event) return defaultDate ?? todayLocalDate();
    if (event.allDay) {
      // exclusive end → display as last inclusive day
      const end = new Date(event.endAt);
      end.setDate(end.getDate() - 1);
      return toLocalDateInput(end.toISOString());
    }
    return toLocalDateInput(event.endAt);
  });
  const [startTime, setStartTime] = useState(
    event && !event.allDay ? toLocalTimeInput(event.startAt) : "09:00"
  );
  const [endTime, setEndTime] = useState(
    event && !event.allDay ? toLocalTimeInput(event.endAt) : "10:00"
  );
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set((event?.attendees ?? []).map((a) => a.userId))
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const otherUsers = useMemo(
    () => users.filter((u) => u.id !== currentUser.id),
    [users, currentUser.id]
  );

  function toggle(userId: number): void {
    if (!canEdit) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSubmit(): Promise<void> {
    if (!canEdit) return;
    setError(null);
    if (!title.trim()) {
      setError("제목을 입력하세요.");
      return;
    }

    let startAt: string;
    let endAt: string;
    if (allDay) {
      ({ startAt, endAt } = allDayRangeToIso(startDate, endDate));
    } else {
      ({ startAt, endAt } = timedRangeToIso(startDate, startTime, endDate, endTime));
    }

    if (Date.parse(endAt) < Date.parse(startAt)) {
      setError("종료 시각은 시작 시각 이후여야 합니다.");
      return;
    }

    const input: CalendarEventInput = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      startAt,
      endAt,
      allDay,
      visibility,
      reminderMinutes,
      color,
      attendeeIds: [...selected],
    };

    setSubmitting(true);
    try {
      const saved = isEdit
        ? await updateCalendarEvent(event.id, input)
        : await createCalendarEvent(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
      setSubmitting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!event || !canEdit) return;
    if (!confirm(`'${event.title}' 일정을 삭제하시겠습니까?`)) return;
    setSubmitting(true);
    try {
      await deleteCalendarEvent(event.id);
      onDeleted(event.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <h2>{isEdit ? (canEdit ? "일정 수정" : "일정 상세") : "새 일정"}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="field">
          <span>제목</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canEdit}
            autoFocus
            placeholder="예: 주간 회의"
          />
        </label>

        <label className="field checkbox-row">
          <input
            type="checkbox"
            checked={allDay}
            disabled={!canEdit}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          <span>종일</span>
        </label>

        <div className="field-row">
          <label className="field">
            <span>시작일</span>
            <input
              type="date"
              value={startDate}
              disabled={!canEdit}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          {!allDay && (
            <label className="field">
              <span>시작 시각</span>
              <input
                type="time"
                value={startTime}
                disabled={!canEdit}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span>종료일</span>
            <input
              type="date"
              value={endDate}
              disabled={!canEdit}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          {!allDay && (
            <label className="field">
              <span>종료 시각</span>
              <input
                type="time"
                value={endTime}
                disabled={!canEdit}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          )}
        </div>

        <label className="field">
          <span>목적 / 세부 정보</span>
          <textarea
            className="modal-textarea"
            value={description}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="일정 목적, 안건 등"
          />
        </label>

        <label className="field">
          <span>장소</span>
          <input
            type="text"
            value={location}
            disabled={!canEdit}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="예: 회의실 A"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>공개 범위</span>
            <select
              value={visibility}
              disabled={!canEdit}
              onChange={(e) => setVisibility(e.target.value as "private" | "company")}
            >
              <option value="company">공개 일정 (전사)</option>
              <option value="private">비공개 (참석자만)</option>
            </select>
          </label>
          <label className="field">
            <span>리마인더</span>
            <select
              value={reminderMinutes}
              disabled={!canEdit}
              onChange={(e) => setReminderMinutes(Number(e.target.value))}
            >
              <option value={0}>없음</option>
              <option value={5}>5분 전</option>
              <option value={10}>10분 전</option>
              <option value={30}>30분 전</option>
              <option value={60}>1시간 전</option>
              <option value={1440}>1일 전</option>
            </select>
          </label>
        </div>

        <div className="field">
          <span>표시 색상</span>
          <div className="event-color-picker" role="radiogroup" aria-label="일정 표시 색상">
            {CALENDAR_EVENT_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className={`event-color-swatch ${color === option ? "selected" : ""}`}
                style={{ backgroundColor: option }}
                disabled={!canEdit}
                aria-label={`색상 ${option}`}
                aria-checked={color === option}
                role="radio"
                onClick={() => setColor(option)}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span>참여 인원</span>
          <ul className="user-select-list">
            {otherUsers.map((u) => (
              <li key={u.id}>
                <label className="user-select-item">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    disabled={!canEdit}
                    onChange={() => toggle(u.id)}
                  />
                  <span>{u.displayName}</span>
                </label>
              </li>
            ))}
          </ul>
          {isEdit && (
            <div className="event-creator-hint">
              생성자: {event.creatorName}
            </div>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          {isEdit && canEdit && (
            <button
              type="button"
              className="btn-danger"
              disabled={submitting}
              onClick={() => void handleDelete()}
            >
              삭제
            </button>
          )}
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {canEdit ? "취소" : "닫기"}
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-primary"
                disabled={submitting}
                onClick={() => void handleSubmit()}
              >
                {submitting ? "저장 중…" : "저장"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
