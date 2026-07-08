import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Electron 메인 프로세스.
 * - 브라우저 윈도우 생성 및 렌더러 로드
 * - 파일 저장(다운로드) 등 파일시스템 접근을 IPC 로 담당 (FR-22)
 */

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Intra-Chat",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow.show());

  // 외부 링크는 기본 브라우저가 아닌 새 창 방지 (인트라넷 환경)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 개발 모드에서는 Vite dev 서버, 배포 시에는 빌드된 파일 로드
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/**
 * 렌더러에서 전달한 파일 바이트를 사용자가 지정한 위치에 저장한다.
 * 반환: 저장 경로 또는 null(취소)
 */
ipcMain.handle(
  "file:save",
  async (_event, payload: { fileName: string; data: ArrayBuffer }): Promise<string | null> => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: payload.fileName,
    });
    if (canceled || !filePath) return null;
    await writeFile(filePath, Buffer.from(payload.data));
    return filePath;
  }
);

/** RAG 문서 폴더 선택 — Windows 탐색기 폴더 선택 대화상자 */
ipcMain.handle("folder:pick", async (_event, defaultPath?: string): Promise<string | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    defaultPath: defaultPath?.trim() || undefined,
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0] ?? null;
});

/** 새 메시지/일정 OS 알림 (윈도우 비활성 시) */
ipcMain.handle(
  "notification:show",
  (
    event,
    payload: {
      title: string;
      body: string;
      target: { type: "room"; roomId: number } | { type: "calendar"; eventId: number };
    }
  ): void => {
    if (!Notification.isSupported()) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isFocused()) return;

    const notification = new Notification({
      title: payload.title,
      body: payload.body,
    });
    notification.on("click", () => {
      win?.show();
      win?.focus();
      win?.webContents.send("notification:navigate", payload.target);
    });
    notification.show();
  }
);

app.whenReady().then(() => {
  // Windows/macOS 기본 애플리케이션 메뉴(File, Edit, View 등) 제거
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
