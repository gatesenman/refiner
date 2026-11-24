/**
 * v2.4 文件可靠性（纯 Node，不依赖 Electron / UI）：
 * - 先写临时文件再替换，避免写到一半停电留下半截 JSON；
 * - Windows 上 rename 不能覆盖已有文件，用“先把旧文件挪到 .bak 再换上新文件”；
 * - 读取时若主文件损坏或缺失，尝试恢复 .tmp / .bak。
 */
import { promises as fsp, existsSync } from 'fs';
import { basename, dirname, join } from 'path';

export type PersistFs = {
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, opts?: { force?: boolean }): Promise<void>;
  readFile(path: string, enc: 'utf8'): Promise<string>;
  mkdir?(path: string, opts?: { recursive?: boolean }): Promise<unknown>;
  readdir?(path: string): Promise<string[]>;
  /** 可选：打开后 fsync。缺省时退化为 writeFile */
  open?: (path: string, flags: string) => Promise<{
    writeFile(data: string): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;
};

const real: PersistFs = {
  writeFile: (p, d) => fsp.writeFile(p, d, 'utf8'),
  rename: (a, b) => fsp.rename(a, b),
  rm: (p, o) => fsp.rm(p, { force: true, ...o }),
  readFile: (p, enc) => fsp.readFile(p, enc),
  mkdir: (p, o) => fsp.mkdir(p, o),
  readdir: (p) => fsp.readdir(p),
  open: (p, flags) => fsp.open(p, flags) as unknown as ReturnType<NonNullable<PersistFs['open']>>,
};

export const replaceErrors = new Set(['EEXIST', 'EPERM', 'EACCES']);

export async function replaceFile(tmp: string, dest: string, fs: PersistFs = real, platform: string = process.platform): Promise<void> {
  try {
    await fs.rename(tmp, dest);
    return;
  } catch (e: any) {
    const code = String(e?.code ?? '');
    const needSwap = platform === 'win32' || replaceErrors.has(code);
    if (!needSwap) throw e;
  }
  const bak = dest + '.bak';
  await fs.rm(bak, { force: true }).catch(() => {});
  try { await fs.rename(dest, bak); } catch { /* dest 可能本来就不存在 */ }
  try {
    await fs.rename(tmp, dest);
  } catch (e) {
    // 换上失败则尽量把旧文件挪回来
    try { await fs.rename(bak, dest); } catch { /* 保持现状 */ }
    throw e;
  }
  await fs.rm(bak, { force: true }).catch(() => {});
}

/** 原子写入文本。成功后目标文件要么是完整新内容，要么保持原样。 */
export async function atomicWrite(file: string, data: string, fs: PersistFs = real, platform: string = process.platform): Promise<void> {
  const tmp = file + '.tmp';
  if (fs.open) {
    const fh = await fs.open(tmp, 'w');
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
  } else {
    await fs.writeFile(tmp, data);
  }
  await replaceFile(tmp, file, fs, platform);
}

export type LoadJsonOk<T> = { ok: true; value: T; recovered?: 'tmp' | 'bak'; warning?: string };
export type LoadJsonFail = { ok: false; error: string };
export type LoadJson<T> = LoadJsonOk<T> | LoadJsonFail;

function parseJson<T>(text: string, label: string): T {
  const v = JSON.parse(text) as T;
  if (v === null || typeof v !== 'object') throw new Error(`${label}不是对象`);
  return v;
}

/** 读 JSON：主文件损坏或缺失时，尝试 .tmp、.bak；恢复成功可把好内容写回主文件。 */
export async function loadJsonFile<T>(file: string, fs: PersistFs = real, opts: { rewrite?: boolean; platform?: string } = {}): Promise<LoadJson<T>> {
  const rewrite = opts.rewrite !== false;
  const platform = opts.platform ?? process.platform;
  const tryRead = async (p: string): Promise<T | undefined> => {
    try {
      return parseJson<T>(await fs.readFile(p, 'utf8'), basename(p));
    } catch {
      return undefined;
    }
  };
  const main = await tryRead(file);
  if (main !== undefined) {
    await fs.rm(file + '.tmp', { force: true }).catch(() => {});
    return { ok: true, value: main };
  }
  for (const kind of ['tmp', 'bak'] as const) {
    const side = kind === 'tmp' ? file + '.tmp' : file + '.bak';
    const v = await tryRead(side);
    if (v === undefined) continue;
    if (rewrite) {
      try { await atomicWrite(file, JSON.stringify(v), fs, platform); } catch { /* 读出来就算恢复成功 */ }
    }
    return { ok: true, value: v, recovered: kind, warning: `「${basename(file)}」已从${kind === 'tmp' ? '未写完的临时文件' : '替换前的备份'}恢复` };
  }
  return { ok: false, error: existsHint(file) };
}

function existsHint(file: string): string {
  return `「${basename(file)}」无法读取（文件缺失或已损坏）`;
}

export interface DirLoad<T> {
  items: T[];
  warnings: string[];
  recovered: number;
  skipped: string[];
}

/**
 * 读取目录下所有 `.json`（不含 .tmp/.bak）。
 * 对每个基名尝试恢复；孤立的 `.json.tmp`（没有对应主文件或主文件坏了）也会被收进来。
 */
export async function loadJsonDir<T>(dir: string, fs: PersistFs = real, opts: { rewrite?: boolean; platform?: string } = {}): Promise<DirLoad<T>> {
  const names = fs.readdir ? await fs.readdir(dir).catch(() => [] as string[]) : [];
  const bases = new Set<string>();
  for (const n of names) {
    if (n.endsWith('.json.tmp')) bases.add(n.slice(0, -4)); // file.json.tmp → file.json
    else if (n.endsWith('.json.bak')) bases.add(n.slice(0, -4));
    else if (n.endsWith('.json')) bases.add(n);
  }
  const items: T[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  let recovered = 0;
  for (const base of [...bases].sort()) {
    const r = await loadJsonFile<T>(join(dir, base), fs, opts);
    if (r.ok) {
      items.push(r.value);
      if (r.recovered) { recovered++; if (r.warning) warnings.push(r.warning); }
    } else {
      skipped.push(base);
      warnings.push(r.error);
    }
  }
  return { items, warnings, recovered, skipped };
}

/** 把 source 目录完整拷到 dest（dest 必须事先不存在或已被清空）。供事务性恢复使用。 */
export async function copyDir(src: string, dest: string, fs: PersistFs & { statSize?: (p: string) => Promise<number>; isDir?: (p: string) => Promise<boolean> } = real): Promise<{ files: number; bytes: number }> {
  await (fs.mkdir ?? fsp.mkdir)(dest, { recursive: true });
  let files = 0, bytes = 0;
  const entries = fs.readdir ? await fs.readdir(src).catch(() => [] as string[]) : await fsp.readdir(src);
  for (const name of entries) {
    const s = join(src, name), d = join(dest, name);
    let dir = false;
    try {
      if (fs.isDir) dir = await fs.isDir(s);
      else dir = (await fsp.stat(s)).isDirectory();
    } catch { continue; }
    if (dir) {
      const r = await copyDir(s, d, fs);
      files += r.files; bytes += r.bytes;
    } else {
      const text = await fs.readFile(s, 'utf8').catch(async () => {
        const buf = await fsp.readFile(s);
        await fsp.writeFile(d, buf);
        files++; bytes += buf.length;
        return null as unknown as string;
      });
      if (text != null) {
        await fs.writeFile(d, text);
        files++;
        bytes += Buffer.byteLength(text);
      }
    }
  }
  return { files, bytes };
}

/**
 * 事务性地用 src 替换 dest 目录：先拷到 dest.next，再把 dest 挪到 dest.prev，再把 dest.next 改名为 dest。
 * 失败时尽量把 dest.prev 挪回 dest。
 */
export async function replaceDir(src: string, dest: string, fs: PersistFs = real): Promise<{ files: number; bytes: number }> {
  const next = dest + '.next';
  const prev = dest + '.prev';
  await fs.rm(next, { force: true }).catch(() => {});
  // rm of a dir may need recursive — use real fs when available
  try { await fsp.rm(next, { recursive: true, force: true }); } catch { /* */ }
  try { await fsp.rm(prev, { recursive: true, force: true }); } catch { /* */ }
  const r = await copyDir(src, next, fs);
  const destExisted = existsSync(dest);
  if (destExisted) {
    try { await fsp.rename(dest, prev); }
    catch {
      // Windows: 目录 rename 失败时逐级处理
      await fsp.rm(prev, { recursive: true, force: true });
      await fsp.rename(dest, prev);
    }
  }
  try {
    await fsp.rename(next, dest);
  } catch (e) {
    if (destExisted) {
      try { await fsp.rm(dest, { recursive: true, force: true }); } catch { /* */ }
      try { await fsp.rename(prev, dest); } catch { /* */ }
    }
    throw e;
  }
  try { await fsp.rm(prev, { recursive: true, force: true }); } catch { /* */ }
  return r;
}

/** 方便测试时构造可注入的内存文件系统 */
export function memoryFs(init: Record<string, string> = {}): PersistFs & { files: Record<string, string> } {
  const files: Record<string, string> = { ...init };
  const fs: PersistFs & { files: Record<string, string> } = {
    files,
    writeFile: async (p, d) => { files[p] = d; },
    rename: async (a, b) => {
      if (!(a in files)) { const err: any = new Error('ENOENT'); err.code = 'ENOENT'; throw err; }
      if (b in files) { const err: any = new Error('EEXIST'); err.code = 'EEXIST'; throw err; }
      files[b] = files[a];
      delete files[a];
    },
    rm: async (p) => { delete files[p]; },
    readFile: async (p) => {
      if (!(p in files)) { const err: any = new Error('ENOENT'); err.code = 'ENOENT'; throw err; }
      return files[p];
    },
    readdir: async (dir) => {
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      const names = new Set<string>();
      for (const k of Object.keys(files)) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && !rest.includes('/')) names.add(rest);
        } else if (dirname(k) === dir || dirname(k) + '/' === prefix) {
          names.add(basename(k));
        }
      }
      return [...names];
    },
    mkdir: async () => {},
  };
  return fs;
}
