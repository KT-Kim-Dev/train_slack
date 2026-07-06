import { useCallback, useEffect, useState } from "react";
import type { PublicUser } from "@intra-chat/shared";
import { LoginPage } from "./components/LoginPage";
import { ChatPage } from "./components/ChatPage";
import { clearSession, getStoredUser, getToken, updateStoredUser } from "./api";

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

  const handleLoggedIn = useCallback((loggedInUser: PublicUser): void => {
    setUser(loggedInUser);
  }, []);

  const handleLogout = useCallback((): void => {
    clearSession();
    setUser(null);
  }, []);

  const handleUserUpdated = useCallback((updated: PublicUser): void => {
    setUser(updated);
    updateStoredUser(updated);
  }, []);

  if (booting) {
    return <div className="center-screen">불러오는 중...</div>;
  }

  return user ? (
    <ChatPage currentUser={user} onLogout={handleLogout} onUserUpdated={handleUserUpdated} />
  ) : (
    <LoginPage onLoggedIn={handleLoggedIn} />
  );
}
