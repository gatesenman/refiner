import { contextBridge, ipcRenderer } from 'electron';

const deltaHandlers = new Map<string, (d: string) => void>();
ipcRenderer.on('ai:delta', (_e, callId: string, d: string) => deltaHandlers.get(callId)?.(d));

const api = {
  info: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s: unknown) => ipcRenderer.invoke('settings:set', s),
  loadProjects: () => ipcRenderer.invoke('projects:loadAll'),
  saveProject: (p: unknown) => ipcRenderer.invoke('projects:save', p),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  savePlugin: (id: string, text: string) => ipcRenderer.invoke('plugins:save', id, text),
  deletePlugin: (id: string) => ipcRenderer.invoke('plugins:delete', id),
  openPluginDir: () => ipcRenderer.invoke('plugins:openDir'),
  openDataDir: () => ipcRenderer.invoke('data:openDir'),
  listModels: (cfg: unknown) => ipcRenderer.invoke('ai:models', cfg),
  chat: async (callId: string, cfg: unknown, req: unknown, onDelta?: (d: string) => void) => {
    if (onDelta) deltaHandlers.set(callId, onDelta);
    try { return await ipcRenderer.invoke('ai:chat', callId, cfg, req); } finally { deltaHandlers.delete(callId); }
  },
  abort: (callId: string) => ipcRenderer.invoke('ai:abort', callId),
  image: (cfg: unknown, req: unknown) => ipcRenderer.invoke('ai:image', cfg, req),
  videoSubmit: (cfg: unknown, req: unknown) => ipcRenderer.invoke('ai:videoSubmit', cfg, req),
  videoPoll: (cfg: unknown, id: string) => ipcRenderer.invoke('ai:videoPoll', cfg, id),
  saveFile: (name: string, data: string, encoding: 'utf8' | 'base64' = 'utf8') => ipcRenderer.invoke('file:save', name, data, encoding),
  saveMany: (files: unknown) => ipcRenderer.invoke('file:saveMany', files),
  openFile: () => ipcRenderer.invoke('file:open'),
  external: (url: string) => ipcRenderer.invoke('shell:external', url),
  showInFolder: (p: string) => ipcRenderer.invoke('shell:showItem', p),
  captureRect: (rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('capture:rect', rect),
  capture: (name: string) => ipcRenderer.invoke('debug:capture', name),
  quit: () => ipcRenderer.invoke('debug:quit'),
  click: (x: number, y: number, mods?: ('control' | 'shift')[]) => ipcRenderer.invoke('debug:click', x, y, mods),
  secureStatus: () => ipcRenderer.invoke('secure:status'),
  backups: () => ipcRenderer.invoke('backup:list'),
  backup: (reason: string) => ipcRenderer.invoke('backup:create', reason),
  restoreBackup: (id: string) => ipcRenderer.invoke('backup:restore', id),
  openBackupDir: () => ipcRenderer.invoke('backup:openDir'),
  importPick: () => ipcRenderer.invoke('import:pick'),
  importRead: (p: string) => ipcRenderer.invoke('import:read', p),
  fetchUrl: (url: string) => ipcRenderer.invoke('ref:fetchUrl', url),
  checkUpdate: (url: string) => ipcRenderer.invoke('update:check', url),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (fn: (s: any) => void) => { const h = (_e: unknown, s: any) => fn(s); ipcRenderer.on('update:state', h); return () => { ipcRenderer.removeListener('update:state', h); }; },
  zoom: (f: number) => ipcRenderer.invoke('win:zoom', f),
  keys: (k: { text?: string; key?: string; shift?: boolean; ctrl?: boolean }[]) => ipcRenderer.invoke('debug:keys', k),
  drag: (x1: number, y1: number, x2: number, y2: number) => ipcRenderer.invoke('debug:drag', x1, y1, x2, y2),
  zoomFactor: () => ipcRenderer.invoke('debug:zoom'),
  write: (name: string, text: string) => ipcRenderer.invoke('debug:write', name, text),
};

contextBridge.exposeInMainWorld('api', api);
export type Api = typeof api;
