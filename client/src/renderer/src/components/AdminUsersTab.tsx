import { useCallback, useEffect, useState } from "react";
import type { AdminUserView } from "@intra-chat/shared";
import {
  activateAdminUser,
  createAdminUser,
  deactivateAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
} from "../api";

interface Props {
  currentUserId: number;
}

export function AdminUsersTab({ currentUserId }: Props): JSX.Element {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await fetchAdminUsers());
      setError(null);
    } catch {
      setError("사용자 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate(): Promise<void> {
    if (!username.trim() || !password || !displayName.trim()) {
      setError("아이디, 비밀번호, 표시 이름을 모두 입력하세요.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createAdminUser({ username: username.trim(), password, displayName: displayName.trim() });
      setUsername("");
      setPassword("");
      setDisplayName("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "계정 생성에 실패했습니다.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeactivate(user: AdminUserView): Promise<void> {
    if (!confirm(`'${user.displayName}' 계정을 비활성화하시겠습니까?`)) return;
    try {
      await deactivateAdminUser(user.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "비활성화에 실패했습니다.");
    }
  }

  async function handleActivate(user: AdminUserView): Promise<void> {
    try {
      await activateAdminUser(user.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "활성화에 실패했습니다.");
    }
  }

  async function handleDelete(user: AdminUserView): Promise<void> {
    if (
      !confirm(
        `'${user.displayName}' (${user.username}) 계정을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`
      )
    ) {
      return;
    }
    try {
      await deleteAdminUser(user.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  return (
    <>
      <p className="settings-desc">
        사내 계정을 생성·비활성화·삭제합니다. 비활성화는 로그인 차단, 삭제는 DB에서 영구 제거입니다.
      </p>

      <div className="admin-user-create">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="아이디" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
        />
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="표시 이름"
        />
        <button className="btn-primary" disabled={creating} onClick={() => void handleCreate()}>
          {creating ? "생성 중..." : "계정 생성"}
        </button>
      </div>

      {loading && <div className="settings-loading">불러오는 중...</div>}

      {!loading && (
        <table className="admin-user-table">
          <thead>
            <tr>
              <th>표시 이름</th>
              <th>아이디</th>
              <th>상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "inactive-row"}>
                <td>{u.displayName}</td>
                <td>{u.username}</td>
                <td>{u.isActive ? (u.isOnline ? "활성·온라인" : "활성·오프라인") : "비활성"}</td>
                <td className="admin-user-actions">
                  {u.isActive ? (
                    <button
                      className="btn-secondary btn-sm"
                      disabled={u.id === currentUserId}
                      onClick={() => void handleDeactivate(u)}
                    >
                      비활성화
                    </button>
                  ) : (
                    <button className="btn-secondary btn-sm" onClick={() => void handleActivate(u)}>
                      활성화
                    </button>
                  )}
                  <button
                    className="btn-danger btn-sm"
                    disabled={u.id === currentUserId}
                    onClick={() => void handleDelete(u)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <div className="form-error">{error}</div>}
    </>
  );
}
