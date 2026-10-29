import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../../../../packages/shared-types/ipc/desktop";

const api: DesktopAPI = {
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  setTheme: (theme) => ipcRenderer.invoke("desktop:theme", theme),
  auth: (operation) => ipcRenderer.invoke("desktop:auth", operation),
  streamChat: async (input, onEvent) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: { requestId: string; event: Parameters<typeof onEvent>[0] }) => {
      if (payload.requestId === requestId) onEvent(payload.event);
    };
    ipcRenderer.on('desktop:chat-event', listener);
    try { return await ipcRenderer.invoke('desktop:chat', requestId, input); }
    finally { ipcRenderer.removeListener('desktop:chat-event', listener); }
  },
  cancelChat: () => ipcRenderer.invoke('desktop:chat-cancel'),
};
contextBridge.exposeInMainWorld("desktop", Object.freeze(api));
