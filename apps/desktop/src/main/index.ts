import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createWindow } from "./window";
import { isTheme, isTrustedURL } from "./security/policy";
import type { ThemePreference } from "../../../../packages/shared-types/ipc/desktop";

let theme: ThemePreference = "system";
let mainWindow: BrowserWindow | null = null;
let rendererURL = "";
let saveQueue = Promise.resolve();
const settingsPath = () => join(app.getPath("userData"), "settings.json");

async function openWindow() {
  mainWindow = createWindow();
  mainWindow.on("closed", () => {
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
    try {
      const saved: unknown = JSON.parse(await readFile(settingsPath(), "utf8"));
      if (
        saved &&
        typeof saved === "object" &&
        "theme" in saved &&
        isTheme(saved.theme)
      )
        theme = saved.theme;
    } catch {
      /* First launch or invalid preferences: use system theme. */
    }
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
    ipcMain.handle("desktop:theme", (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const value = args[0];
      if (!isTheme(value)) throw new Error("잘못된 테마");
      const save = saveQueue.then(async () => {
        await mkdir(app.getPath("userData"), { recursive: true });
        await writeFile(
          `${settingsPath()}.tmp`,
          JSON.stringify({ theme: value }),
          "utf8",
        );
        await rename(`${settingsPath()}.tmp`, settingsPath());
        theme = value;
        nativeTheme.themeSource = value;
      });
      saveQueue = save.catch(() => {});
      return save;
    });
    await openWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openWindow();
    });
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
