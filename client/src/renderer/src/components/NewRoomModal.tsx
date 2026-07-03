import { useState } from "react";
import type { PublicUser, Room } from "@intra-chat/shared";
import { createChannel, createGroup } from "../api";

interface Props {
  type: "channel" | "group";
  users: PublicUser[];
  onClose: () => void;
  onCreated: (room: Room) => void | Promise<void>;
}

export function NewRoomModal({ type, users, onClose, onCreated }: Props): JSX.Element {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isGroup = type === "group";
  const title = isGroup ? "새 그룹채팅" : "새 채널";

  function toggle(userId: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    if (isGroup && selected.size < 2) {
      setError("그룹채팅은 본인 외 2명 이상을 초대해야 합니다.");
      return;
    }
    setSubmitting(true);
    try {
      const memberIds = [...selected];
      const room = isGroup
        ? await createGroup(name.trim(), memberIds)
        : await createChannel(name.trim(), memberIds);
      await onCreated(room);
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성에 실패했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>

        <label className="field">
          <span>{isGroup ? "그룹 이름" : "채널 이름"}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder={isGroup ? "예: 3분기 TF" : "예: 공지사항"}
          />
        </label>

        <div className="field">
          <span>초대할 인원 {isGroup && "(2명 이상)"}</span>
          <ul className="user-select-list">
            {users.map((u) => (
              <li key={u.id}>
                <label className="user-select-item">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                  />
                  <span className={`presence-dot ${u.isOnline ? "online" : ""}`} />
                  {u.displayName}
                </label>
              </li>
            ))}
            {users.length === 0 && <li className="hint">초대할 다른 사용자가 없습니다.</li>}
          </ul>
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "생성 중..." : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}
