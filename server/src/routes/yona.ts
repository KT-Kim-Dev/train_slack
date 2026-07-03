import { Router } from "express";
import { z } from "zod";
import type { CreateIssueResponse, IssueCard } from "@intra-chat/shared";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { isMember } from "../db/rooms.js";
import { insertCardMessage } from "../db/messages.js";
import { logCommand } from "../db/integrations.js";
import { broadcastMessage } from "../sockets/index.js";
import { createIssue, getIssue } from "../services/yona.js";
import { IntegrationError } from "../services/ollama.js";
import { logger } from "../logger.js";

export const yonaRouter = Router();
yonaRouter.use(requireAuth);

/** 이슈 조회 (FR-35) — 조회 결과를 방에 카드 메시지로 게시 */
yonaRouter.get("/issues/:id", async (req: AuthedRequest, res) => {
  const issueId = req.params.id;
  const roomId = req.query.roomId ? Number(req.query.roomId) : null;
  const startedAt = Date.now();
  try {
    const issue = await getIssue(issueId);
    const card: IssueCard = { kind: "issue", ...issue };

    if (roomId && isMember(roomId, req.auth!.userId)) {
      const msg = insertCardMessage({ roomId, senderId: req.auth!.userId, card });
      broadcastMessage(msg);
    }
    logCommand({
      userId: req.auth!.userId,
      command: "/issue",
      parameter: issueId,
      success: true,
      elapsedMs: Date.now() - startedAt,
    });
    res.json(card);
  } catch (err) {
    handleError(err, res, req.auth!.userId, "/issue", issueId, startedAt);
  }
});

/** 이슈 생성 (FR-36, FR-37) — 생성 후 링크 카드 게시 */
yonaRouter.post("/issues", async (req: AuthedRequest, res) => {
  const schema = z.object({
    roomId: z.number().int(),
    title: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional(),
    project: z.string().optional(),
    labels: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "제목은 필수입니다." });
    return;
  }
  const startedAt = Date.now();
  try {
    const created = await createIssue(parsed.data);
    const card: IssueCard = {
      kind: "issue",
      issueId: created.issueId,
      title: parsed.data.title,
      assignee: parsed.data.assignee ?? null,
      priority: null,
      status: "생성됨",
      dueDate: null,
      url: created.url,
    };
    if (isMember(parsed.data.roomId, req.auth!.userId)) {
      const msg = insertCardMessage({
        roomId: parsed.data.roomId,
        senderId: req.auth!.userId,
        card,
        content: `이슈가 생성되었습니다: ${created.url}`,
      });
      broadcastMessage(msg);
    }
    logCommand({
      userId: req.auth!.userId,
      command: "/issue create",
      parameter: parsed.data.title.slice(0, 200),
      success: true,
      elapsedMs: Date.now() - startedAt,
    });
    const response: CreateIssueResponse = { issueId: created.issueId, url: created.url };
    res.status(201).json(response);
  } catch (err) {
    handleError(err, res, req.auth!.userId, "/issue create", parsed.data.title, startedAt);
  }
});

function handleError(
  err: unknown,
  res: import("express").Response,
  userId: number,
  command: string,
  parameter: string,
  startedAt: number
): void {
  const message = err instanceof IntegrationError ? err.message : "Yona 연동 처리 중 오류가 발생했습니다.";
  logCommand({ userId, command, parameter, success: false, elapsedMs: Date.now() - startedAt });
  logger.warn("Yona 요청 실패", { command, parameter, error: message });
  const status = err instanceof IntegrationError ? 502 : 500;
  res.status(status).json({ error: message });
}
