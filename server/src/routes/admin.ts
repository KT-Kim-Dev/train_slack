import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AdminSettings } from "@intra-chat/shared";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { config } from "../config.js";
import { getSettings, updateSettings } from "../db/settings.js";
import { AI_USERNAME } from "../db/index.js";
import {
  createUser,
  deleteUser,
  getUserById,
  getUserByUsername,
  listUsers,
  setActive,
  toPublicUser,
} from "../db/users.js";
import { disconnectUser, broadcastUserRemoved, broadcastUserUpdated } from "../sockets/index.js";
import { logger } from "../logger.js";
import { IntegrationError, listModelsAtUrl } from "../services/ollama.js";
import { getRagStats, syncSharedFolder } from "../services/rag.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

/** 관리자 권한 확인: config.adminUsernames 에 포함된 사용자만 허용 */
adminRouter.use((req: AuthedRequest, res, next) => {
  if (!config.adminUsernames.includes(req.auth!.username)) {
    res.status(403).json({ error: "관리자 권한이 필요합니다." });
    return;
  }
  next();
});

/** 전체 사용자 목록 (활성/비활성 포함, AI 시스템 계정 제외) */
adminRouter.get("/users", (_req, res) => {
  res.json(
    listUsers()
      .filter((u) => u.username !== AI_USERNAME)
      .map((u) => ({ ...toPublicUser(u), isActive: u.is_active === 1 }))
  );
});

/** 계정 생성 (FR-01, CLI 대안) */
adminRouter.post("/users", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(50),
    password: z.string().min(4),
    displayName: z.string().min(1).max(50),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "username/password/displayName 을 확인하세요." });
    return;
  }
  if (getUserByUsername(parsed.data.username)) {
    res.status(409).json({ error: "이미 존재하는 아이디입니다." });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = createUser({
    username: parsed.data.username,
    passwordHash,
    displayName: parsed.data.displayName,
  });
  logger.info("관리자 계정 생성", { userId: user.id, username: user.username });
  broadcastUserUpdated(toPublicUser(user));
  res.status(201).json(toPublicUser(user));
});

/** 계정 비활성화 (FR-04) - 세션 즉시 종료 */
adminRouter.post("/users/:id/deactivate", (req, res) => {
  const id = Number(req.params.id);
  if (!getUserById(id)) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    return;
  }
  setActive(id, false);
  disconnectUser(id);
  broadcastUserRemoved(id);
  logger.info("계정 비활성화", { userId: id });
  res.json({ ok: true });
});

/** 계정 활성화 */
adminRouter.post("/users/:id/activate", (req, res) => {
  const id = Number(req.params.id);
  if (!getUserById(id)) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    return;
  }
  setActive(id, true);
  const user = getUserById(id)!;
  broadcastUserUpdated(toPublicUser(user));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 연동 설정 (관리자 전용)
// ---------------------------------------------------------------------------

/** 현재 연동 설정 조회 — 토큰/비밀번호는 설정 여부만 표시하고 평문은 내려보내지 않는다 */
adminRouter.get("/settings", (_req, res) => {
  const s = getSettings();
  const response: AdminSettings = {
    ...s,
    yona_token: s.yona_token ? "••••••••" : "",
    jenkins_token: s.jenkins_token ? "••••••••" : "",
  };
  res.json(response);
});

/** Ollama URL에서 사용 가능한 모델 목록 조회 (저장 전 URL 테스트 지원) */
adminRouter.get("/settings/ollama-models", async (req, res) => {
  const urlParam = typeof req.query.url === "string" ? req.query.url.trim() : "";
  const url = urlParam || getSettings().ollama_url.trim();
  if (!url) {
    res.status(400).json({ error: "Ollama URL을 입력해 주세요." });
    return;
  }

  try {
    const models = await listModelsAtUrl(url);
    res.json({ url, models });
  } catch (err) {
    const message =
      err instanceof IntegrationError ? err.message : "모델 목록을 불러오지 못했습니다.";
    res.status(502).json({ error: message });
  }
});

/** 연동 설정 저장 — 마스킹 값("••••••••")은 변경하지 않는다 */
adminRouter.put("/settings", (req, res) => {
  const schema = z.object({
    ollama_url: z.string().optional(),
    ollama_model: z.string().optional(),
    ollama_timeout_ms: z.number().int().positive().optional(),
    ai_context_limit: z.number().int().positive().optional(),
    ai_reply_language: z.enum(["ko", "en", "auto"]).optional(),
    ai_extra_instructions: z.string().max(2000).optional(),
    ai_show_reasoning: z.boolean().optional(),
    rag_enabled: z.boolean().optional(),
    rag_auto_learn: z.boolean().optional(),
    rag_embedding_model: z.string().optional(),
    rag_top_k: z.number().int().min(1).max(20).optional(),
    yona_url: z.string().optional(),
    yona_token: z.string().optional(),
    yona_default_project: z.string().optional(),
    jenkins_url: z.string().optional(),
    jenkins_user: z.string().optional(),
    jenkins_token: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "잘못된 설정 값입니다." });
    return;
  }

  // 마스킹 값은 저장하지 않음 (사용자가 수정하지 않은 것)
  const patch = { ...parsed.data };
  if (patch.yona_token === "••••••••") delete patch.yona_token;
  if (patch.jenkins_token === "••••••••") delete patch.jenkins_token;
  delete (patch as { rag_last_sync_at?: string }).rag_last_sync_at;
  delete (patch as { rag_shared_folder?: string }).rag_shared_folder;

  updateSettings(patch);
  logger.info("연동 설정 변경", { updatedKeys: Object.keys(patch) });
  res.json({ ok: true });
});

/** RAG 지식 베이스 통계 */
adminRouter.get("/rag/stats", (_req, res) => {
  res.json(getRagStats());
});

/** 서버 RAG 폴더를 RAG 지식 베이스에 동기화 (변경된 파일만 재색인) */
adminRouter.post("/rag/sync-folder", async (_req, res) => {
  try {
    const result = await syncSharedFolder();
    res.json(result);
  } catch (err) {
    const message =
      err instanceof IntegrationError ? err.message : "문서 폴더 동기화에 실패했습니다.";
    res.status(502).json({ error: message });
  }
});

/** 계정 삭제 (FR-04) - 세션 즉시 종료 */
adminRouter.delete("/users/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (!target) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    return;
  }
  if (target.username === AI_USERNAME) {
    res.status(400).json({ error: "시스템 계정은 삭제할 수 없습니다." });
    return;
  }
  if (id === req.auth!.userId) {
    res.status(400).json({ error: "본인 계정은 삭제할 수 없습니다." });
    return;
  }
  disconnectUser(id);
  deleteUser(id);
  broadcastUserRemoved(id);
  logger.info("계정 삭제", { userId: id });
  res.json({ ok: true });
});
