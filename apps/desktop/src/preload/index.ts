import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../../../../packages/shared-types/ipc/desktop";

const api: DesktopAPI = {
  copyText: text => ipcRenderer.invoke('desktop:copy-text', text),
  planChat: input => ipcRenderer.invoke('desktop:chat-plan', input),
  profiles: request => ipcRenderer.invoke('desktop:profiles', request),
  git: request => ipcRenderer.invoke('desktop:git', request),
  agent: { execute: request => ipcRenderer.invoke('desktop:agent', request) },
  workspace: {
    home: () => ipcRenderer.invoke('desktop:workspace', { action: 'home' }),
    pick: () => ipcRenderer.invoke('desktop:workspace', { action: 'pick' }),
    close: id => ipcRenderer.invoke('desktop:workspace', { action: 'close', id }),
    closeWindow: id => ipcRenderer.invoke('desktop:workspace', { action: 'close-window', id }),
    list: (id, path) => ipcRenderer.invoke('desktop:workspace', { action: 'list', id, path }),
    read: (id, path) => ipcRenderer.invoke('desktop:workspace', { action: 'read', id, path }),
    search: (id, query) => ipcRenderer.invoke('desktop:workspace', { action: 'search', id, query }),
    findPaths:(id,query)=>ipcRenderer.invoke('desktop:workspace',{action:'find-paths',id,query}),
    create:(id,path,directory)=>ipcRenderer.invoke('desktop:workspace',{action:'create',id,path,directory}),
    rename:(id,path,target)=>ipcRenderer.invoke('desktop:workspace',{action:'rename',id,path,target}),
    trash:(id,path)=>ipcRenderer.invoke('desktop:workspace',{action:'trash',id,path}),
    save: (id, path, text, version, overwrite) => ipcRenderer.invoke('desktop:workspace', { action: 'save', id, path, text, version, overwrite }),
    dirty: (id, dirty) => ipcRenderer.invoke('desktop:workspace', { action: 'dirty', id, dirty }),
    terminalStart: (id, shell) => ipcRenderer.invoke('desktop:workspace', { action: 'terminal-start', id, ...(shell ? { shell } : {}) }),
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
    let finish!: () => void;
    const completed = new Promise<void>(resolve => { finish = resolve; });
    const listener = (_event: Electron.IpcRendererEvent, payload: { requestId: string; event?: Parameters<typeof onEvent>[0]; complete?: boolean }) => {
      if (payload.requestId !== requestId) return;
      if (payload.complete) finish();
      else if (payload.event) onEvent(payload.event);
    };
    ipcRenderer.on('desktop:chat-event', listener);
    try { const [result] = await Promise.all([ipcRenderer.invoke('desktop:chat', requestId, input), completed]); return result; }
    finally { ipcRenderer.removeListener('desktop:chat-event', listener); }
  },
  cancelChat: () => ipcRenderer.invoke('desktop:chat-cancel'),
  importDocument: teamId => ipcRenderer.invoke('desktop:document-import', teamId),
  openSource: url => ipcRenderer.invoke('desktop:source-open', url),
};
contextBridge.exposeInMainWorld("desktop", Object.freeze(api));
