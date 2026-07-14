import { useEffect, useRef, useState } from "react";
import type { EmojiItem } from "@intra-chat/shared";
import { emojiAssetUrl, fetchEmojis, uploadEmoji } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: EmojiItem) => void;
}

export function EmojiPicker({ open, onClose, onSelect }: Props): JSX.Element | null {
  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void fetchEmojis()
      .then(setEmojis)
      .catch((err) => setError(err instanceof Error ? err.message : "이모티콘을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent): void {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, onClose]);

  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadEmoji(file);
      setEmojis((prev) => [...prev.filter((e) => e.id !== uploaded.id), uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  if (!open) return null;

  return (
    <div className="emoji-picker" ref={panelRef} role="dialog" aria-label="이모티콘 선택">
      <div className="emoji-picker-header">
        <span>이모티콘</span>
        <button
          type="button"
          className="emoji-picker-upload"
          disabled={uploading}
          onClick={() => uploadRef.current?.click()}
        >
          {uploading ? "업로드 중…" : "+ 추가"}
        </button>
        <input
          ref={uploadRef}
          type="file"
          hidden
          accept="image/gif,image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
      </div>
      {error && <div className="emoji-picker-error">{error}</div>}
      {loading ? (
        <div className="emoji-picker-loading">불러오는 중…</div>
      ) : emojis.length === 0 ? (
        <div className="emoji-picker-empty">등록된 이모티콘이 없습니다.</div>
      ) : (
        <div className="emoji-picker-grid">
          {emojis.map((emoji) => (
            <button
              key={emoji.id}
              type="button"
              className="emoji-picker-item"
              title={emoji.fileName}
              onClick={() => {
                onSelect(emoji);
                onClose();
              }}
            >
              <img src={emojiAssetUrl(emoji.url)} alt={emoji.fileName} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
