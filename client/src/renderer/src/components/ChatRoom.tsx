import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiDeltaEvent, IntegrationsInfo, Message, PublicUser, Room } from "@intra-chat/shared";
import { fetchBuildStatus, fetchIntegrations, fetchIssue, fetchMessages, fetchMonthScheduleForRoom, fetchRagFileList, fetchRoomMembers, fetchScheduleForRoom, markRoomRead } from "../api";
import { askAi, sendEarthquake, sendMassEarthquake, sendMessage, sendTargetedEarthquake } from "../socket";
import { localDayRangeIso, parseMessageInput } from "../commands";
import { buildAiFlowMap } from "../utils/aiMessageFlow";
import { MessageItem } from "./MessageItem";
import { MessageInput } from "./MessageInput";
import { GroupMembersModal } from "./GroupMembersModal";
import { ImageLightbox } from "./ImageLightbox";
import { IssueCreateModal } from "./IssueCreateModal";
import { BuildConfirmModal } from "./BuildConfirmModal";
import type { ActiveRoomHandlers } from "./ChatPage";

interface Props {
  room: Room;
  currentUser: PublicUser;
  users: PublicUser[];
  integrations: IntegrationsInfo | null;
  registerActiveHandler: (handlers: ActiveRoomHandlers | null) => void;
}

export function ChatRoom({ room, currentUser, users, integrations, registerActiveHandler }: Props): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    fileName: string;
    fileSize: number | null;
    allowDownload?: boolean;
  } | null>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [buildToConfirm, setBuildToConfirm] = useState<string | null>(null);
  const [streamingAiIds, setStreamingAiIds] = useState<Set<number>>(() => new Set());

  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [groupMembersAddMode, setGroupMembersAddMode] = useState(false);
  const [mentionUsers, setMentionUsers] = useState<PublicUser[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipAutoScrollRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    if (msg.messageType === "ai_response" && !msg.content) {
      setStreamingAiIds((prev) => new Set(prev).add(msg.id));
    }
  }, []);

  // AI 스트리밍 델타로 해당 메시지 내용을 갱신 (FR-30)
  const handleAiDelta = useCallback((payload: AiDeltaEvent) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== payload.messageId) return m;
        if (payload.done) {
          // 오류 완료면 델타(오류문구)로 대체, 정상 완료면 누적분 유지
          return payload.error ? { ...m, content: payload.delta } : m;
        }
        return { ...m, content: (m.content ?? "") + payload.delta };
      })
    );
    setStreamingAiIds((prev) => {
      const next = new Set(prev);
      if (payload.done) next.delete(payload.messageId);
      else next.add(payload.messageId);
      return next;
    });
    if (skipAutoScrollRef.current) return;
    requestAnimationFrame(() => scrollToBottom("smooth"));
  }, [scrollToBottom]);

  useEffect(() => {
    registerActiveHandler({ onMessage: appendMessage, onAiDelta: handleAiDelta });
    return () => registerActiveHandler(null);
  }, [registerActiveHandler, appendMessage, handleAiDelta]);

  useEffect(() => {
    let cancelled = false;
    setStreamingAiIds(new Set());
    setReplyTo(null);
    skipAutoScrollRef.current = false;
    void (async () => {
      const page = await fetchMessages(room.id);
      if (cancelled) return;
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToBottom("auto"));
      });
      const last = page.messages[page.messages.length - 1];
      if (last) void markRoomRead(room.id, last.id).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [room.id, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (room.type === "ai") {
        setMentionUsers([]);
        return;
      }
      if (room.type === "dm") {
        const others = users.filter((u) => u.id !== currentUser.id);
        if (!cancelled) setMentionUsers(others);
        return;
      }
      try {
        const members = await fetchRoomMembers(room.id);
        if (!cancelled) setMentionUsers(members.filter((u) => u.id !== currentUser.id));
      } catch {
        if (!cancelled) setMentionUsers(users.filter((u) => u.id !== currentUser.id));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room.id, room.type, users, currentUser.id]);

  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages, scrollToBottom]);

  async function handleScroll(): Promise<void> {
    const el = scrollRef.current;
    if (!el) return;

    if (el.scrollTop < 60 && hasMore && !loadingOlder && nextCursor) {
      setLoadingOlder(true);
      skipAutoScrollRef.current = true;
      const prevHeight = el.scrollHeight;
      try {
        const page = await fetchMessages(room.id, nextCursor);
        setMessages((prev) => [...page.messages, ...prev]);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        requestAnimationFrame(() => {
          const newEl = scrollRef.current;
          if (newEl) newEl.scrollTop = newEl.scrollHeight - prevHeight;
        });
      } finally {
        setLoadingOlder(false);
      }
    }
  }

  /**
   * 입력 전송 처리: 명령어를 파싱해 채팅/AI/Yona/Jenkins 로 라우팅한다.
   * 오류는 throw 하여 입력창에 표시된다.
   */
  async function handleSubmit(raw: string, replyToMessageId?: number): Promise<void> {
    skipAutoScrollRef.current = false;
    const parsed = parseMessageInput(raw, mentionUsers, room.type);

    // AI 전용 채팅방에서는 일반 텍스트도 AI 질문으로 처리
    if (parsed.type === "text" && room.type === "ai") {
      await ensureAiEnabled();
      await askAi(room.id, parsed.text);
      return;
    }

    switch (parsed.type) {
      case "text":
        await sendMessage(room.id, parsed.text, parsed.mentionUserIds, replyToMessageId);
        setReplyTo(null);
        return;
      case "ai":
        await ensureAiEnabled();
        await askAi(room.id, parsed.text);
        return;
      case "issue-view":
        ensureEnabled("yona", "Yona");
        await fetchIssue(parsed.issueId, room.id);
        return;
      case "issue-create":
        ensureEnabled("yona", "Yona");
        setShowIssueModal(true);
        return;
      case "build-status":
        ensureEnabled("jenkins", "Jenkins");
        await fetchBuildStatus(parsed.project, room.id);
        return;
      case "build-run":
        ensureEnabled("jenkins", "Jenkins");
        setBuildToConfirm(parsed.project); // FR-44: 실행 전 확인 모달
        return;
      case "calendar": {
        const { from, to } = localDayRangeIso(parsed.date);
        await fetchScheduleForRoom({
          roomId: room.id,
          date: parsed.date,
          from,
          to,
          scope: "all",
        });
        return;
      }
      case "month-schedule":
        await fetchMonthScheduleForRoom({
          roomId: room.id,
          scope: "all",
        });
        return;
      case "rag-list":
        await fetchRagFileList(room.id);
        return;
      case "earthquake":
        if (room.type !== "dm") {
          throw new Error("다이렉트 메시지에서만 사용할 수 있습니다.");
        }
        await sendEarthquake(room.id);
        return;
      case "mass-earthquake":
        if (room.type !== "channel" && room.type !== "group") {
          throw new Error("채널 또는 그룹채팅에서만 사용할 수 있습니다.");
        }
        await sendMassEarthquake(room.id);
        return;
      case "targeted-earthquake":
        await sendTargetedEarthquake(room.id, parsed.targetUserIds);
        return;
      case "error":
        throw new Error(parsed.message);
    }
  }

  function ensureEnabled(key: "yona" | "jenkins", label: string): void {
    if (integrations && !integrations[key].enabled) {
      throw new Error(`${label} 연동이 비활성화되어 있습니다. 서버 관리자에게 문의하세요.`);
    }
  }
  async function ensureAiEnabled(): Promise<void> {
    const info = await fetchIntegrations();
    if (!info.ai.enabled) {
      throw new Error("AI 기능이 비활성화되어 있습니다. 관리자 설정에서 Ollama URL을 입력해 주세요.");
    }
  }

  const roomTitle =
    room.type === "channel"
      ? `# ${room.name}`
      : room.type === "group"
        ? `◆ ${room.name}`
        : room.type === "ai"
          ? "🤖 AI 어시스턴트"
          : "@ 대화";

  const aiFlowMap = useMemo(
    () => buildAiFlowMap(messages, room.type === "ai"),
    [messages, room.type]
  );

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  function resolveSenderUser(senderId: number): Pick<PublicUser, "id" | "displayName" | "profileImageUrl"> | undefined {
    return userById.get(senderId) ?? (senderId === currentUser.id ? currentUser : undefined);
  }

  return (
    <section className="chat-room">
      <header className="chat-room-header">
        <span className="chat-room-title">{roomTitle}</span>
        {room.type === "group" && (
          <div className="chat-room-header-actions">
            <button
              type="button"
              className="header-icon-btn"
              title="멤버 목록"
              onClick={() => {
                setGroupMembersAddMode(false);
                setShowGroupMembers(true);
              }}
            >
              👥
            </button>
            <button
              type="button"
              className="header-icon-btn"
              title="멤버 추가"
              onClick={() => {
                setGroupMembersAddMode(true);
                setShowGroupMembers(true);
              }}
            >
              +
            </button>
          </div>
        )}
      </header>

      <div className="messages" ref={scrollRef} onScroll={handleScroll}>
        {loadingOlder && <div className="loading-older">이전 메시지 불러오는 중...</div>}
        {!hasMore && messages.length > 0 && <div className="history-start">— 대화의 시작입니다 —</div>}
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isMine={m.senderId === currentUser.id}
            isAiStreaming={streamingAiIds.has(m.id)}
            aiFlowKind={aiFlowMap.get(m.id) ?? null}
            senderUser={resolveSenderUser(m.senderId)}
            onImageClick={setLightboxImage}
            onReply={(message) => setReplyTo(message)}
          />
        ))}
        {messages.length === 0 && (
          <div className="empty-messages">
            {room.type === "ai"
              ? "AI에게 무엇이든 물어보세요."
              : "아직 메시지가 없습니다. 첫 메시지를 보내보세요!"}
          </div>
        )}
      </div>

      <MessageInput
        roomId={room.id}
        isAiRoom={room.type === "ai"}
        isDmRoom={room.type === "dm"}
        isChannelRoom={room.type === "channel"}
        isGroupRoom={room.type === "group"}
        mentionUsers={mentionUsers}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSubmit={handleSubmit}
      />

      {lightboxImage && (
        <ImageLightbox
          url={lightboxImage.url}
          fileName={lightboxImage.fileName}
          fileSize={lightboxImage.fileSize}
          allowDownload={lightboxImage.allowDownload}
          onClose={() => setLightboxImage(null)}
        />
      )}
      {showIssueModal && (
        <IssueCreateModal
          roomId={room.id}
          onClose={() => setShowIssueModal(false)}
        />
      )}
      {buildToConfirm && (
        <BuildConfirmModal
          project={buildToConfirm}
          roomId={room.id}
          onClose={() => setBuildToConfirm(null)}
        />
      )}
      {showGroupMembers && (
        <GroupMembersModal
          room={room}
          allUsers={users}
          currentUserId={currentUser.id}
          initialShowAdd={groupMembersAddMode}
          onClose={() => setShowGroupMembers(false)}
        />
      )}
    </section>
  );
}
