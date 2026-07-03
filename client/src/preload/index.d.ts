import type { IntraChatApi } from "./index";

declare global {
  interface Window {
    intraChat: IntraChatApi;
  }
}

export {};
