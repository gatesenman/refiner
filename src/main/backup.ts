import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { atomicWrite, replaceDir } from '../core/persist';

/** 自动备份：把 projects/ 与 settings.json 拷到 backups/<时间>-<原因>/；保留最近 N 份 */
export interface BackupInfo { id: string; at: number; reason: string; projects: number; bytes: number }
const REASON: Record<string, string> = { daily: '每日自动', manual: '手动', 'before-delete': '删除前', 'before-restore': '恢复前', 'before-import': '导入前', 'before-rollback': '回退前' };
export const reasonLabel = (r: string) => REASON[r] ?? r;

async function copyDir(src: string, dst: string): Promise<{ files: number; bytes: number }> {
  await fs.mkdir(dst, { recursive: true });
  let files = 0, bytes = 0;
  if (!existsSync(src)) return { files, bytes };
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name);
    if (e.isDirectory()) { const r = await copyDir(s, d); files += r.files; bytes += r.bytes; }
    else { await fs.copyFile(s, d); files++; bytes += (await fs.stat(s)).size; }
  }
  return { files, bytes };
}

export async function listBackups(dataDir: string): Promise<BackupInfo[]> {
  const dir = join(dataDir, 'backups');
  if (!existsSync(dir)) return [];
  const out: BackupInfo[] = [];
  for (const id of await fs.readdir(dir)) {
    try {
      if (!existsSync(join(dir, id, 'projects'))) continue; // 拷贝未完成、没有 projects
      out.push(JSON.parse(await fs.readFile(join(dir, id, 'backup.json'), 'utf8')));
    } catch { /* 不完整的备份忽略 */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

export async function createBackup(dataDir: string, reason: string, keep = 10, now = Date.now()): Promise<BackupInfo> {
  const d = new Date(now);
  const p2 = (x: number) => String(x).padStart(2, '0');
  let id = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${reason}`;
  const dir = join(dataDir, 'backups');
  let k = 1;
  while (existsSync(join(dir, id))) id = id.replace(/(~\d+)?$/, `~${k++}`);
  const target = join(dir, id);
  const r = await copyDir(join(dataDir, 'projects'), join(target, 'projects'));
  if (existsSync(join(dataDir, 'settings.json'))) await fs.copyFile(join(dataDir, 'settings.json'), join(target, 'settings.json'));
  const info: BackupInfo = { id, at: now, reason, projects: r.files, bytes: r.bytes };
  await atomicWrite(join(target, 'backup.json'), JSON.stringify(info));
  await pruneBackups(dataDir, keep);
  return info;
}

export async function pruneBackups(dataDir: string, keep: number) {
  const all = await listBackups(dataDir);
  for (const b of all.slice(Math.max(1, keep))) await fs.rm(join(dataDir, 'backups', b.id), { recursive: true, force: true });
}

/** 距上次备份超过 24 小时则做每日备份 */
export async function dailyBackupIfDue(dataDir: string, keep = 10, now = Date.now()): Promise<BackupInfo | null> {
  const last = (await listBackups(dataDir))[0];
  if (last && now - last.at < 24 * 3600 * 1000) return null;
  if (!existsSync(join(dataDir, 'projects')) || !(await fs.readdir(join(dataDir, 'projects'))).length) return null;
  return createBackup(dataDir, 'daily', keep, now);
}

/** 恢复：先给当前数据做一份“恢复前”备份，再用所选备份覆盖 projects/（设置保留当前的，避免把 Key 恢复成旧值） */
export async function restoreBackup(dataDir: string, id: string, keep = 10): Promise<{ safety: BackupInfo; restored: number }> {
  const src = join(dataDir, 'backups', id, 'projects');
  if (!existsSync(src)) throw new Error('备份不存在或已损坏');
  const safety = await createBackup(dataDir, 'before-restore', keep + 1);
  const r = await replaceDir(src, join(dataDir, 'projects'));
  return { safety, restored: r.files };
}
