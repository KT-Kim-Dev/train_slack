import { useEffect, useRef, useState } from "react";
import type { PublicUser, UserPresenceStatus, UserPreferences } from "@intra-chat/shared";
import { DEFAULT_USER_PREFERENCES, PRESENCE_STATUS_LABELS } from "@intra-chat/shared";
import { fetchMyPreferences, updateMyPreferences, updateMyStatus, uploadAvatar } from "../api";
import { AvatarCropModal } from "./AvatarCropModal";
import { UserAvatar } from "./UserAvatar";

const STATUS_OPTIONS: UserPresenceStatus[] = ["available", "busy", "away"];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

interface Props {
  user: PublicUser;
  onClose: () => void;
  onUpdated: (user: PublicUser) => void;
}

export function ProfileModal({ user, onClose, onUpdated }: Props): JSX.Element {
  const [current, setCurrent] = useState(user);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarBust, setAvatarBust] = useState(() => Date.now());
  const [cropSource, setCropSource] = useState<{ url: string; fileName: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchMyPreferences()
      .then(setPreferences)
      .catch(() => undefined);
  }, []);

  async function handleIgnoreEarthquakeChange(checked: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateMyPreferences({ ignoreEarthquake: checked });
      setPreferences(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "설정 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

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

  function handleAvatarSelected(file: File | undefined): void {
    if (!file || busy) return;
    setError(null);

    if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.type)) {
      setError("JPEG, PNG, GIF, WebP 이미지만 업로드할 수 있습니다.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("프로필 이미지는 5MB 이하여야 합니다.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setCropSource({ url: URL.createObjectURL(file), fileName: file.name });
    if (fileRef.current) fileRef.current.value = "";
  }

  function closeCrop(): void {
    if (cropSource) URL.revokeObjectURL(cropSource.url);
    setCropSource(null);
  }

  async function handleCroppedUpload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadAvatar(file);
      setCurrent(updated);
      setAvatarBust(Date.now());
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 업로드에 실패했습니다.");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
                onChange={(e) => handleAvatarSelected(e.target.files?.[0])}
              />
              <p className="profile-upload-hint">최대 5MB · 업로드 후 영역을 지정할 수 있습니다</p>
            </div>
          </div>

          <div className="profile-section">
            <div className="profile-section-title">내 설정</div>
            <label className="preference-toggle">
              <input
                type="checkbox"
                checked={preferences.ignoreEarthquake}
                disabled={busy}
                onChange={(e) => void handleIgnoreEarthquakeChange(e.target.checked)}
              />
              <span>지진 발생 무시</span>
            </label>
            <p className="profile-upload-hint">
              켜면 /지진·/전체지진 수신 시 창이 흔들리지 않고, 무시 메시지가 표시됩니다.
            </p>
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

      {cropSource && (
        <AvatarCropModal
          imageUrl={cropSource.url}
          fileName={cropSource.fileName}
          onClose={closeCrop}
          onConfirm={handleCroppedUpload}
        />
      )}
    </>
  );
}
