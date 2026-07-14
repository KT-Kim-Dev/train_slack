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
  avatarsDir: ensureDir(
    resolveFromRoot(path.join(process.env.UPLOAD_DIR ?? "./uploads", "avatars"))
  ),
  emojisBuiltinDir: ensureDir(resolveFromRoot(process.env.EMOJIS_BUILTIN_DIR ?? "./emojis/builtin")),
  emojisCustomDir: ensureDir(
    resolveFromRoot(path.join(process.env.UPLOAD_DIR ?? "./uploads", "emojis"))
  ),
  logDir: ensureDir(resolveFromRoot("./logs")),
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 1024 * 1024 * 1024),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  adminUsernames: (process.env.ADMIN_USERNAMES ?? "admin")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean),

  /** RAG 문서 폴더 — 서버 실행 디렉터리 기준 ./RAG (시작 시 자동 생성) */
  ragDocumentFolder: ensureDir(resolveFromRoot(process.env.RAG_DIR ?? "./RAG")),

  // ------ v3: 업무 연동 설정 (모두 인트라넷 내부 주소, 없으면 해당 기능 비활성화) ------
  ai: {
    // Ollama OpenAI 호환 엔드포인트 (예: http://localhost:11434)
    baseUrl: (process.env.OLLAMA_URL ?? "").trim(),
    defaultModel: (process.env.OLLAMA_MODEL ?? "llama3").trim(),
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 60000),
    contextLimit: Number(process.env.AI_CONTEXT_LIMIT ?? 10),
  },
  yona: {
    baseUrl: (process.env.YONA_URL ?? "").trim(),
    token: (process.env.YONA_TOKEN ?? "").trim(),
    defaultProject: (process.env.YONA_DEFAULT_PROJECT ?? "").trim(),
  },
  jenkins: {
    baseUrl: (process.env.JENKINS_URL ?? "").trim(),
    user: (process.env.JENKINS_USER ?? "").trim(),
    token: (process.env.JENKINS_TOKEN ?? "").trim(),
  },
};

/** 각 연동 기능의 활성화 여부 (필수 설정이 존재할 때만 true) */
export const integrationsEnabled = {
  ai: () => config.ai.baseUrl.length > 0,
  yona: () => config.yona.baseUrl.length > 0,
  jenkins: () => config.jenkins.baseUrl.length > 0,
};

// 데이터베이스 파일이 위치할 디렉터리도 미리 생성
ensureDir(path.dirname(config.dbPath));

if (config.jwtSecret === "dev-insecure-secret-change-me") {
  // 운영에서 기본 시크릿을 쓰지 않도록 경고 (로거는 아직 초기화 전이라 console 사용)
  console.warn("[config] JWT_SECRET 이 기본값입니다. 운영 배포 전 반드시 교체하세요.");
}
