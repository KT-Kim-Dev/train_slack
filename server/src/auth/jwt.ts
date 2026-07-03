import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface JwtPayload {
  userId: number;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === "string") {
    throw new Error("잘못된 토큰 형식입니다.");
  }
  return { userId: decoded.userId as number, username: decoded.username as string };
}
