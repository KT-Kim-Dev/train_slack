import { useEffect, useState } from "react";
import type { PublicUser, Room } from "@intra-chat/shared";
import { addRoomMembers, fetchRoomMembers } from "../api";
import { UserAvatar } from "./UserAvatar";

interface Props {
  room: Room;
  allUsers: PublicUser[];
  currentUserId: number;
  initialShowAdd?: boolean;
  onClose: () => void;
  onMembersChanged?: () => void;
}

function presenceLabel(user: PublicUser): string {
  if (!user.isOnline) return "오프라인";
  return user.presenceStatus === "busy" ? "바쁨" : user.presenceStatus === "away" ? "자리 비움" : "대화 가능";
}

export function GroupMembersModal({
  room,
  allUsers,
  currentUserId,
  initialShowAdd = false,
  onClose,
  onMembersChanged,
}: Props): JSX.Element {
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(initialShowAdd);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMembers(): Promise<void> {
    setLoading(true);
    try {
      setMembers(await fetchRoomMembers(room.id));
    } catch {
      setError("멤버 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, [room.id]);

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = allUsers.filter((u) => u.id !== currentUserId && !memberIds.has(u.id));

  async function handleAdd(): Promise<void> {
    if (selected.size === 0) return;
    setAdding(true);
    setError(null);
    try {
      await addRoomMembers(room.id, [...selected]);
      setSelected(new Set());
      setShowAdd(false);
      await loadMembers();
      await onMembersChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "멤버 추가에 실패했습니다.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal group-members-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>◆ {room.name} 멤버</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {loading && <div className="settings-loading">불러오는 중...</div>}

        {!loading && !showAdd && (
          <ul className="group-member-list">
            {members.map((m) => (
              <li key={m.id} className="group-member-item">
                <UserAvatar user={m} size={32} />
                <span className="group-member-meta">
                  <span className="group-member-name">{m.displayName}</span>
                  <span className="group-member-status">{presenceLabel(m)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {showAdd && (
          <div className="group-add-panel">
            <p className="settings-desc">추가할 멤버를 선택하세요.</p>
            <ul className="group-member-pick-list">
              {candidates.map((u) => (
                <li key={u.id}>
                  <label className="member-pick-row">
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          return next;
                        });
                      }}
                    />
                    <UserAvatar user={u} size={28} />
                    <span>{u.displayName}</span>
                  </label>
                </li>
              ))}
              {candidates.length === 0 && (
                <li className="settings-desc">추가할 수 있는 멤버가 없습니다.</li>
              )}
            </ul>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>
                취소
              </button>
              <button
                className="btn-primary"
                disabled={adding || selected.size === 0}
                onClick={() => void handleAdd()}
              >
                {adding ? "추가 중..." : `${selected.size}명 추가`}
              </button>
            </div>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {!showAdd && (
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowAdd(true)}>
              + 멤버 추가
            </button>
            <button className="btn-secondary" onClick={onClose}>
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
