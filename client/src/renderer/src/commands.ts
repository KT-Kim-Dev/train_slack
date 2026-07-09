/**
 * 채팅 입력에서 슬래시 명령어 / @ai 멘션을 파싱한다 (FR-28, FR-35, FR-36, FR-40, FR-43).
 * 외부 Slack Slash Command 를 쓰지 않고 자체 클라이언트 내 명령어로 처리한다.
 */

import type { PublicUser, RoomType } from "@intra-chat/shared";
import { extractLeadingMentions } from "./utils/mentions";

export type ParsedCommand =
  | { type: "text"; text: string; mentionUserIds?: number[] }
  | { type: "ai"; text: string }
  | { type: "issue-view"; issueId: string }
  | { type: "issue-create" }
  | { type: "build-run"; project: string }
  | { type: "build-status"; project: string }
  | { type: "calendar"; date: string }
  | { type: "rag-list" }
  | { type: "earthquake" }
  | { type: "mass-earthquake" }
  | { type: "targeted-earthquake"; targetUserIds: number[] }
  | { type: "error"; message: string };

export type ParsedInput = ParsedCommand;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `/calendar` 인자 → YYYY-MM-DD (로컬) */
export function resolveCalendarDateArg(arg: string | undefined): string | { error: string } {
  const today = new Date();
  const trimmed = (arg ?? "").trim();
  if (!trimmed || /^오늘$|^today$/i.test(trimmed)) {
    return toLocalYmd(today);
  }
  if (/^내일$|^tomorrow$/i.test(trimmed)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toLocalYmd(d);
  }
  if (/^어제$|^yesterday$/i.test(trimmed)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return toLocalYmd(d);
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const t = Date.parse(`${trimmed}T00:00:00`);
    if (Number.isNaN(t)) return { error: "날짜 형식이 올바르지 않습니다." };
    return trimmed;
  }

  // M/D 또는 M-D (올해)
  const md = trimmed.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { error: "날짜가 올바르지 않습니다." };
    }
    return `${today.getFullYear()}-${pad2(month)}-${pad2(day)}`;
  }

  return {
    error: "사용법: /calendar 또는 /일정 [오늘|내일|YYYY-MM-DD|M/D]",
  };
}

/** 로컬 날짜 하루의 UTC ISO 범위 */
export function localDayRangeIso(ymd: string): { from: string; to: string } {
  const start = new Date(`${ymd}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * @멘션 + 명령어/일반 메시지 파싱.
 * @김경태 /지진 → targeted-earthquake, @김경태 안녕 → mention text
 */
export function parseMessageInput(
  raw: string,
  mentionCandidates: PublicUser[],
  roomType: RoomType
): ParsedInput {
  const { mentions, rest } = extractLeadingMentions(raw, mentionCandidates);

  if (rest === "/지진") {
    if (mentions.length > 0) {
      return { type: "targeted-earthquake", targetUserIds: mentions.map((m) => m.id) };
    }
    if (roomType === "dm") return { type: "earthquake" };
    if (roomType === "group") return { type: "mass-earthquake" };
    if (roomType === "channel") {
      return { type: "error", message: "채널에서는 /전체지진 또는 @사용자 /지진 을 사용하세요." };
    }
    return { type: "error", message: "이 방에서는 /지진을 사용할 수 없습니다." };
  }

  if (rest === "/전체지진") {
    if (mentions.length > 0) {
      return { type: "error", message: "전체지진과 @멘션을 함께 사용할 수 없습니다." };
    }
    if (roomType === "channel" || roomType === "group") {
      return { type: "mass-earthquake" };
    }
    return { type: "error", message: "채널 또는 그룹채팅에서만 사용할 수 있습니다." };
  }

  if (mentions.length > 0 && !rest.startsWith("/")) {
    return {
      type: "text",
      text: raw.trim(),
      mentionUserIds: mentions.map((m) => m.id),
    };
  }

  if (mentions.length > 0) {
    return { type: "error", message: "@멘션 뒤에는 /지진 또는 일반 메시지만 입력할 수 있습니다." };
  }

  return parseCommand(raw);
}

export function parseCommand(raw: string): ParsedCommand {
  const input = raw.trim();

  // @ai 멘션 (문장 앞) → AI 질문
  const mention = input.match(/^@ai\s+([\s\S]+)/i);
  if (mention) return { type: "ai", text: mention[1].trim() };

  if (!input.startsWith("/")) return { type: "text", text: input };

  const [cmdRaw, ...rest] = input.slice(1).split(/\s+/);
  const cmd = cmdRaw.normalize("NFC");
  const cmdKey = cmd.toLowerCase();
  const argStr = input.slice(1 + cmdRaw.length).trim();

  switch (cmdKey) {
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

    case "calendar":
    case "cal":
    case "일정": {
      const resolved = resolveCalendarDateArg(argStr);
      if (typeof resolved === "object") return { type: "error", message: resolved.error };
      return { type: "calendar", date: resolved };
    }

    case "rag":
      if (argStr) return { type: "error", message: "사용법: /rag (RAG 폴더 파일 목록 조회)" };
      return { type: "rag-list" };

    case "지진":
      if (argStr) return { type: "error", message: "사용법: /지진" };
      return { type: "earthquake" };

    case "전체지진":
      if (argStr) return { type: "error", message: "사용법: /전체지진" };
      return { type: "mass-earthquake" };

    default:
      return { type: "error", message: `알 수 없는 명령어입니다: /${cmd}` };
  }
}

/** DM 입력창 안내 */
export const DM_COMMAND_HINTS = ["/지진", "@사용자"];

/** 그룹채팅 입력창 안내 */
export const GROUP_COMMAND_HINTS = ["/지진", "/전체지진", "@사용자 /지진"];

/** 채널 입력창 안내 */
export const CHANNEL_COMMAND_HINTS = ["/전체지진", "@사용자 /지진"];

/** AI 어시스턴트 방 입력창 안내 */
export const AI_COMMAND_HINTS = ["/rag"];

/** 입력창 하단 안내에 노출할 명령어 도움말 */
export const COMMAND_HINTS = [
  "/ai (질문)",
  "@ai (질문)",
  "/일정 [오늘|날짜]",
  "/calendar [오늘|날짜]",
];
