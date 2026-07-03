import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload } from "./jwt.js";
import { getUserById } from "../db/users.js";

/** 인증된 사용자 정보를 담기 위한 Request 확장 */
export interface AuthedRequest extends Request {
  auth?: JwtPayload;
}

/**
 * REST 요청의 JWT 인증 미들웨어.
 * Authorization: Bearer <token> 헤더를 검증하고, 계정이 비활성/삭제된 경우 거부한다 (FR-04).
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "인증 토큰이 없습니다." });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = verifyToken(token);
    const user = getUserById(payload.userId);
    if (!user || user.is_active !== 1) {
      res.status(401).json({ error: "비활성화되었거나 존재하지 않는 계정입니다." });
      return;
    }
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "유효하지 않거나 만료된 토큰입니다." });
  }
}
