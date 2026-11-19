import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage } from 'electron';
import { autoUpdater } from 'electron-updater';
import { sealSettings, openSettings, type Cipher } from './secrets';
import { createBackup, listBackups, restoreBackup, dailyBackupIfDue } from './backup';
import { join } from 'path';
import { promises as fs, existsSync, mkdirSync } from 'fs';
import { createOpenAIText, createOpenAIImage, createHttpVideo } from '../core/providers/openai';
import type { TextConfig, ImageConfig, VideoConfig } from '../core/providers/openai';

if (process.env.REFINER_USERDATA) app.setPath('userData', process.env.REFINER_USERDATA);
const SHOT_DIR = process.env.REFINER_SHOT_DIR;
/** 截图/验收时指定窗口尺寸，例如 REFINER_WIN=1280x800 */
const WIN = process.env.REFINER_WIN ? process.env.REFINER_WIN.split('x').map(Number) : null;

const dataDir = () => app.getPath('userData');
const projDir = () => join(dataDir(), 'projects');
const pluginDir = () => join(dataDir(), 'plugins');
const settingsFile = () => join(dataDir(), 'settings.json');

function ensureDirs() {
  for (const d of [projDir(), pluginDir()]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

const safeName = (s: string) => s.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: WIN ? WIN[0] : SHOT_DIR ? 1600 : 1480,
    height: WIN ? WIN[1] : SHOT_DIR ? 980 : 920,
    minWidth: 1100,
    minHeight: 680,
    title: '渐进 Refiner',
    backgroundColor: '#1b1d23',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win?.show());
  win.loadFile(join(__dirname, '../renderer/index.html'), { query: SHOT_DIR ? { shot: '1' } : {} });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.REFINER_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2 || process.env.REFINER_LOG) console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });
}

/** safeStorage 在 Linux 无密钥环时会退回明文“basic_text”，此时视为不可用（保持明文，界面提示） */
const cipher: Cipher = {
  available: () => { try { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || (safeStorage as any).getSelectedStorageBackend?.() !== 'basic_text' || !!process.env.REFINER_FORCE_ENC); } catch { return false; } },
  encrypt: (t) => safeStorage.encryptString(t),
  decrypt: (b) => safeStorage.decryptString(b),
};
let keepN = 10;

/** 自动更新（generic 源：任何静态文件服务器上放 latest.yml + 安装包即可） */
let updState: { status: string; version?: string; percent?: number; error?: string } = { status: 'idle' };
const sendUpd = () => win?.webContents.send('update:state', updState);
let updWired = false;
async function checkUpdate(url: string) {
  if (!url?.trim()) return { status: 'error', error: '未设置更新地址' };
  if (!app.isPackaged && !process.env.REFINER_UPDATE_DEV) return { status: 'error', error: '开发模式下不检查更新' };
  try {
    if (!updWired) {
      updWired = true;
      autoUpdater.autoDownload = true;
      autoUpdater.logger = null;
      autoUpdater.on('update-available', (i) => { updState = { status: 'downloading', version: i.version, percent: 0 }; sendUpd(); });
      autoUpdater.on('update-not-available', () => { updState = { status: 'latest' }; sendUpd(); });
      autoUpdater.on('download-progress', (p) => { updState = { ...updState, status: 'downloading', percent: Math.round(p.percent) }; sendUpd(); });
      autoUpdater.on('update-downloaded', (i) => { updState = { status: 'ready', version: i.version }; sendUpd(); });
      autoUpdater.on('error', (e) => { updState = { status: 'error', error: String(e?.message ?? e).split('\n')[0].slice(0, 200) }; sendUpd(); });
    }
    if (process.env.REFINER_UPDATE_DEV) (autoUpdater as any).forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: url.trim() });
    const r = await Promise.race([autoUpdater.checkForUpdates(), new Promise((_, rej) => setTimeout(() => rej(new Error('连接更新服务器超时')), 20000))]) as any;
    const v = r?.updateInfo?.version;
    if (v && v !== app.getVersion() && updState.status !== 'error') updState = { ...updState, status: updState.status === 'ready' ? 'ready' : 'downloading', version: v };
    else if (updState.status !== 'error') updState = { status: 'latest' };
    return updState;
  } catch (e: any) {
    const msg = String(e?.message ?? e).split('\n')[0].slice(0, 200);
    updState = { status: 'error', error: /net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|超时|404/.test(msg) ? `连不上更新地址（${msg}）。请检查地址是否正确、网络是否可用；不影响正常使用。` : msg };
    return updState;
  }
}

const aborts = new Map<string, AbortController>();

function registerIpc() {
  ipcMain.handle('app:info', () => ({ userData: dataDir(), version: app.getVersion(), platform: process.platform, shot: !!SHOT_DIR, tour: process.env.REFINER_TOUR ?? '', fixtures: process.env.REFINER_FIXTURES ?? '', dark: nativeTheme.shouldUseDarkColors,
    real: process.env.REFINER_REAL_BASE ? { baseUrl: process.env.REFINER_REAL_BASE, model: process.env.REFINER_REAL_MODEL ?? '' } : null }));

  ipcMain.handle('settings:get', async () => {
    let raw: any;
    try { raw = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); } catch { return null; }
    const r = openSettings(raw, cipher);
    // 迁移：旧版本明文保存的 Key，读到后立即加密回写
    if (r.plaintextFound && cipher.available()) await fs.writeFile(settingsFile(), JSON.stringify(sealSettings(r.settings, cipher), null, 2), 'utf8').catch(() => {});
    keepN = Number(r.settings?.backupKeep) || 10;
    return r.settings;
  });
  ipcMain.handle('secure:status', () => ({ available: cipher.available() }));
  ipcMain.handle('backup:list', () => listBackups(dataDir()));
  ipcMain.handle('backup:create', (_e, reason: string) => createBackup(dataDir(), reason || 'manual', keepN));
  ipcMain.handle('backup:restore', (_e, id: string) => restoreBackup(dataDir(), id, keepN));
  ipcMain.handle('backup:openDir', () => { const d = join(dataDir(), 'backups'); mkdirSync(d, { recursive: true }); return shell.openPath(d); });
  ipcMain.handle('import:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], title: '选择已有材料',
      filters: [{ name: '支持的文件', extensions: ['docx', 'pdf', 'md', 'markdown', 'txt', 'xlsx', 'xls', 'csv', 'opml', 'xmind', 'yaml', 'yml', 'json'] }] });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map(async (p) => ({ name: p.split(/[\\/]/).pop()!, data: (await fs.readFile(p)).toString('base64') })));
  });
  ipcMain.handle('import:read', async (_e, p: string) => ({ name: p.split(/[\\/]/).pop()!, data: (await fs.readFile(p)).toString('base64') }));
  ipcMain.handle('ref:fetchUrl', async (_e, url: string) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 JianJinRefiner' } });
      const html = await res.text();
      const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
      const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
      return { ok: res.ok, title, text };
    } catch (e: any) { return { ok: false, error: e?.name === 'AbortError' ? '超时' : String(e?.message ?? e) }; } finally { clearTimeout(t); }
  });
  ipcMain.handle('update:check', async (_e, url: string) => checkUpdate(url));
  ipcMain.handle('win:zoom', (_e, f: number) => { win?.webContents.setZoomFactor(Math.max(0.6, Math.min(2, Number(f) || 1))); return true; });
  ipcMain.handle('update:install', () => { try { autoUpdater.quitAndInstall(); return true; } catch { return false; } });
  ipcMain.handle('settings:set', async (_e, s) => { keepN = Number(s?.backupKeep) || 10; await fs.writeFile(settingsFile(), JSON.stringify(sealSettings(s, cipher), null, 2), 'utf8'); return true; });

  ipcMain.handle('projects:loadAll', async () => {
    ensureDirs();
    const files = (await fs.readdir(projDir())).filter((f) => f.endsWith('.json'));
    const out: unknown[] = [];
    for (const f of files) {
      try { out.push(JSON.parse(await fs.readFile(join(projDir(), f), 'utf8'))); } catch (e) { console.error('坏的项目文件', f, e); }
    }
    return out;
  });
  ipcMain.handle('projects:save', async (_e, p: { id: string }) => {
    ensureDirs();
    const file = join(projDir(), safeName(p.id) + '.json');
    await fs.writeFile(file + '.tmp', JSON.stringify(p), 'utf8');
    await fs.rename(file + '.tmp', file);
    return true;
  });
  ipcMain.handle('projects:delete', async (_e, id: string) => {
    await createBackup(dataDir(), 'before-delete', keepN).catch(() => {});
    await fs.rm(join(projDir(), safeName(id) + '.json'), { force: true });
    return true;
  });

  ipcMain.handle('plugins:list', async () => {
    ensureDirs();
    const files = (await fs.readdir(pluginDir())).filter((f) => /\.(ya?ml|json)$/i.test(f));
    return Promise.all(files.map(async (f) => ({ file: f, text: await fs.readFile(join(pluginDir(), f), 'utf8') })));
  });
  ipcMain.handle('plugins:save', async (_e, id: string, text: string) => {
    ensureDirs();
    await fs.writeFile(join(pluginDir(), safeName(id) + '.yaml'), text, 'utf8');
    return true;
  });
  ipcMain.handle('plugins:delete', async (_e, id: string) => {
    await fs.rm(join(pluginDir(), safeName(id) + '.yaml'), { force: true });
    return true;
  });
  ipcMain.handle('plugins:openDir', async () => { ensureDirs(); await shell.openPath(pluginDir()); return true; });
  ipcMain.handle('data:openDir', async () => { await shell.openPath(dataDir()); return true; });

  ipcMain.handle('ai:chat', async (e, callId: string, cfg: TextConfig, req) => {
    const ctrl = new AbortController();
    aborts.set(callId, ctrl);
    try {
      let usage: { input: number; output: number } | null = null;
      const p = createOpenAIText({ ...cfg, onUsage: (u) => { usage = u; } });
      const text = await p.chat(req, (d) => { if (!e.sender.isDestroyed()) e.sender.send('ai:delta', callId, d); }, ctrl.signal);
      return { text, usage };
    } finally {
      aborts.delete(callId);
    }
  });
  // 模型列表：GET {baseUrl}/models（OpenAI 兼容）；失败返回错误而不抛出
  ipcMain.handle('ai:models', async (_e, cfg: { baseUrl: string; apiKey?: string }) => {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/models', { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const j: any = await r.json();
      const ids = (Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : []).map((x: any) => String(x?.id ?? x?.name ?? x)).filter(Boolean);
      return { ok: true, models: [...new Set(ids as string[])].sort() };
    } catch (e: any) { return { ok: false, error: e?.name === 'AbortError' ? '超时' : String(e?.message ?? e) }; }
  });
  ipcMain.handle('ai:abort', (_e, callId: string) => { aborts.get(callId)?.abort(); return true; });

  ipcMain.handle('ai:image', async (_e, cfg: ImageConfig, req) => {
    const urls = await createOpenAIImage(cfg).generate(req);
    // 远程 URL 通常会过期：下载并内嵌为 data URL，保证项目离线可用、可导出
    return Promise.all(urls.map(async (u) => {
      if (!/^https?:/.test(u)) return u;
      try {
        const r = await fetch(u);
        const buf = Buffer.from(await r.arrayBuffer());
        return `data:${r.headers.get('content-type') ?? 'image/png'};base64,${buf.toString('base64')}`;
      } catch { return u; }
    }));
  });
  ipcMain.handle('ai:videoSubmit', async (_e, cfg: VideoConfig, req) => createHttpVideo(cfg).submit(req));
  ipcMain.handle('ai:videoPoll', async (_e, cfg: VideoConfig, id: string) => createHttpVideo(cfg).poll(id));

  ipcMain.handle('file:save', async (_e, name: string, data: string, encoding: 'utf8' | 'base64') => {
    // 截图/验收模式：不弹对话框，直接写到截图目录（否则自动化会卡住）
    if (SHOT_DIR) {
      await fs.mkdir(SHOT_DIR, { recursive: true });
      const p = join(SHOT_DIR, name.replace(/[\\/:*?"<>|]/g, '_'));
      await fs.writeFile(p, encoding === 'base64' ? Buffer.from(data, 'base64') : data, encoding === 'base64' ? undefined : 'utf8');
      return p;
    }
    const r = await dialog.showSaveDialog(win!, { defaultPath: name });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, encoding === 'base64' ? Buffer.from(data, 'base64') : data, encoding === 'base64' ? undefined : 'utf8');
    return r.filePath;
  });
  ipcMain.handle('file:saveMany', async (_e, files: { name: string; data: string; encoding: 'utf8' | 'base64' }[]) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: '选择保存文件夹' });
    if (r.canceled || !r.filePaths[0]) return null;
    for (const f of files) await fs.writeFile(join(r.filePaths[0], safeName(f.name)), f.encoding === 'base64' ? Buffer.from(f.data, 'base64') : f.data);
    return r.filePaths[0];
  });
  ipcMain.handle('file:open', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: '类型插件', extensions: ['yaml', 'yml', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return fs.readFile(r.filePaths[0], 'utf8');
  });
  ipcMain.handle('shell:external', (_e, url: string) => shell.openExternal(url));
  ipcMain.handle('shell:showItem', (_e, p: string) => { shell.showItemInFolder(p); return true; });
  // 当前视图截图（导出 PNG）：返回 base64
  ipcMain.handle('capture:rect', async (_e, rect: { x: number; y: number; width: number; height: number }) => {
    if (!win) return null;
    const r = { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    const img = await win.webContents.capturePage(r);
    return img.toPNG().toString('base64');
  });

  // 仅截图模式：把当前窗口截图存盘
  ipcMain.handle('debug:capture', async (_e, name: string) => {
    if (!SHOT_DIR || !win) return false;
    const img = await win.webContents.capturePage();
    await fs.mkdir(SHOT_DIR, { recursive: true });
    await fs.writeFile(join(SHOT_DIR, name), img.toPNG());
    return true;
  });
  // 仅截图模式：真实的鼠标点击（经由 Chromium 输入管线），以及把验收数据写盘
  ipcMain.handle('debug:click', async (_e, x: number, y: number, mods?: ('control' | 'shift')[]) => {
    if (!SHOT_DIR || !win) return false;
    const p = { x: Math.round(x), y: Math.round(y), ...(mods?.length ? { modifiers: mods } : {}) };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
    return true;
  });
  // 仅截图模式：真实键盘输入（文字 + 特殊键）与真实拖拽
  ipcMain.handle('debug:keys', async (_e, keys: { text?: string; key?: string; shift?: boolean; ctrl?: boolean }[]) => {
    if (!SHOT_DIR || !win) return false;
    for (const k of keys) {
      if (k.text) { for (const ch of k.text) win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); }
      if (k.key) {
        const modifiers: any[] = [...(k.shift ? ['shift'] : []), ...(k.ctrl ? ['control'] : [])];
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k.key, modifiers });
        if (k.key.length === 1 && !k.ctrl) win.webContents.sendInputEvent({ type: 'char', keyCode: k.key, modifiers });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k.key, modifiers });
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    return true;
  });
  ipcMain.handle('debug:drag', async (_e, x1: number, y1: number, x2: number, y2: number) => {
    if (!SHOT_DIR || !win) return false;
    const R = Math.round;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: R(x1), y: R(y1) });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: R(x1), y: R(y1), button: 'left', clickCount: 1 });
    for (let i = 1; i <= 12; i++) {
      await new Promise((r) => setTimeout(r, 25));
      win.webContents.sendInputEvent({ type: 'mouseMove', x: R(x1 + ((x2 - x1) * i) / 12), y: R(y1 + ((y2 - y1) * i) / 12), button: 'left' } as any);
    }
    await new Promise((r) => setTimeout(r, 120));
    win.webContents.sendInputEvent({ type: 'mouseUp', x: R(x2), y: R(y2), button: 'left', clickCount: 1 });
    return true;
  });
  ipcMain.handle('debug:zoom', () => win?.webContents.getZoomFactor() ?? 1);
  ipcMain.handle('debug:write', async (_e, name: string, text: string) => {
    if (!SHOT_DIR) return false;
    await fs.mkdir(SHOT_DIR, { recursive: true });
    await fs.writeFile(join(SHOT_DIR, name), text, 'utf8');
    return true;
  });
  ipcMain.handle('debug:quit', () => { if (SHOT_DIR) setTimeout(() => app.quit(), 300); });
}

app.whenReady().then(() => {
  ensureDirs();
  registerIpc();
  dailyBackupIfDue(dataDir(), keepN).catch((e) => console.log('backup failed', e));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
