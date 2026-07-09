import type { PublicUser } from "@intra-chat/shared";

/** @토큰으로 사용자 매칭 (표시 이름 · username) */
export function resolveMentionToken(token: string, users: PublicUser[]): PublicUser | undefined {
  const key = token.normalize("NFC");
  return (
    users.find((u) => u.displayName.normalize("NFC") === key) ??
    users.find((u) => u.username.toLowerCase() === key.toLowerCase())
  );
}

/** 입력 앞쪽의 연속 @멘션 추출 */
export function extractLeadingMentions(
  raw: string,
  users: PublicUser[]
): { mentions: PublicUser[]; rest: string } {
  const mentions: PublicUser[] = [];
  let text = raw.trim();

  while (text.startsWith("@")) {
    const match = text.match(/^@([^\s@]+)\s*/);
    if (!match) break;
    const user = resolveMentionToken(match[1], users);
    if (!user || mentions.some((m) => m.id === user.id)) break;
    mentions.push(user);
    text = text.slice(match[0].length);
  }

  return { mentions, rest: text.trim() };
}

/** @멘션 자동완성 후보 필터 */
export function filterMentionCandidates(users: PublicUser[], query: string): PublicUser[] {
  const q = query.normalize("NFC").toLowerCase();
  if (!q) return users;
  return users.filter(
    (u) =>
      u.displayName.normalize("NFC").toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q)
  );
}

/** 커서 앞 @쿼리 감지 */
export function detectMentionQuery(
  text: string,
  cursor: number
): { query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[\s])@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2];
  const start = before.length - query.length - 1;
  return { query, start };
}
