import { contextBridge, ipcRenderer } from "electron";

export type NotificationNavTarget =
  | { type: "room"; roomId: number }
  | { type: "calendar"; eventId: number };

/**
 * 렌더러에 노출할 안전한 API (contextBridge).
 * 파일 저장 등 메인 프로세스가 담당하는 기능만 선택적으로 노출한다.
 */
const api = {
  /** 다운로드한 파일 바이트를 사용자가 지정한 위치에 저장 (FR-22) */
  saveFile: (fileName: string, data: ArrayBuffer): Promise<string | null> =>
    ipcRenderer.invoke("file:save", { fileName, data }),
  downloadFile: (payload: {
    url: string;
    fileName: string;
    expectedSize?: number | null;
  }): Promise<string | null> => ipcRenderer.invoke("file:download", payload),
  /** RAG 문서 폴더 경로 선택 (탐색기) */
  pickFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke("folder:pick", defaultPath),
  /** 새 메시지/일정 OS 알림 */
  showNotification: (payload: {
    title: string;
    body: string;
    target: NotificationNavTarget;
  }): Promise<void> => ipcRenderer.invoke("notification:show", payload),
  /** DM /지진 수신 — 창 복원 + 흔들림 */
  earthquakeShake: (payload: { roomId: number }): Promise<void> =>
    ipcRenderer.invoke("window:earthquake", payload),
  /** 일정 리마인더 — 창 복원 + 흔들림 후 해당 일정으로 이동 */
  reminderShake: (payload: { eventId: number }): Promise<void> =>
    ipcRenderer.invoke("window:reminder-shake", payload),
  /** 알림 클릭 시 방/캘린더 이동 */
  onNotificationNavigate: (
    callback: (target: NotificationNavTarget) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      target: NotificationNavTarget
    ): void => {
      callback(target);
    };
    ipcRenderer.on("notification:navigate", listener);
    return () => {
      ipcRenderer.removeListener("notification:navigate", listener);
    };
  },
  /** 외부 링크를 기본 브라우저에서 연다 */
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke("shell:open-external", url),
};

contextBridge.exposeInMainWorld("intraChat", api);

export type IntraChatApi = typeof api;
