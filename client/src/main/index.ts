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
import { destroyTrayToast, showTrayToast } from "./tray-toast";

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
  mainWindow.focus();
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

app.whenReady().then(() => {
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
