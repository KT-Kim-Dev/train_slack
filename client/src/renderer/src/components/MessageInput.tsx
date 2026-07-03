import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { uploadFiles } from "../api";

interface Props {
  roomId: number;
  onSendText: (text: string) => Promise<void>;
}

export function MessageInput({ roomId, onSendText }: Props): JSX.Element {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submitText(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSendText(trimmed);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "전송 실패");
    } finally {
      setSending(false);
    }
  }

  // Enter=전송, Shift+Enter=줄바꿈 (FR-15)
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitText();
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
      {uploadPercent !== null && (
        <div className="upload-progress">
          <div className="upload-bar" style={{ width: `${uploadPercent}%` }} />
          <span className="upload-label">업로드 중... {uploadPercent}%</span>
        </div>
      )}
      {error && <div className="input-error">{error}</div>}
      {dragging && <div className="drop-hint">여기에 파일을 놓아 전송</div>}

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
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
        <textarea
          className="text-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요 (Enter: 전송, Shift+Enter: 줄바꿈)"
          rows={1}
        />
        <button className="send-btn" onClick={submitText} disabled={sending || !text.trim()}>
          전송
        </button>
      </div>
    </div>
  );
}
