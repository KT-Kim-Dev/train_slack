import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import type { PublicUser } from "@intra-chat/shared";
import { uploadFiles } from "../api";
import {
  AI_COMMAND_HINTS,
  CHANNEL_COMMAND_HINTS,
  COMMAND_HINTS,
  DM_COMMAND_HINTS,
  GROUP_COMMAND_HINTS,
} from "../commands";
import { detectMentionQuery, filterMentionCandidates } from "../utils/mentions";

const TEXTAREA_MAX_HEIGHT = 320;
const TEXTAREA_MIN_HEIGHT = 44;

interface Props {
  roomId: number;
  isAiRoom: boolean;
  isDmRoom?: boolean;
  isChannelRoom?: boolean;
  isGroupRoom?: boolean;
  mentionUsers?: PublicUser[];
  onSubmit: (raw: string) => Promise<void>;
}

export function MessageInput({
  roomId,
  isAiRoom,
  isDmRoom = false,
  isChannelRoom = false,
  isGroupRoom = false,
  mentionUsers = [],
  onSubmit,
}: Props): JSX.Element {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionCandidates = useMemo(
    () => filterMentionCandidates(mentionUsers, mentionQuery).slice(0, 8),
    [mentionUsers, mentionQuery]
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.max(TEXTAREA_MIN_HEIGHT, Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  function updateMentionState(nextText: string, cursor: number): void {
    const detected = detectMentionQuery(nextText, cursor);
    if (!detected || isAiRoom || mentionUsers.length === 0) {
      setMentionOpen(false);
      return;
    }
    setMentionOpen(true);
    setMentionQuery(detected.query);
    setMentionStart(detected.start);
    setMentionIndex(0);
  }

  function insertMention(user: PublicUser): void {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const detected = detectMentionQuery(text, cursor);
    if (!detected) return;

    const before = text.slice(0, detected.start);
    const after = text.slice(cursor);
    const insert = `@${user.displayName} `;
    const next = `${before}${insert}${after}`;
    setText(next);
    setMentionOpen(false);

    requestAnimationFrame(() => {
      const pos = before.length + insert.length;
      el?.setSelectionRange(pos, pos);
      el?.focus();
    });
  }

  async function submitText(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setMentionOpen(false);
    try {
      await onSubmit(trimmed);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "전송 실패");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionOpen && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitText();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      const ext = item.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      imageFiles.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: item.type }));
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      void handleFiles(imageFiles);
    }
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    setUploadPercent(0);
    try {
      await uploadFiles(roomId, list, setUploadPercent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setUploadPercent(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={`message-input ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {isAiRoom && (
        <p className="ai-rag-hint">
          AI 어시스턴트에 txt, md, doc 파일을 업로드하면 RAG 시스템에 반영됩니다.
        </p>
      )}

      {uploadPercent !== null && (
        <div className="upload-progress">
          <div className="upload-bar" style={{ width: `${uploadPercent}%` }} />
          <span className="upload-label">업로드 중... {uploadPercent}%</span>
        </div>
      )}
      {error && <div className="input-error">{error}</div>}
      {dragging && (
        <div className="drop-hint">
          {isAiRoom ? "txt, md, doc 파일을 여기에 놓아 RAG에 반영" : "여기에 파일을 놓아 전송"}
        </div>
      )}

      <div className="input-row">
        <button
          className="attach-btn"
          title="파일 첨부"
          onClick={() => fileInputRef.current?.click()}
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={isAiRoom ? ".txt,.md,.markdown,.doc,.docx,text/plain,text/markdown" : undefined}
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
        <div className="textarea-wrap">
          {mentionOpen && mentionCandidates.length > 0 && (
            <ul className="mention-picker" role="listbox">
              {mentionCandidates.map((user, index) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className={`mention-picker-item ${index === mentionIndex ? "active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(user);
                    }}
                  >
                    <span className="mention-picker-name">{user.displayName}</span>
                    <span className="mention-picker-username">@{user.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={textareaRef}
            className="text-area code-friendly"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={(e) =>
              updateMentionState(text, (e.target as HTMLTextAreaElement).selectionStart ?? text.length)
            }
            onKeyUp={(e) =>
              updateMentionState(text, (e.target as HTMLTextAreaElement).selectionStart ?? text.length)
            }
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isAiRoom
                ? "AI에게 질문하세요 (Enter: 전송, Shift+Enter: 줄바꿈)"
                : "메시지, @멘션, 명령어 (Enter: 전송, Shift+Enter: 줄바꿈)"
            }
            rows={1}
          />
        </div>
        <button className="send-btn" onClick={submitText} disabled={sending || !text.trim()}>
          전송
        </button>
      </div>
      {isAiRoom ? (
        <div className="command-hints">명령어: {AI_COMMAND_HINTS.join("  ·  ")}</div>
      ) : isDmRoom ? (
        <div className="command-hints">
          명령어: {DM_COMMAND_HINTS.join("  ·  ")}  ·  {COMMAND_HINTS.join("  ·  ")}
        </div>
      ) : isGroupRoom ? (
        <div className="command-hints">
          명령어: {GROUP_COMMAND_HINTS.join("  ·  ")}  ·  {COMMAND_HINTS.join("  ·  ")}
        </div>
      ) : isChannelRoom ? (
        <div className="command-hints">
          명령어: {CHANNEL_COMMAND_HINTS.join("  ·  ")}  ·  {COMMAND_HINTS.join("  ·  ")}
        </div>
      ) : (
        <div className="command-hints">명령어: {COMMAND_HINTS.join("  ·  ")}</div>
      )}
    </div>
  );
}
