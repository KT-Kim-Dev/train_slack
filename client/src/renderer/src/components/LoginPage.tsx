import { useState, type FormEvent } from "react";
import type { PublicUser } from "@intra-chat/shared";
import { login, saveSession } from "../api";

interface Props {
  onLoggedIn: (user: PublicUser) => void;
}

export function LoginPage({ onLoggedIn }: Props): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(username.trim(), password);
      saveSession(res);
      onLoggedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-logo">Intra-Chat</h1>
        <p className="login-subtitle">사내 인트라넷 메신저</p>

        <label className="field">
          <span>아이디</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            placeholder="발급받은 아이디"
          />
        </label>

        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="btn-primary" type="submit" disabled={loading || !username || !password}>
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
