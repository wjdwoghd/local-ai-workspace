import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { join, basename } from "node:path";
import { open } from 'node:fs/promises';
import { FILE_EXTENSIONS, MAX_FILE_BYTES, safeWebURL } from '../../../../packages/shared-types/search';
import { parseOperation } from '../../../../packages/shared-types/auth';
import { pathToFileURL } from "node:url";
import { createWindow } from "./window";
import { isTheme, isTrustedURL } from "./security/policy";
import { AuthClient, serverURL } from "./auth-client";
import type { ThemePreference } from "../../../../packages/shared-types/ipc/desktop";

let theme: ThemePreference = "system";
let mainWindow: BrowserWindow | null = null;
let rendererURL = "";
let auth: AuthClient;

async function openWindow() {
  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    auth.cancelChat();
    mainWindow = null;
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const devURL = new URL(process.env.ELECTRON_RENDERER_URL);
    if (
      devURL.protocol !== "http:" ||
      devURL.hostname !== "127.0.0.1" ||
      devURL.port !== "5173"
    ) {
      throw new Error("허용되지 않은 개발 서버 주소");
    }
    rendererURL = devURL.href;
    await mainWindow.loadURL(rendererURL);
  } else {
    const file = join(__dirname, "../renderer/index.html");
    rendererURL = pathToFileURL(file).href;
    await mainWindow.loadFile(file);
  }
}

// Test runs use an isolated profile supplied by the launching process, never by renderer IPC.
if (process.env.LOCAL_AI_TEST_PROFILE && !app.isPackaged) {
  app.setPath("userData", process.env.LOCAL_AI_TEST_PROFILE);
}

app
  .whenReady()
  .then(async () => {
    auth = new AuthClient(serverURL(process.env.AUTH_SERVER_URL, app.isPackaged));
    nativeTheme.themeSource = theme;

    function validate(
      event: Electron.IpcMainInvokeEvent,
      args: unknown[],
      count: number,
    ) {
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        !isTrustedURL(event.senderFrame.url, rendererURL) ||
        args.length !== count
      ) {
        throw new Error("허용되지 않은 요청");
      }
    }
    ipcMain.handle("desktop:info", (event, ...args: unknown[]) => {
      validate(event, args, 0);
      return { version: app.getVersion(), theme };
    });
    ipcMain.handle("desktop:auth", async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const result = await auth.execute(args[0]);
      const action = (args[0] as { action?: string } | null)?.action;
      if (result.ok && (action === "settings" || action === "saveSettings")) {
        const value = action === "settings" ? (result.data as { theme?: unknown })?.theme : (args[0] as { theme?: unknown }).theme;
        if (isTheme(value)) { theme = value; nativeTheme.themeSource = value; }
      }
      if (action === "logout" || action === "login" || (!result.ok && result.status === 401)) {
        theme = "system";
        nativeTheme.themeSource = theme;
      }
      return result;
    });
    ipcMain.handle('desktop:chat', async (event, ...args: unknown[]) => {
      validate(event, args, 2);
      const requestId = args[0];
      if (typeof requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(requestId)) throw new Error('잘못된 요청 ID');
      return auth.stream(args[1], item => {
        if (!event.sender.isDestroyed()) event.sender.send('desktop:chat-event', { requestId, event: item });
      });
    });
    ipcMain.handle('desktop:chat-cancel', (event, ...args: unknown[]) => {
      validate(event, args, 0); auth.cancelChat();
    });
    ipcMain.handle('desktop:document-import', async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const teamId = args[0];
      if (teamId !== null) parseOperation({ action: 'getConversation', id: teamId });
      return auth.importDocument(async () => {
        const picked = await dialog.showOpenDialog(mainWindow!, { title: '검색할 문서 등록', properties: ['openFile'], filters: [{ name: '검색 문서', extensions: [...FILE_EXTENSIONS] }] });
        if (picked.canceled || picked.filePaths.length !== 1) return;
        const file = await open(picked.filePaths[0], 'r');
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > MAX_FILE_BYTES || !stat.size) throw new Error('File limit');
          const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
          let size = 0;
          while (size < buffer.length) { const read = await file.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
          if (size > MAX_FILE_BYTES) throw new Error('File limit');
          return { name: basename(picked.filePaths[0]), base64: buffer.subarray(0, size).toString('base64'), teamId: teamId as string | null };
        } finally { await file.close(); }
      });
    });
    ipcMain.handle('desktop:source-open', async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      if (!safeWebURL(args[0])) throw new Error('잘못된 출처 주소');
      await shell.openExternal(args[0]);
    });
    ipcMain.handle("desktop:theme", async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const value = args[0];
      if (!isTheme(value)) throw new Error("잘못된 테마");
      const result = await auth.execute({ action: "saveSettings", theme: value });
      if (!result.ok) throw new Error("설정을 저장할 수 없습니다. 인증 상태를 확인하세요.");
      theme = value;
      nativeTheme.themeSource = value;
    });
    await openWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openWindow();
    });
  })
  .catch(() => {
    console.error("앱을 시작하지 못했습니다. 인증 서버 주소 설정을 확인하세요.");
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
