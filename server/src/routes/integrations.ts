import { Router } from "express";
import type { IntegrationsInfo } from "@intra-chat/shared";
import { requireAuth } from "../auth/middleware.js";
import { config, integrationsEnabled } from "../config.js";
import { listModels } from "../services/ollama.js";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

/** 클라이언트가 UI(명령어 안내/모델 선택 등)를 구성하기 위한 연동 활성화 정보 */
integrationsRouter.get("/", async (_req, res) => {
  const models = integrationsEnabled.ai() ? await listModels() : [];
  const info: IntegrationsInfo = {
    ai: {
      enabled: integrationsEnabled.ai(),
      models,
      defaultModel: integrationsEnabled.ai() ? config.ai.defaultModel : null,
    },
    yona: { enabled: integrationsEnabled.yona() },
    jenkins: { enabled: integrationsEnabled.jenkins() },
  };
  res.json(info);
});
