import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

/**
 * 환경 변수를 읽어 애플리케이션 설정을 구성한다.
 * 필요한 디렉터리(데이터/업로드/로그)는 시작 시 자동 생성한다.
 */

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  dbPath: resolveFromRoot(process.env.DB_PATH ?? "./data/intra-chat.sqlite"),
  uploadDir: ensureDir(resolveFromRoot(process.env.UPLOAD_DIR ?? "./uploads")),
  logDir: ensureDir(resolveFromRoot("./logs")),
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 100 * 1024 * 1024),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  adminUsernames: (process.env.ADMIN_USERNAMES ?? "admin")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean),
};

// 데이터베이스 파일이 위치할 디렉터리도 미리 생성
ensureDir(path.dirname(config.dbPath));

if (config.jwtSecret === "dev-insecure-secret-change-me") {
  // 운영에서 기본 시크릿을 쓰지 않도록 경고 (로거는 아직 초기화 전이라 console 사용)
  console.warn("[config] JWT_SECRET 이 기본값입니다. 운영 배포 전 반드시 교체하세요.");
}
