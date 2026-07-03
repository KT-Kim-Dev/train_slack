import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, PublicUser, Room } from "@intra-chat/shared";
import { fetchMessages, markRoomRead } from "../api";
import { sendMessage } from "../socket";
import { MessageItem } from "./MessageItem";
import { MessageInput } from "./MessageInput";
import { ImageLightbox } from "./ImageLightbox";

interface Props {
  room: Room;
  currentUser: PublicUser;
  registerActiveHandler: (handler: ((msg: Message) => void) | null) => void;
}

export function ChatRoom({ room, currentUser, registerActiveHandler }: Props): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // 하단 근처에 있을 때만 새 메시지 도착 시 자동 스크롤
  const nearBottomRef = useRef(true);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  // 실시간 수신 핸들러 등록 (활성 방일 때 ChatPage 가 호출)
  useEffect(() => {
    registerActiveHandler(appendMessage);
    return () => registerActiveHandler(null);
  }, [registerActiveHandler, appendMessage]);

  // 방 변경 시 초기 히스토리 로딩 (FR-13)
  useEffect(() => {
    let cancelled = false;
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

  // 새 메시지 도착 시 하단이면 자동 스크롤
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

    // 위로 스크롤 시 이전 메시지 추가 로딩 (페이지네이션)
    if (el.scrollTop < 60 && hasMore && !loadingOlder && nextCursor) {
      setLoadingOlder(true);
      const prevHeight = el.scrollHeight;
      try {
        const page = await fetchMessages(room.id, nextCursor);
        setMessages((prev) => [...page.messages, ...prev]);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        // 스크롤 위치 보정 (새로 추가된 높이만큼)
        requestAnimationFrame(() => {
          const newEl = scrollRef.current;
          if (newEl) newEl.scrollTop = newEl.scrollHeight - prevHeight;
        });
      } finally {
        setLoadingOlder(false);
      }
    }
  }

  async function handleSendText(text: string): Promise<void> {
    // 서버 브로드캐스트(message:new)로 목록에 반영되므로 여기서는 전송만 수행
    await sendMessage(room.id, text);
    nearBottomRef.current = true;
  }

  const roomTitle =
    room.type === "channel" ? `# ${room.name}` : room.type === "group" ? `◆ ${room.name}` : `@ 대화`;

  return (
    <section className="chat-room">
      <header className="chat-room-header">
        <span className="chat-room-title">{roomTitle}</span>
      </header>

      <div className="messages" ref={scrollRef} onScroll={handleScroll}>
        {loadingOlder && <div className="loading-older">이전 메시지 불러오는 중...</div>}
        {!hasMore && messages.length > 0 && (
          <div className="history-start">— 대화의 시작입니다 —</div>
        )}
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isMine={m.senderId === currentUser.id}
            onImageClick={setLightboxUrl}
          />
        ))}
        {messages.length === 0 && (
          <div className="empty-messages">아직 메시지가 없습니다. 첫 메시지를 보내보세요!</div>
        )}
      </div>

      <MessageInput roomId={room.id} onSendText={handleSendText} />

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </section>
  );
}
