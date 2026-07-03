import { Router } from "express";
import { z } from "zod";
import type { BuildCard, BuildStartResponse, BuildStatusResponse } from "@intra-chat/shared";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { isMember } from "../db/rooms.js";
import { insertCardMessage } from "../db/messages.js";
import { getAiUserId } from "../db/index.js";
import { finishBuildHistory, getBuildRoom, getBuildTriggeredBy, insertBuildHistory, logCommand } from "../db/integrations.js";
import { broadcastMessage } from "../sockets/index.js";
import { getStatus, startBuild } from "../services/jenkins.js";
import { IntegrationError } from "../services/ollama.js";
import { logger } from "../logger.js";

export const jenkinsRouter = Router();

/**
 * 빌드 실행 (FR-40, FR-41). 실행 전 확인 절차(FR-44)는 클라이언트가 담당하며,
 * 이 엔드포인트는 이미 확인된 실행 요청만 받는다.
 */
jenkinsRouter.post("/build/start", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ project: z.string().min(1), roomId: z.number().int() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "project 와 roomId 가 필요합니다." });
    return;
  }
  const { project, roomId } = parsed.data;
  const startedAt = Date.now();
  try {
    const result = await startBuild(project);
    insertBuildHistory({
      project,
      buildNumber: result.buildNumber,
      status: "QUEUED",
      triggeredBy: req.auth!.userId,
      roomId,
    });

    // 빌드 시작 알림 카드 게시 (FR-41)
    if (isMember(roomId, req.auth!.userId)) {
      const card: BuildCard = {
        kind: "build",
        phase: "started",
        project,
        buildNumber: result.buildNumber,
        status: "QUEUED",
        durationSec: null,
        logUrl: null,
      };
      const msg = insertCardMessage({
        roomId,
        senderId: req.auth!.userId,
        card,
        content: `Build #${result.buildNumber ?? "?"} 시작 (${project})`,
      });
      broadcastMessage(msg);
    }
    logCommand({
      userId: req.auth!.userId,
      command: "/build",
      parameter: project,
      success: true,
      elapsedMs: Date.now() - startedAt,
    });
    const response: BuildStartResponse = { buildNumber: result.buildNumber, queuedAt: result.queuedAt };
    res.status(201).json(response);
  } catch (err) {
    handleError(err, res, req.auth!.userId, "/build", project, startedAt);
  }
});

/** 빌드 상태 조회 (FR-43) */
jenkinsRouter.get("/build/:project/status", requireAuth, async (req: AuthedRequest, res) => {
  const project = req.params.project;
  const roomId = req.query.roomId ? Number(req.query.roomId) : null;
  const startedAt = Date.now();
  try {
    const status = await getStatus(project);
    if (roomId && isMember(roomId, req.auth!.userId)) {
      const card: BuildCard = {
        kind: "build",
        phase: "status",
        project,
        buildNumber: null,
        status: status.status,
        durationSec: status.durationSec,
        logUrl: status.logUrl,
      };
      const msg = insertCardMessage({ roomId, senderId: req.auth!.userId, card });
      broadcastMessage(msg);
    }
    logCommand({
      userId: req.auth!.userId,
      command: "/build status",
      parameter: project,
      success: true,
      elapsedMs: Date.now() - startedAt,
    });
    const response: BuildStatusResponse = status;
    res.json(response);
  } catch (err) {
    handleError(err, res, req.auth!.userId, "/build status", project, startedAt);
  }
});

/**
 * Jenkins → 서버 빌드 완료 웹훅 (FR-42).
 * 인증 헤더 대신 공유 시크릿(JENKINS_WEBHOOK_SECRET) 또는 무인증(내부망)으로 수신.
 * 빌드 시작 시 기록된 room_id 로 완료 카드를 게시한다.
 */
jenkinsRouter.post("/webhooks/jenkins", (req, res) => {
  const schema = z.object({
    project: z.string().min(1),
    buildNumber: z.number().int(),
    status: z.string().min(1),
    durationSec: z.number().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "잘못된 웹훅 페이로드입니다." });
    return;
  }
  const { project, buildNumber, status } = parsed.data;
  const durationSec = parsed.data.durationSec ?? null;
  finishBuildHistory({ project, buildNumber, status, durationSec });

  const roomId = getBuildRoom(project, buildNumber);
  if (roomId) {
    // 빌드를 실행한 사용자를 발신자로 표시. 없으면 AI 시스템 계정으로 fallback.
    const triggeredBy = getBuildTriggeredBy(project, buildNumber) ?? getAiUserId();
    const card: BuildCard = {
      kind: "build",
      phase: "finished",
      project,
      buildNumber,
      status,
      durationSec,
      logUrl: null,
    };
    const emoji = status.toUpperCase() === "SUCCESS" ? "✅" : "❌";
    const msg = insertCardMessage({
      roomId,
      senderId: triggeredBy,
      card,
      content: `${emoji} Build #${buildNumber} ${status} (${project})`,
    });
    broadcastMessage(msg);
  }
  logger.info("Jenkins 웹훅 수신", { project, buildNumber, status });
  res.json({ ok: true });
});

function handleError(
  err: unknown,
  res: import("express").Response,
  userId: number,
  command: string,
  parameter: string,
  startedAt: number
): void {
  const message = err instanceof IntegrationError ? err.message : "Jenkins 연동 처리 중 오류가 발생했습니다.";
  logCommand({ userId, command, parameter, success: false, elapsedMs: Date.now() - startedAt });
  logger.warn("Jenkins 요청 실패", { command, parameter, error: message });
  const status = err instanceof IntegrationError ? 502 : 500;
  res.status(status).json({ error: message });
}
