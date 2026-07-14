import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";

const TOAST_WIDTH = 380;
const TOAST_HEIGHT = 92;
const TOAST_MARGIN = 14;
const TOAST_DURATION_MS = 3000;

let toastWindow: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let clickHandler: (() => void) | null = null;

function toastPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - TOAST_WIDTH - TOAST_MARGIN,
    y: workArea.y + workArea.height - TOAST_HEIGHT - TOAST_MARGIN,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildToastHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%; height: 100%;
    background: transparent;
    overflow: hidden;
    font-family: -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
  }
  .toast {
    width: 100%; height: 100%;
    background: linear-gradient(135deg, #1e2126 0%, #16181c 100%);
    border: 1px solid rgba(255,255,255,0.1);
    border-left: 4px solid #1164a3;
    border-radius: 10px;
    padding: 14px 16px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.45);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: center;
    animation: slide-up 0.25s ease-out;
  }
  .title {
    font-size: 13px;
    font-weight: 700;
    color: #e8e8e8;
    margin-bottom: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    font-size: 12px;
    color: #9a9a9a;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  @keyframes slide-up {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
  <div class="toast">
    <div class="title">${escapeHtml(title)}</div>
    <div class="body">${escapeHtml(body)}</div>
  </div>
</body>
</html>`;
}

let ipcRegistered = false;

/** ipcMain은 app ready 이후에만 사용 가능 (Electron 33+) */
export function registerTrayToastIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on("tray-toast:click", () => {
    clickHandler?.();
    hideTrayToast();
  });
}

/** 시스템 트레이 근처(화면 우하단)에 3초간 표시되는 토스트 */
export function showTrayToast(
  payload: { title: string; body: string },
  onClick?: () => void
): void {
  const { x, y } = toastPosition();
  clickHandler = onClick ?? null;

  if (!toastWindow || toastWindow.isDestroyed()) {
    toastWindow = new BrowserWindow({
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      resizable: false,
      movable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, "../preload/trayToast.js"),
        nodeIntegration: false,
        contextIsolation: false,
        sandbox: false,
      },
    });
    toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  void toastWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildToastHtml(payload.title, payload.body))}`
  );

  toastWindow.webContents.once("did-finish-load", () => {
    toastWindow?.setPosition(x, y);
    toastWindow?.showInactive();
  });

  hideTimer = setTimeout(() => {
    hideTrayToast();
  }, TOAST_DURATION_MS);
}

export function hideTrayToast(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  clickHandler = null;
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.hide();
  }
}

export function destroyTrayToast(): void {
  hideTrayToast();
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.destroy();
  }
  toastWindow = null;
}
