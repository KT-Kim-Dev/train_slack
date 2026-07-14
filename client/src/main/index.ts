import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { destroyTrayToast, registerTrayToastIpc, showTrayToast } from "./tray-toast";

/**
 * Electron 메인 프로세스.
 * - 브라우저 윈도우 생성 및 렌더러 로드
 * - 시스템 트레이 / 종료 선택 / 트레이 토스트 알림
 * - 파일 저장(다운로드) 등 파일시스템 접근을 IPC 로 담당 (FR-22)
 */

type NotificationTarget =
  | { type: "room"; roomId: number }
  | { type: "calendar"; eventId: number };

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function resolveResourcePath(fileName: string): string {
  const candidates = [
    join(__dirname, "../../build", fileName),
    join(process.resourcesPath, fileName),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function getAppIconPath(): string {
  return resolveResourcePath("icon.png");
}

function getTrayIconPath(): string {
  return resolveResourcePath("tray-icon.png");
}

function loadAppIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(getAppIconPath());
  if (!image.isEmpty()) return image;
  return nativeImage.createFromPath(getTrayIconPath());
}

function createTrayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(getTrayIconPath());
  const source = image.isEmpty() ? loadAppIcon() : image;
  if (source.isEmpty()) return nativeImage.createEmpty();

  const size = process.platform === "darwin" ? 18 : 16;
  return source.resize({ width: size, height: size, quality: "best" });
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (process.platform === "win32") mainWindow.setSkipTaskbar(false);
  if (process.platform === "darwin") app.dock?.show();
  mainWindow.focus();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let shakingWindow = false;

/** 트레이/최소화 상태에서도 최상단으로 올린 뒤 좌우·상하로 창을 흔든다 */
async function shakeWindow(win: BrowserWindow): Promise<void> {
  if (shakingWindow) return;
  shakingWindow = true;
  try {
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    if (process.platform === "win32") win.setSkipTaskbar(false);
    if (process.platform === "darwin") app.dock?.show();

    const wasAlwaysOnTop = win.isAlwaysOnTop();
    win.setAlwaysOnTop(true, "screen-saver");
    win.focus();

    const base = win.getBounds();
    const origin = { x: base.x, y: base.y, width: base.width, height: base.height };
    const frames = [
      { dx: 14, dy: 10 },
      { dx: -14, dy: -10 },
      { dx: 12, dy: -12 },
      { dx: -12, dy: 12 },
      { dx: 10, dy: 8 },
      { dx: -10, dy: -8 },
      { dx: 8, dy: -6 },
      { dx: -8, dy: 6 },
      { dx: 0, dy: 0 },
    ];

    for (const frame of frames) {
      win.setBounds({
        x: origin.x + frame.dx,
        y: origin.y + frame.dy,
        width: origin.width,
        height: origin.height,
      });
      await delay(45);
    }

    win.setBounds(origin);
    win.setAlwaysOnTop(wasAlwaysOnTop);
    win.focus();
  } finally {
    shakingWindow = false;
  }
}

function createTray(): void {
  if (tray) return;

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Intra-Chat");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Intra-Chat 열기",
      click: () => showMainWindow(),
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => showMainWindow());
  tray.on("click", () => {
    if (process.platform === "win32") showMainWindow();
  });
}

async function handleWindowClose(event: Electron.Event): Promise<void> {
  if (isQuitting || !mainWindow) return;

  event.preventDefault();

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["트레이로 최소화", "완전 종료", "취소"],
    defaultId: 0,
    cancelId: 2,
    title: "Intra-Chat 종료",
    message: "어떻게 하시겠습니까?",
    detail: "트레이로 최소화하면 백그라운드에서 새 메시지 알림을 받을 수 있습니다.",
    noLink: true,
  });

  if (response === 0) {
    if (process.platform === "win32") mainWindow.setSkipTaskbar(true);
    mainWindow.hide();
    if (process.platform === "darwin") app.dock?.hide();
  } else if (response === 1) {
    isQuitting = true;
    app.quit();
  }
}

function createWindow(): void {
  const appIcon = loadAppIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Intra-Chat",
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  mainWindow.on("close", (event) => {
    void handleWindowClose(event);
  });

  mainWindow.on("show", () => {
    if (process.platform === "win32") mainWindow?.setSkipTaskbar(false);
    if (process.platform === "darwin") app.dock?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function shouldShowTrayToast(win: BrowserWindow | null | undefined): boolean {
  if (!win) return true;
  return !win.isFocused() || !win.isVisible() || win.isMinimized();
}

function handleBackgroundNotification(
  win: BrowserWindow | null | undefined,
  payload: { title: string; body: string; target: NotificationTarget }
): void {
  if (!shouldShowTrayToast(win)) return;

  showTrayToast({ title: payload.title, body: payload.body }, () => {
    showMainWindow();
    win?.webContents.send("notification:navigate", payload.target);
  });
}

function registerIpcHandlers(): void {
  registerTrayToastIpc();

  ipcMain.handle(
    "file:save",
    async (_event, payload: { fileName: string; data: ArrayBuffer }): Promise<string | null> => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: payload.fileName,
      });
      if (canceled || !filePath) return null;
      const buffer = Buffer.from(new Uint8Array(payload.data));
      await writeFile(filePath, buffer);
      return filePath;
    }
  );

  /** 채팅 첨부파일 다운로드 — 바이너리 무결성 검증 후 저장 */
  ipcMain.handle(
    "file:download",
    async (
      _event,
      payload: { url: string; fileName: string; expectedSize?: number | null }
    ): Promise<string | null> => {
      const res = await fetch(payload.url);
      if (!res.ok) {
        let detail = `다운로드 실패 (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) detail = body.error;
        } catch {
          /* 바이너리 응답 등 */
        }
        throw new Error(detail);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const contentLength = res.headers.get("content-length");
      if (contentLength) {
        const expected = Number(contentLength);
        if (Number.isFinite(expected) && expected !== buffer.length) {
          throw new Error("다운로드가 완전하지 않습니다. 파일 크기가 일치하지 않습니다.");
        }
      }
      if (payload.expectedSize != null && payload.expectedSize !== buffer.length) {
        throw new Error(
          `파일 크기가 일치하지 않습니다 (예상 ${payload.expectedSize}, 실제 ${buffer.length}).`
        );
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: payload.fileName,
      });
      if (canceled || !filePath) return null;
      await writeFile(filePath, buffer);
      return filePath;
    }
  );

  ipcMain.handle("folder:pick", async (_event, defaultPath?: string): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: defaultPath?.trim() || undefined,
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0] ?? null;
  });

  /** 새 메시지/일정 알림 — 앱 비활성 시 트레이 위 토스트 (3초) */
  ipcMain.handle(
    "notification:show",
    (
      event,
      payload: {
        title: string;
        body: string;
        target: NotificationTarget;
      }
    ): void => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
      handleBackgroundNotification(win, payload);
    }
  );

  /** DM /지진 — 창 복원 + 흔들림 후 해당 DM으로 이동 */
  ipcMain.handle(
    "window:earthquake",
    async (event, payload: { roomId: number }): Promise<void> => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
      if (!win) return;
      await shakeWindow(win);
      win.webContents.send("notification:navigate", { type: "room", roomId: payload.roomId });
    }
  );
}

app.whenReady().then(() => {
  registerIpcHandlers();
  Menu.setApplicationMenu(null);
  const appIcon = loadAppIcon();
  if (!appIcon.isEmpty() && process.platform === "darwin") {
    app.dock?.setIcon(appIcon);
  }
  createTray();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  destroyTrayToast();
});

app.on("window-all-closed", () => {
  // 트레이 상주 — 창을 닫아도 앱을 종료하지 않음
});
