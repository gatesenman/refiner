import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWrite, replaceFile, loadJsonFile, loadJsonDir, memoryFs, replaceDir } from '../src/core/persist';

const temps: string[] = [];
const mk = async () => {
  const d = await fsp.mkdtemp(join(tmpdir(), 'refiner-p24-'));
  temps.push(d);
  return d;
};
afterEach(async () => {
  for (const d of temps.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

describe('v2.4 原子写入与损坏恢复', () => {
  it('atomicWrite：完整写入后能读回对象', async () => {
    const dir = await mk();
    const f = join(dir, 'p.json');
    await atomicWrite(f, JSON.stringify({ id: 'a', n: 1 }));
    expect(JSON.parse(await fsp.readFile(f, 'utf8'))).toEqual({ id: 'a', n: 1 });
    // 成功后不应留下 .tmp
    await expect(fsp.access(f + '.tmp')).rejects.toThrow();
  });

  it('atomicWrite：覆盖已有文件，旧内容被新内容替换', async () => {
    const dir = await mk();
    const f = join(dir, 'p.json');
    await fsp.writeFile(f, '{"id":"old"}');
    await atomicWrite(f, JSON.stringify({ id: 'new' }));
    expect(JSON.parse(await fsp.readFile(f, 'utf8')).id).toBe('new');
  });

  it('Windows 风格：rename 遇 EEXIST 时经 .bak 替换成功，并清掉 bak', () => {
    const fs = memoryFs({ '/d/p.json': '{"id":"old"}' });
    const origRename = fs.rename;
    // 第一次直接 rename(tmp→dest) 失败（模拟 Windows），之后按 .bak 路径走
    let n = 0;
    fs.rename = async (a, b) => {
      n++;
      if (n === 1 && b === '/d/p.json') {
        const err: any = new Error('EEXIST'); err.code = 'EEXIST'; throw err;
      }
      return origRename(a, b);
    };
    return replaceFile('/d/p.json.tmp', '/d/p.json', fs, 'win32').then(async () => {
      // 还没写 tmp。改测 atomicWrite
    }).catch(() => {/* tmp 不存在，下面用 atomicWrite */})
      .then(async () => {
        const fs2 = memoryFs({ '/d/p.json': '{"id":"old"}' });
        const r0 = fs2.rename;
        let c = 0;
        fs2.rename = async (a, b) => {
          c++;
          // 第一次 tmp→dest 失败
          if (c === 1 && a.endsWith('.tmp') && b === '/d/p.json') {
            const err: any = new Error('EEXIST'); err.code = 'EEXIST'; throw err;
          }
          return r0(a, b);
        };
        await atomicWrite('/d/p.json', '{"id":"new"}', fs2, 'win32');
        expect(JSON.parse(fs2.files['/d/p.json']).id).toBe('new');
        expect(fs2.files['/d/p.json.bak']).toBeUndefined();
        expect(fs2.files['/d/p.json.tmp']).toBeUndefined();
      });
  });

  it('主文件损坏时从 .tmp 恢复，并写回主文件', async () => {
    const dir = await mk();
    const f = join(dir, 'a.json');
    await fsp.writeFile(f, '{坏');
    await fsp.writeFile(f + '.tmp', JSON.stringify({ id: 'ok', from: 'tmp' }));
    const r = await loadJsonFile<{ id: string; from: string }>(f);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe('ok');
      expect(r.recovered).toBe('tmp');
      expect(r.warning).toMatch(/临时文件/);
    }
    expect(JSON.parse(await fsp.readFile(f, 'utf8')).from).toBe('tmp');
  });

  it('主文件缺失时从 .bak 恢复', async () => {
    const dir = await mk();
    const f = join(dir, 'b.json');
    await fsp.writeFile(f + '.bak', JSON.stringify({ id: 'bak' }));
    const r = await loadJsonFile<{ id: string }>(f);
    expect(r.ok && r.value.id).toBe('bak');
    if (r.ok) expect(r.recovered).toBe('bak');
  });

  it('主文件完好时优先用主文件，并清理残留 .tmp', async () => {
    const dir = await mk();
    const f = join(dir, 'c.json');
    await fsp.writeFile(f, JSON.stringify({ id: 'main' }));
    await fsp.writeFile(f + '.tmp', JSON.stringify({ id: 'stale' }));
    const r = await loadJsonFile<{ id: string }>(f);
    expect(r.ok && r.value.id).toBe('main');
    if (r.ok) expect(r.recovered).toBeUndefined();
    await expect(fsp.access(f + '.tmp')).rejects.toThrow();
  });

  it('loadJsonDir：坏文件跳过、孤立 tmp 被收进来，并汇总警告', async () => {
    const dir = await mk();
    await fsp.writeFile(join(dir, 'good.json'), JSON.stringify({ id: 'g' }));
    await fsp.writeFile(join(dir, 'bad.json'), '{');
    await fsp.writeFile(join(dir, 'orphan.json.tmp'), JSON.stringify({ id: 'o' }));
    const r = await loadJsonDir<{ id: string }>(dir);
    const ids = r.items.map((x) => x.id).sort();
    expect(ids).toEqual(['g', 'o']);
    expect(r.recovered).toBe(1);
    expect(r.skipped).toContain('bad.json');
    expect(r.warnings.some((w) => /bad\.json/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /临时文件/.test(w))).toBe(true);
  });

  it('replaceDir：用新目录替换旧目录，旧内容不再出现；失败可测旁路目录被清', async () => {
    const root = await mk();
    const dest = join(root, 'projects');
    const src = join(root, 'from');
    await fsp.mkdir(dest); await fsp.writeFile(join(dest, 'old.json'), '{"id":"old"}');
    await fsp.mkdir(src); await fsp.writeFile(join(src, 'new.json'), '{"id":"new"}');
    const r = await replaceDir(src, dest);
    expect(r.files).toBe(1);
    const names = await fsp.readdir(dest);
    expect(names).toEqual(['new.json']);
    expect(JSON.parse(await fsp.readFile(join(dest, 'new.json'), 'utf8')).id).toBe('new');
    await expect(fsp.access(dest + '.next')).rejects.toThrow();
    await expect(fsp.access(dest + '.prev')).rejects.toThrow();
  });
});
