import { Router } from "express";
import type { IntegrationsInfo, RagFileInfo, Message } from "@intra-chat/shared";
import { requireAuth } from "../auth/middleware.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { config } from "../config.js";
import { insertTextMessage } from "../db/messages.js";
import { isMember, markRoomRead } from "../db/rooms.js";
import { getSettings } from "../db/settings.js";
import { listModels } from "../services/ollama.js";
import { formatRagFileListMessage, listRagFolderFiles } from "../services/rag.js";
import { broadcastMessage } from "../sockets/index.js";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

/** 클라이언트가 UI(명령어 안내/모델 선택 등)를 구성하기 위한 연동 활성화 정보 */
integrationsRouter.get("/", async (_req, res) => {
  const s = getSettings();
  const aiEnabled = !!s.ollama_url;
  const models = aiEnabled ? await listModels() : [];
  const info: IntegrationsInfo = {
    ai: {
      enabled: aiEnabled,
      models,
      defaultModel: aiEnabled ? s.ollama_model : null,
    },
    yona: { enabled: !!s.yona_url },
    jenkins: { enabled: !!s.jenkins_url },
  };
  res.json(info);
});

/** /rag 명령 — RAG 폴더 문서 목록을 채팅방에 게시 */
integrationsRouter.get("/rag/files", async (req: AuthedRequest, res) => {
  const roomId = req.query.roomId ? Number(req.query.roomId) : NaN;
  if (!roomId || Number.isNaN(roomId) || !isMember(roomId, req.auth!.userId)) {
    res.status(403).json({ error: "이 방에 접근할 수 없습니다." });
    return;
  }

  const settings = getSettings();
  if (!settings.rag_enabled) {
    res.status(400).json({ error: "RAG 기능이 비활성화되어 있습니다. 관리자 설정을 확인하세요." });
    return;
  }

  const files = await listRagFolderFiles();
  const content = formatRagFileListMessage(files, config.ragDocumentFolder);
  const message = insertTextMessage({
    roomId,
    senderId: req.auth!.userId,
    content,
  });
  broadcastMessage(message);
  markRoomRead(roomId, req.auth!.userId, message.id);

  res.json({ message, files } satisfies { message: Message; files: RagFileInfo[] });
});
