import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../../../../packages/shared-types/ipc/desktop";

const api: DesktopAPI = {
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  setTheme: (theme) => ipcRenderer.invoke("desktop:theme", theme),
  auth: (operation) => ipcRenderer.invoke("desktop:auth", operation),
};
contextBridge.exposeInMainWorld("desktop", Object.freeze(api));
