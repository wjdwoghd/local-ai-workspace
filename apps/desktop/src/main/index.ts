import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { join } from "node:path";
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
