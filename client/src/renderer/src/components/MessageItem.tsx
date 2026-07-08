import { useState } from "react";
import type { BuildCard, IssueCard, Message, ScheduleCard } from "@intra-chat/shared";
import { fileUrl } from "../api";
import { MessageContent } from "./MessageContent";
import type { AiFlowKind } from "../utils/aiMessageFlow";

interface Props {
  message: Message;
  isMine: boolean;
  isAiStreaming?: boolean;
  aiFlowKind?: AiFlowKind | null;
  onImageClick: (url: string) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function MessageItem({
  message,
  isMine,
  isAiStreaming = false,
  aiFlowKind = null,
  onImageClick,
}: Props): JSX.Element {
  const [downloading, setDownloading] = useState(false);
  const url = message.fileUrl ? fileUrl(message.fileUrl) : null;

  async function handleDownload(): Promise<void> {
    if (!url || !message.fileName) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      const buffer = await res.arrayBuffer();
      await window.intraChat.saveFile(message.fileName, buffer);
    } finally {
      setDownloading(false);
    }
  }

  const isAi = message.messageType === "ai_response";
  const isAiQuestion = aiFlowKind === "question";
  const isAiAnswer = aiFlowKind === "answer";
  const askerName = message.senderName ?? "사용자";

  const avatarLabel = isAiAnswer || (isAi && !aiFlowKind) ? "🤖" : message.senderName?.[0] ?? "?";

  return (
    <div
      className={`message ${isMine ? "mine" : ""} ${isAi ? "ai" : ""} ${isAiQuestion ? "ai-flow-question" : ""} ${isAiAnswer ? "ai-flow-answer" : ""}`}
    >
      <div className="message-avatar">{avatarLabel}</div>
      <div className="message-body">
        <div className="message-meta">
          {isAiQuestion ? (
            <AiFlowLabel from={askerName} to="AI" />
          ) : isAiAnswer ? (
            <AiFlowLabel from="AI" to={askerName} />
          ) : (
            <span className="message-sender">{message.senderName}</span>
          )}
          <span className="message-time">{formatTime(message.createdAt)}</span>
        </div>

        {message.messageType === "text" && (
          <div className={isAiQuestion ? "message-text ai-flow-question-text" : undefined}>
            <MessageContent content={message.content ?? ""} />
          </div>
        )}

        {isAi && (
          <div className="message-text ai-text">
            {message.content ? (
              <>
                <MessageContent content={message.content} className="ai-content" />
                {isAiStreaming && (
                  <span className="ai-stream-cursor" aria-label="응답 생성 중">
                    ▍
                  </span>
                )}
              </>
            ) : isAiStreaming ? (
              <AiProgressIndicator />
            ) : null}
          </div>
        )}

        {message.messageType === "card" && message.metadata?.kind === "issue" && (
          <IssueCardView card={message.metadata} />
        )}
        {message.messageType === "card" && message.metadata?.kind === "build" && (
          <BuildCardView card={message.metadata} />
        )}
        {message.messageType === "card" && message.metadata?.kind === "schedule" && (
          <ScheduleCardView card={message.metadata} />
        )}

        {message.messageType === "image" && url && (
          <div className="message-image">
            <img
              src={url}
              alt={message.fileName ?? "image"}
              onClick={() => onImageClick(url)}
              loading="lazy"
            />
            <div className="file-caption">
              {message.fileName} · {formatSize(message.fileSize)}
            </div>
          </div>
        )}

        {message.messageType === "file" && (
          <button className="message-file" onClick={handleDownload} disabled={downloading}>
            <span className="file-icon">📄</span>
            <span className="file-info">
              <span className="file-name">{message.fileName}</span>
              <span className="file-size">
                {formatSize(message.fileSize)} {downloading ? "· 저장 중..." : "· 클릭하여 다운로드"}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function AiFlowLabel({ from, to }: { from: string; to: string }): JSX.Element {
  const fromAi = from === "AI";
  const toAi = to === "AI";
  return (
    <span className="ai-flow-label">
      <span className={`ai-flow-party ${fromAi ? "ai-party" : "user-party"}`}>{from}</span>
      <span className="ai-flow-arrow" aria-hidden="true">
        →
      </span>
      <span className={`ai-flow-party ${toAi ? "ai-party" : "user-party"}`}>{to}</span>
    </span>
  );
}

/** AI 응답 대기/생성 중임을 시각적으로 표시한다 */
function AiProgressIndicator(): JSX.Element {
  return (
    <span className="ai-progress" role="status" aria-live="polite">
      <span className="ai-progress-spinner" aria-hidden="true" />
      <span className="ai-progress-text">
        생각 중
        <span className="ai-progress-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
      <span className="ai-progress-hint">응답 생성 중</span>
    </span>
  );
}

/** Yona 이슈 카드 (FR-35, FR-37) */
function IssueCardView({ card }: { card: IssueCard }): JSX.Element {
  return (
    <div className="card issue-card">
      <div className="card-header">
        <span className="card-badge issue">ISSUE #{card.issueId}</span>
        {card.status && <span className="card-status">{card.status}</span>}
      </div>
      <div className="card-title">{card.title}</div>
      <div className="card-fields">
        {card.assignee && <span>담당자: {card.assignee}</span>}
        {card.priority && <span>우선순위: {card.priority}</span>}
        {card.dueDate && <span>마감: {card.dueDate}</span>}
      </div>
      {card.url && (
        <a className="card-link" href={card.url} target="_blank" rel="noreferrer">
          이슈 열기 →
        </a>
      )}
    </div>
  );
}

/** Jenkins 빌드 카드 (FR-41, FR-42, FR-43) */
function BuildCardView({ card }: { card: BuildCard }): JSX.Element {
  const status = (card.status ?? "").toUpperCase();
  const tone = status === "SUCCESS" ? "success" : status === "FAILURE" ? "failure" : "neutral";
  const phaseLabel =
    card.phase === "started" ? "빌드 시작" : card.phase === "finished" ? "빌드 완료" : "빌드 상태";
  return (
    <div className={`card build-card ${tone}`}>
      <div className="card-header">
        <span className="card-badge build">BUILD{card.buildNumber ? ` #${card.buildNumber}` : ""}</span>
        <span className="card-status">{phaseLabel}</span>
      </div>
      <div className="card-title">{card.project}</div>
      <div className="card-fields">
        {card.status && <span>상태: {card.status}</span>}
        {card.durationSec != null && <span>소요: {card.durationSec}s</span>}
      </div>
      {card.logUrl && (
        <a className="card-link" href={card.logUrl} target="_blank" rel="noreferrer">
          빌드 로그 보기 →
        </a>
      )}
    </div>
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatScheduleDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatScheduleClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 조회 카드용 기간(기한) 표기.
 * 종일은 end exclusive 이므로 표시용 종료일은 -1일.
 */
function formatSchedulePeriod(startAt: string, endAt: string, allDay: boolean): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "기간 미정";

  if (allDay) {
    const displayEnd = new Date(end);
    displayEnd.setDate(displayEnd.getDate() - 1);
    if (sameLocalDay(start, displayEnd) || displayEnd < start) {
      return `종일 · ${formatScheduleDate(start)}`;
    }
    return `종일 · ${formatScheduleDate(start)} – ${formatScheduleDate(displayEnd)}`;
  }

  if (sameLocalDay(start, end)) {
    return `${formatScheduleDate(start)} ${formatScheduleClock(start)} – ${formatScheduleClock(end)}`;
  }
  return `${formatScheduleDate(start)} ${formatScheduleClock(start)} – ${formatScheduleDate(end)} ${formatScheduleClock(end)}`;
}

/** 캘린더 일정 조회 카드 (/calendar) */
function ScheduleCardView({ card }: { card: ScheduleCard }): JSX.Element {
  const noticeText =
    card.notice === "added"
      ? "일정에 추가되었습니다."
      : card.notice === "removed"
        ? "일정에 삭제되었습니다."
        : null;

  return (
    <div className={`card schedule-card ${card.notice ? `notice-${card.notice}` : ""}`}>
      <div className="card-header">
        <span className="card-badge schedule">CALENDAR</span>
        <span className="card-status">{noticeText ?? card.label}</span>
      </div>
      {noticeText && <div className="schedule-notice">{noticeText}</div>}
      {card.events.length === 0 ? (
        <div className="card-title">등록된 일정이 없습니다.</div>
      ) : (
        <ul className="schedule-list">
          {card.events.map((ev) => (
            <li key={ev.id} className="schedule-list-item">
              <div className="schedule-item-title">{ev.title}</div>
              <div className="schedule-item-meta">
                <span className="schedule-item-period">
                  기간: {formatSchedulePeriod(ev.startAt, ev.endAt, ev.allDay)}
                </span>
                {ev.location && <span>📍 {ev.location}</span>}
                <span>작성: {ev.creatorName}</span>
                {ev.attendeeNames.length > 0 && (
                  <span>참여: {ev.attendeeNames.join(", ")}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
