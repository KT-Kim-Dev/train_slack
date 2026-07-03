import http from "node:http";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initDb } from "./db/index.js";
import { initSocket } from "./sockets/index.js";
import { authRouter } from "./routes/auth.js";
import { roomsRouter } from "./routes/rooms.js";
import { usersRouter } from "./routes/users.js";
import { filesRouter } from "./routes/files.js";
import { adminRouter } from "./routes/admin.js";

initDb();

const app = express();
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/users", usersRouter);
app.use("/api/admin", adminRouter);
// 파일 라우트는 /api/rooms/:id/files 와 /api/files/:id 두 경로를 모두 다룬다.
app.use("/api", filesRouter);

// 공통 에러 핸들러
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("요청 처리 중 오류", { message: err.message, stack: err.stack });
    if (res.headersSent) return;
    res.status(500).json({ error: "서버 내부 오류가 발생했습니다." });
  }
);

const httpServer = http.createServer(app);
initSocket(httpServer, config.corsOrigin);

httpServer.listen(config.port, () => {
  logger.info(`Intra-Chat 서버 실행 중`, { port: config.port });
});
