import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import { join, basename, isAbsolute } from "node:path";
import { open, readFile, lstat } from 'node:fs/promises';
import { FILE_EXTENSIONS, MAX_FILE_BYTES, safeWebURL } from '../../../../packages/shared-types/search';
import { parseOperation } from '../../../../packages/shared-types/auth';
import { pathToFileURL } from "node:url";
import { createWindow } from "./window";
import { isTheme, isTrustedURL } from "./security/policy";
import { AuthClient, serverURL } from "./auth-client";
import { LocalProfiles } from './local-profiles';
import { LocalAIClient } from './local-ai-client';
import { parseLocalProfileRequest } from '../../../../packages/shared-types/local-profile';
import { LocalWorkspace } from './workspace';
import { AgentSession } from './agent';
import { GitSession } from './git';
import { parseGitRequest } from '../../../../packages/shared-types/git';
import { parseAgentRequest } from '../../../../packages/shared-types/agent';
import { parseWorkspaceRequest } from '../../../../packages/shared-types/workspace';
import type { ThemePreference } from "../../../../packages/shared-types/ipc/desktop";
import { parseTaskInput } from '../../../../packages/shared-types/task';

let theme: ThemePreference = "system";
let mainWindow: BrowserWindow | null = null;
let rendererURL = "";
let auth: AuthClient | LocalProfiles;
let local: LocalProfiles | undefined;
const workspace = new LocalWorkspace(event => {
  if (event.type === 'reset' || event.type === 'lost') { agent.dispose(); git.dispose(); }
  if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('desktop:workspace-event', event);
});
const agent = new AgentSession(workspace, () => auth?.sessionGeneration ?? -1);
const git = new GitSession(workspace, () => auth?.sessionGeneration ?? -1);
let authMonitor: ReturnType<typeof setInterval> | undefined;
let monitoringAuth = false;

async function openWindow() {
  mainWindow = createWindow();
  mainWindow.on('close', event => {
    if (workspace.info && workspace.dirty) {
      event.preventDefault();
      mainWindow?.webContents.send('desktop:workspace-event', { id: workspace.info.id, type: 'close-request' });
    }
  });
  mainWindow.webContents.on('render-process-gone', () => workspace.dispose());
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) workspace.dispose(); });
  mainWindow.on("closed", () => {
    auth.cancelChat();
    workspace.dispose();
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
    if (process.env.LOCAL_WORKSPACE_MODE === '1' || !process.env.AUTH_SERVER_URL) {
      let ai:LocalAIClient|undefined;const file=process.env.LOCAL_AI_CONNECTION_FILE;
      if(file){if(!isAbsolute(file))throw new Error('Absolute connection file required');const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>4096)throw new Error('Invalid connection file');const c=JSON.parse(await readFile(file,'utf8'));ai=new LocalAIClient(c.url,c.pairing);}
      local = new LocalProfiles(join(app.getPath('userData'), 'local-workspaces'), () => workspace.dispose(),ai);
      await local.initialize(process.env.LOCAL_WORKSPACE_ROSTER_FILE);
      auth = local;
    } else auth = new AuthClient(serverURL(process.env.AUTH_SERVER_URL, app.isPackaged), fetch, () => workspace.dispose());
    if (!local) authMonitor = setInterval(() => {
      if (workspace.info && auth.hasSession && !monitoringAuth) {
        monitoringAuth = true;
        const generation = auth.sessionGeneration;
        void auth.execute({ action: 'me' }).then(result => {
          if (!result.ok && generation === auth.sessionGeneration) workspace.dispose();
        }).finally(() => { monitoringAuth = false; });
      }
    }, 5000);
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
      return { version: app.getVersion(), theme, mode: local ? 'local' : 'server' };
    });
    ipcMain.handle('desktop:profiles', async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      if (!local) throw new Error('서버 모드에서는 로컬 프로필을 사용하지 않습니다.');
      const view = await local.profilesRequest(parseLocalProfileRequest(args[0]));
      theme = view.theme; nativeTheme.themeSource = theme;
      return view;
    });
    let workspaceQueue: Promise<unknown> = Promise.resolve();
    ipcMain.handle('desktop:git', async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const request = parseGitRequest(args[0]);
      if (!auth.hasSession) throw new Error('로그인이 필요합니다.');
      const generation = auth.sessionGeneration;
      const guard = async () => {
        if (!auth.hasSession || generation !== auth.sessionGeneration) throw new Error('인증 상태가 변경되었습니다.');
        const result = await auth.execute({ action: 'me' });
        if (!result.ok || generation !== auth.sessionGeneration) { git.dispose(); throw new Error('인증 상태를 확인하세요.'); }
        workspace.assertCurrent(request.id);
      };
      return git.execute(request, guard, async (operation, outcome) => {
        await guard();
        const result = await auth.execute({ action: 'recordGit', operation, outcome });
        if (!result.ok) throw new Error('개인 작업 기록을 저장할 수 없습니다.');
      });
    });
    ipcMain.handle('desktop:chat-plan', async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const input = parseTaskInput(args[0]), generation = auth.sessionGeneration;
      if (!auth.hasSession || !local?.ai) throw new Error('통합 작업은 로컬 API 서버 연결이 필요합니다.');
      const result = await local.ai.plan(input);
      if (!auth.hasSession || generation !== auth.sessionGeneration) throw new Error('프로필이 변경되었습니다.');
      return result;
    });
    ipcMain.handle('desktop:agent', async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const request = parseAgentRequest(args[0]);
      if (!auth.hasSession) throw new Error('로그인이 필요합니다.');
      const session = auth.sessionGeneration;
      workspace.assertCurrent(request.id);
      if (request.action === 'stop') {local?.ai?.cancelChat();return agent.stop(request.id, request.mode);}
      const result = await auth.execute({ action: 'me' });
      if (!result.ok || !auth.hasSession || session !== auth.sessionGeneration) { agent.dispose(); throw new Error('인증 상태를 확인하세요.'); }
      workspace.assertCurrent(request.id);
      switch (request.action) {
        case 'status': return agent.status(request.id, request.mode);
        case 'start': return agent.start(request.id, request.mode);
        case 'analyze': return agent.analyze(request.id, request.mode, request.paths);
        case 'generate':
          if(!local?.ai)throw new Error('로컬 API 서버 연결이 필요합니다.');
          return agent.generate(request.id,request.mode,request.paths,request.prompt,input=>local!.ai!.code(input,request.model,request.reasoningEffort));
        case 'decide': return agent.decide(request.id, request.mode, request.approval, request.digest, request.accept);
      }
    });
    ipcMain.handle('desktop:workspace', async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const request = parseWorkspaceRequest(args[0]);
      if (!auth.hasSession) throw new Error('로그인이 필요합니다.');
      const session = auth.sessionGeneration;
      const current = () => {
        if (!auth.hasSession || session !== auth.sessionGeneration) throw new Error('인증 상태가 변경되었습니다.');
        if (request.action !== 'pick' && request.action !== 'home') workspace.assertCurrent(request.id);
      };
      current();
      // PTY keystrokes use the authenticated local session; the live session is checked every 5s.
      if (request.action === 'terminal-write') { workspace.terminalWrite(request.id, request.terminal, request.data); return; }
      if (request.action === 'terminal-resize') { workspace.terminalResize(request.id, request.terminal, request.cols, request.rows); return; }
      if (request.action === 'dirty') { workspace.dirty = request.dirty; return; }
      // Resource release must work even while the server is unreachable or another request is queued.
      if (request.action === 'terminal-stop') { workspace.terminalStop(); return; }
      if (request.action === 'close') { workspace.dispose(); return; }
      if (request.action === 'close-window') { workspace.dispose(); mainWindow?.destroy(); return; }
      const task = workspaceQueue.catch(() => {}).then(async () => {
        current();
        const result = await auth.execute({ action: 'me' });
        current();
        if (!result.ok) { workspace.dispose(); throw new Error('로그인 상태를 확인할 수 없습니다. 다시 로그인하세요.'); }
        switch (request.action) {
          case 'home': {
            if (!local) throw new Error('로컬 프로필 모드에서만 사용할 수 있습니다.');
            return workspace.select(await local.claimProject(local.homeDirectory, session));
          }
          case 'pick': {
            const previous = workspace.info?.id;
            const picked = await dialog.showOpenDialog(mainWindow!, { title: '로컬 프로젝트 열기', properties: ['openDirectory'], ...(local ? { defaultPath: local.homeDirectory } : {}) });
            current();
            if (previous !== workspace.info?.id) throw new Error('작업공간이 변경되었습니다.');
            if (picked.canceled || picked.filePaths.length !== 1) return null;
            const root = picked.filePaths[0];
            // Validate with the same workspace path checks before recording ownership.
            if (local) { await workspace.validateRoot(root); await local.claimProject(root, session); current(); }
            return workspace.select(root);
          }
          case 'list': return workspace.list(request.id, request.path);
          case 'read': return workspace.read(request.id, request.path);
          case 'save': return workspace.save(request.id, request.path, request.text, request.version, request.overwrite);
          case 'terminal-start': return workspace.terminalStart(request.id, request.shell);
          case 'search': return workspace.search(request.id, request.query);
          case 'find-paths':return workspace.findPaths(request.id,request.query);
          case 'create':return workspace.create(request.id,request.path,request.directory,current);
          case 'rename':return workspace.renameEntry(request.id,request.path,request.target,current);
          case 'trash':return workspace.trash(request.id,request.path,path=>shell.trashItem(path),current);
        }
      });
      workspaceQueue = task;
      try { const result = await task; current(); return result; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code) throw new Error(code === 'EEXIST' ? '같은 이름의 파일·폴더가 이미 있습니다.' : code === 'ENOENT' ? '파일·폴더가 삭제되었거나 연결이 끊겼습니다.' : code === 'EACCES' || code === 'EPERM' ? '접근 권한이 없거나 읽기 전용입니다. 편집 내용은 유지됩니다.' : '파일·터미널 작업에 실패했습니다. 연결과 권한을 확인하세요.');
        throw error;
      }
    });
    ipcMain.handle("desktop:auth", async (event, ...args: unknown[]) => {
      validate(event, args, 1);
      const op = parseOperation(args[0]);
      if (op.action === 'logout' || op.action === 'login') workspace.dispose();
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
    ipcMain.handle('desktop:copy-text', (event, ...args: unknown[]) => {
      validate(event,args,1);
      if(!auth.hasSession||typeof args[0]!=='string'||args[0].length>128000)throw new Error('복사할 텍스트를 확인하세요.');
      clipboard.writeText(args[0]);
    });
    ipcMain.handle('desktop:chat', async (event, ...args: unknown[]) => {
      validate(event, args, 2);
      const requestId = args[0];
      if (typeof requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(requestId)) throw new Error('잘못된 요청 ID');
      const result = await auth.stream(args[1], item => {
        if (!event.sender.isDestroyed()) event.sender.send('desktop:chat-event', { requestId, event: item });
      });
      // Keep completion on the event channel: invoke replies may arrive before queued citations.
      if (!event.sender.isDestroyed()) event.sender.send('desktop:chat-event', { requestId, complete: true });
      return result;
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
    console.error("앱을 시작하지 못했습니다. 실행 설정과 로컬 프로필 파일을 확인하세요.");
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on('will-quit', () => { clearInterval(authMonitor); workspace.dispose(); });
