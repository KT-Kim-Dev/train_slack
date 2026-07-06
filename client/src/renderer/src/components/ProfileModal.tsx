import { useRef, useState } from "react";
import type { PublicUser, UserPresenceStatus } from "@intra-chat/shared";
import { PRESENCE_STATUS_LABELS } from "@intra-chat/shared";
import { updateMyStatus, uploadAvatar } from "../api";
import { UserAvatar } from "./UserAvatar";

const STATUS_OPTIONS: UserPresenceStatus[] = ["available", "busy", "away"];

interface Props {
  user: PublicUser;
  onClose: () => void;
  onUpdated: (user: PublicUser) => void;
}

export function ProfileModal({ user, onClose, onUpdated }: Props): JSX.Element {
  const [current, setCurrent] = useState(user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarBust, setAvatarBust] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleStatusChange(status: UserPresenceStatus): Promise<void> {
    if (status === current.presenceStatus || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateMyStatus(status);
      setCurrent(updated);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "상태 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAvatarSelected(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadAvatar(file);
      setCurrent(updated);
      setAvatarBust(Date.now());
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 업로드에 실패했습니다.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>내 프로필</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="profile-avatar-row">
          <UserAvatar user={current} size={72} cacheBust={avatarBust} />
          <div>
            <div className="profile-name">{current.displayName}</div>
            <div className="profile-username">@{current.username}</div>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              프로필 사진 변경
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              hidden
              onChange={(e) => void handleAvatarSelected(e.target.files?.[0])}
            />
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-title">내 상태</div>
          <div className="status-options">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                className={`status-option status-${status} ${
                  current.presenceStatus === status ? "active" : ""
                }`}
                disabled={busy}
                onClick={() => void handleStatusChange(status)}
              >
                <span className={`presence-dot ${status}`} />
                {PRESENCE_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
      </div>
    </div>
  );
}
