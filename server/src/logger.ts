import path from "node:path";
import winston from "winston";
import { config } from "./config.js";

/**
 * winston 기반 애플리케이션 로거.
 * 요구사항에 따라 런타임 로그를 별도 파일(logs/app.log)에 기록하고,
 * 개발 편의를 위해 콘솔에도 출력한다. 접속/메시지/파일/에러 추적 목적.
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(config.logDir, "app.log"),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(config.logDir, "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} ${level}: ${message}${metaStr}`;
        })
      ),
    }),
  ],
});
