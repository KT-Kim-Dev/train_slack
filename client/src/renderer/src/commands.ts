/**
 * 채팅 입력에서 슬래시 명령어 / @ai 멘션을 파싱한다 (FR-28, FR-35, FR-36, FR-40, FR-43).
 * 외부 Slack Slash Command 를 쓰지 않고 자체 클라이언트 내 명령어로 처리한다.
 */

export type ParsedCommand =
  | { type: "text"; text: string }
  | { type: "ai"; text: string }
  | { type: "issue-view"; issueId: string }
  | { type: "issue-create" }
  | { type: "build-run"; project: string }
  | { type: "build-status"; project: string }
  | { type: "error"; message: string };

export function parseCommand(raw: string): ParsedCommand {
  const input = raw.trim();

  // @ai 멘션 (문장 앞) → AI 질문
  const mention = input.match(/^@ai\s+([\s\S]+)/i);
  if (mention) return { type: "ai", text: mention[1].trim() };

  if (!input.startsWith("/")) return { type: "text", text: input };

  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const argStr = input.slice(1 + cmd.length).trim();

  switch (cmd.toLowerCase()) {
    case "ai":
      if (!argStr) return { type: "error", message: "사용법: /ai (질문 내용)" };
      return { type: "ai", text: argStr };

    case "issue":
      if (rest[0]?.toLowerCase() === "create") return { type: "issue-create" };
      if (!rest[0]) return { type: "error", message: "사용법: /issue (이슈번호) 또는 /issue create" };
      return { type: "issue-view", issueId: rest[0] };

    case "build":
      if (rest[0]?.toLowerCase() === "status") {
        const project = rest.slice(1).join(" ").trim();
        if (!project) return { type: "error", message: "사용법: /build status (프로젝트명)" };
        return { type: "build-status", project };
      }
      if (!argStr) return { type: "error", message: "사용법: /build (프로젝트명)" };
      return { type: "build-run", project: argStr };

    default:
      return { type: "error", message: `알 수 없는 명령어입니다: /${cmd}` };
  }
}

/** 입력창 하단 안내에 노출할 명령어 도움말 */
export const COMMAND_HINTS = [
  "/ai (질문)",
  "@ai (질문)",
  "/issue (번호)",
  "/issue create",
  "/build (프로젝트)",
  "/build status (프로젝트)",
];
