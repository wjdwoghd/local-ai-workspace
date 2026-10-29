import { BrowserWindow, session } from "electron";
import { join } from "node:path";

export function createWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 680,
    minHeight: 560,
    title: "Local AI Workspace",
    backgroundColor: "#17201f",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  window.once("ready-to-show", () => window.show());
  return window;
}
