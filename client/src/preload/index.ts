import { contextBridge, ipcRenderer } from "electron";

/**
 * 렌더러에 노출할 안전한 API (contextBridge).
 * 파일 저장 등 메인 프로세스가 담당하는 기능만 선택적으로 노출한다.
 */
const api = {
  /** 다운로드한 파일 바이트를 사용자가 지정한 위치에 저장 (FR-22) */
  saveFile: (fileName: string, data: ArrayBuffer): Promise<string | null> =>
    ipcRenderer.invoke("file:save", { fileName, data }),
};

contextBridge.exposeInMainWorld("intraChat", api);

export type IntraChatApi = typeof api;
