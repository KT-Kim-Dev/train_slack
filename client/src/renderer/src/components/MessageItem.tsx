import { useState } from "react";
import type { Message } from "@intra-chat/shared";
import { fileUrl } from "../api";

interface Props {
  message: Message;
  isMine: boolean;
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

export function MessageItem({ message, isMine, onImageClick }: Props): JSX.Element {
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

  return (
    <div className={`message ${isMine ? "mine" : ""}`}>
      <div className="message-avatar">{message.senderName?.[0] ?? "?"}</div>
      <div className="message-body">
        <div className="message-meta">
          <span className="message-sender">{message.senderName}</span>
          <span className="message-time">{formatTime(message.createdAt)}</span>
        </div>

        {message.messageType === "text" && (
          <div className="message-text">{message.content}</div>
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
