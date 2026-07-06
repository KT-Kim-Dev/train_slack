import type { PublicUser } from "@intra-chat/shared";

/** 온라인 사용자를 상단에, 같은 그룹 내에서는 표시 이름 순 */
export function sortUsers(users: PublicUser[]): PublicUser[] {
  return [...users].sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, "ko");
  });
}
