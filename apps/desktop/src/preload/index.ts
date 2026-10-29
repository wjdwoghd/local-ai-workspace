import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../../../../packages/shared-types/ipc/desktop";

const api: DesktopAPI = {
  agent: { execute: request => ipcRenderer.invoke('desktop:agent', request) },
  workspace: {
    pick: () => ipcRenderer.invoke('desktop:workspace', { action: 'pick' }),
    close: id => ipcRenderer.invoke('desktop:workspace', { action: 'close', id }),
    closeWindow: id => ipcRenderer.invoke('desktop:workspace', { action: 'close-window', id }),
    list: (id, path) => ipcRenderer.invoke('desktop:workspace', { action: 'list', id, path }),
    read: (id, path) => ipcRenderer.invoke('desktop:workspace', { action: 'read', id, path }),
    save: (id, path, text, version, overwrite) => ipcRenderer.invoke('desktop:workspace', { action: 'save', id, path, text, version, overwrite }),
    dirty: (id, dirty) => ipcRenderer.invoke('desktop:workspace', { action: 'dirty', id, dirty }),
    terminalStart: id => ipcRenderer.invoke('desktop:workspace', { action: 'terminal-start', id }),
    terminalStop: id => ipcRenderer.invoke('desktop:workspace', { action: 'terminal-stop', id }),
    terminalWrite: (id, terminal, data) => ipcRenderer.invoke('desktop:workspace', { action: 'terminal-write', id, terminal, data }),
    terminalResize: (id, terminal, cols, rows) => ipcRenderer.invoke('desktop:workspace', { action: 'terminal-resize', id, terminal, cols, rows }),
    onEvent: callback => {
      const listener = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
      ipcRenderer.on('desktop:workspace-event', listener);
      return () => ipcRenderer.removeListener('desktop:workspace-event', listener);
    },
  },
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
  importDocument: teamId => ipcRenderer.invoke('desktop:document-import', teamId),
  openSource: url => ipcRenderer.invoke('desktop:source-open', url),
};
contextBridge.exposeInMainWorld("desktop", Object.freeze(api));
