import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createBackup, listBackups, restoreBackup, dailyBackupIfDue } from '../src/main/backup';

const temps: string[] = [];
const mk = async () => { const d = await fsp.mkdtemp(join(tmpdir(), 'refiner-p25-')); temps.push(d); return d; };
afterEach(async () => { for (const d of temps.splice(0)) await fsp.rm(d, { recursive: true, force: true }); });

async function seed(dataDir: string, files: Record<string, string>) {
  const proj = join(dataDir, 'projects');
  await fsp.mkdir(proj, { recursive: true });
  for (const [n, c] of Object.entries(files)) await fsp.writeFile(join(proj, n), c);
}

describe('v2.5 备份恢复事务化', () => {
  it('createBackup 后 list 能看到，且含 projects 与 backup.json', async () => {
    const d = await mk();
    await seed(d, { 'a.json': '{"id":"a"}' });
    const b = await createBackup(d, 'manual', 10, 1_700_000_000_000);
    expect(b.reason).toBe('manual');
    expect(b.projects).toBe(1);
    const list = await listBackups(d);
    expect(list.map((x) => x.id)).toContain(b.id);
    expect(existsSync(join(d, 'backups', b.id, 'projects', 'a.json'))).toBe(true);
  });

  it('不完整备份（缺 projects）不会出现在列表里', async () => {
    const d = await mk();
    await seed(d, { 'a.json': '{"id":"a"}' });
    const ghost = join(d, 'backups', '20990101-000000-manual');
    await fsp.mkdir(ghost, { recursive: true });
    await fsp.writeFile(join(ghost, 'backup.json'), JSON.stringify({ id: '20990101-000000-manual', at: 9e12, reason: 'manual', projects: 0, bytes: 0 }));
    const list = await listBackups(d);
    expect(list.find((x) => x.id.includes('20990101'))).toBeUndefined();
  });

  it('restoreBackup：当前数据被所选备份替换，并留下“恢复前”备份以便反悔', async () => {
    const d = await mk();
    await seed(d, { 'old.json': '{"id":"old"}' });
    const b = await createBackup(d, 'manual', 10, 1_700_000_000_000);
    // 改当前数据
    await fsp.writeFile(join(d, 'projects', 'old.json'), '{"id":"changed"}');
    await fsp.writeFile(join(d, 'projects', 'extra.json'), '{"id":"extra"}');
    const r = await restoreBackup(d, b.id, 10);
    expect(r.restored).toBe(1);
    const names = (await fsp.readdir(join(d, 'projects'))).sort();
    expect(names).toEqual(['old.json']);
    expect(JSON.parse(await fsp.readFile(join(d, 'projects', 'old.json'), 'utf8')).id).toBe('old');
    // 恢复前备份里应有改动后的内容
    expect(existsSync(join(d, 'backups', r.safety.id, 'projects', 'extra.json'))).toBe(true);
    expect(JSON.parse(await fsp.readFile(join(d, 'backups', r.safety.id, 'projects', 'old.json'), 'utf8')).id).toBe('changed');
    // 旁路目录必须清掉
    expect(existsSync(join(d, 'projects.next'))).toBe(false);
    expect(existsSync(join(d, 'projects.prev'))).toBe(false);
  });

  it('dailyBackupIfDue：24 小时内不重复；没有项目时不做', async () => {
    const empty = await mk();
    expect(await dailyBackupIfDue(empty, 10, 1_700_000_000_000)).toBeNull();
    const d = await mk();
    await seed(d, { 'a.json': '{"id":"a"}' });
    const first = await dailyBackupIfDue(d, 10, 1_700_000_000_000);
    expect(first?.reason).toBe('daily');
    const again = await dailyBackupIfDue(d, 10, 1_700_000_000_000 + 1000);
    expect(again).toBeNull();
    const later = await dailyBackupIfDue(d, 10, 1_700_000_000_000 + 25 * 3600 * 1000);
    expect(later?.reason).toBe('daily');
  });
});
