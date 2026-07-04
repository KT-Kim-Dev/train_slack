import { useCallback, useEffect, useRef, useState } from "react";
import type { AiDeltaEvent, IntegrationsInfo, Message, PublicUser, Room } from "@intra-chat/shared";
import { fetchBuildStatus, fetchIntegrations, fetchIssue, fetchMessages, markRoomRead } from "../api";
import { askAi, sendMessage } from "../socket";
import { parseCommand } from "../commands";
import { MessageItem } from "./MessageItem";
import { MessageInput } from "./MessageInput";
import { ImageLightbox } from "./ImageLightbox";
import { IssueCreateModal } from "./IssueCreateModal";
import { BuildConfirmModal } from "./BuildConfirmModal";
import type { ActiveRoomHandlers } from "./ChatPage";

interface Props {
  room: Room;
  currentUser: PublicUser;
  integrations: IntegrationsInfo | null;
  registerActiveHandler: (handlers: ActiveRoomHandlers | null) => void;
}

export function ChatRoom({ room, currentUser, integrations, registerActiveHandler }: Props): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [buildToConfirm, setBuildToConfirm] = useState<string | null>(null);
  const [streamingAiIds, setStreamingAiIds] = useState<Set<number>>(() => new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

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
    if (nearBottomRef.current) requestAnimationFrame(() => scrollToBottom("smooth"));
  }, []);

  useEffect(() => {
    registerActiveHandler({ onMessage: appendMessage, onAiDelta: handleAiDelta });
    return () => registerActiveHandler(null);
  }, [registerActiveHandler, appendMessage, handleAiDelta]);

  useEffect(() => {
    let cancelled = false;
    setStreamingAiIds(new Set());
    void (async () => {
      const page = await fetchMessages(room.id);
      if (cancelled) return;
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      requestAnimationFrame(() => scrollToBottom("auto"));
      const last = page.messages[page.messages.length - 1];
      if (last) void markRoomRead(room.id, last.id).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom("smooth");
  }, [messages]);

  function scrollToBottom(behavior: ScrollBehavior): void {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }

  async function handleScroll(): Promise<void> {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

    if (el.scrollTop < 60 && hasMore && !loadingOlder && nextCursor) {
      setLoadingOlder(true);
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
  async function handleSubmit(raw: string): Promise<void> {
    nearBottomRef.current = true;
    const parsed = parseCommand(raw);

    // AI 전용 채팅방에서는 일반 텍스트도 AI 질문으로 처리
    if (parsed.type === "text" && room.type === "ai") {
      await ensureAiEnabled();
      await askAi(room.id, parsed.text);
      return;
    }

    switch (parsed.type) {
      case "text":
        await sendMessage(room.id, parsed.text);
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

  return (
    <section className="chat-room">
      <header className="chat-room-header">
        <span className="chat-room-title">{roomTitle}</span>
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
            onImageClick={setLightboxUrl}
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
        onSubmit={handleSubmit}
      />

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
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
    </section>
  );
}
