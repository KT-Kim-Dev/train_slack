import { Router } from "express";
import type { IntegrationsInfo } from "@intra-chat/shared";
import { requireAuth } from "../auth/middleware.js";
import { getSettings } from "../db/settings.js";
import { listModels } from "../services/ollama.js";

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
