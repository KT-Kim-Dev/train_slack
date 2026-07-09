import { ipcRenderer } from "electron";

window.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", () => {
    ipcRenderer.send("tray-toast:click");
  });
});
