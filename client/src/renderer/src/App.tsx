import { useEffect, useState } from "react";
import type { PublicUser } from "@intra-chat/shared";
import { LoginPage } from "./components/LoginPage";
import { ChatPage } from "./components/ChatPage";
import { clearSession, getStoredUser, getToken } from "./api";

export function App(): JSX.Element {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [booting, setBooting] = useState(true);

  // 자동 로그인 (FR-05): 저장된 토큰이 있으면 세션 복원 시도
  useEffect(() => {
    const token = getToken();
    const stored = getStoredUser();
    if (token && stored) {
      setUser(stored);
    }
    setBooting(false);
  }, []);

  function handleLoggedIn(loggedInUser: PublicUser): void {
    setUser(loggedInUser);
  }

  function handleLogout(): void {
    clearSession();
    setUser(null);
  }

  if (booting) {
    return <div className="center-screen">불러오는 중...</div>;
  }

  return user ? (
    <ChatPage currentUser={user} onLogout={handleLogout} />
  ) : (
    <LoginPage onLoggedIn={handleLoggedIn} />
  );
}
