import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { parseManifest, isIconName, DEFAULT_TYPE_ICON, DEFAULT_ROLES } from '../src/core';
import { ICON_NAMES } from '../src/renderer/icons/names';

/**
 * 图标规范：界面只用离线打包的图标字体（Remix Icon），不用 emoji / 文字符号充当图标。
 * Windows 上没有彩色 emoji 字体时 emoji 会显示为方框（豆腐块），图标字体则处处一致。
 */
const ROOT = join(__dirname, '..');
const SET = new Set(ICON_NAMES);
// emoji（Extended_Pictographic）+ 常被当作图标的符号块：箭头、技术符号、几何图形、杂项符号、丁巴特、补充箭头
const ICONISH = /[\p{Extended_Pictographic}\u{FE0F}\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\u2900-\u297F\u2B00-\u2BFF\uFF0B\uFF0D]/u;
// 例外：正文中的“→”作为文字箭头（如“生成 → 细化 → 调整”）属于标点，不是图标
const PROSE_OK = /→/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function offenders(files: string[]) {
  const bad: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const l = line.replace(PROSE_OK, '');
      const m = l.match(ICONISH);
      if (m) bad.push(`${f.replace(ROOT, '')}:${i + 1} 「${m[0]}」`);
    });
  }
  return bad;
}
const plugins = readdirSync(join(ROOT, 'plugins')).filter((f) => f.endsWith('.yaml')).map((f) => join(ROOT, 'plugins', f));

describe('图标集（离线矢量图标）', () => {
  it('图标集已离线打包（SVG 符号表 + 名称表），与名称表一一对应、不引用在线资源', () => {
    const svg = readFileSync(join(ROOT, 'src/renderer/icons/remixicon.symbol.svg'), 'utf8');
    const ids = [...svg.matchAll(/<symbol[^>]*\sid="(ri-[^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(2000);
    expect(new Set(ids)).toEqual(SET);
    expect(svg).not.toMatch(/(href|src)="https?:/); // 只有注释里的出处链接，没有外部引用
    expect(existsSync(join(ROOT, 'src/renderer/icons/LICENSE-remixicon.txt'))).toBe(true);
  });

  it('所有内置插件的 icon（类型与角色）都是存在的图标名', () => {
    const reg = new Map<string, any>();
    for (const f of plugins) {
      const r = parseManifest(readFileSync(f, 'utf8'), (id) => reg.get(id));
      if (r.manifest) reg.set(r.manifest.id, r.manifest);
      expect(r.errors, f).toEqual([]);
      const m = r.manifest!;
      expect(isIconName(m.icon), `${f} icon=${m.icon}`).toBe(true);
      expect(SET.has(m.icon!), `${f} icon=${m.icon}`).toBe(true);
      expect(r.warnings.join(), f).not.toMatch(/不是图标名/);
      for (const [rid, role] of Object.entries(m.roles ?? {})) if (role.icon) expect(SET.has(role.icon), `${f} role ${rid}`).toBe(true);
    }
    for (const [rid, role] of Object.entries(DEFAULT_ROLES)) expect(SET.has(role.icon!), rid).toBe(true);
    expect(SET.has(DEFAULT_TYPE_ICON)).toBe(true);
  });

  it('插件清单与界面源码中没有 emoji / 符号图标', () => {
    const src = walk(join(ROOT, 'src')).filter((f) => ['.ts', '.tsx'].includes(extname(f)) && !f.endsWith('names.ts'));
    expect(offenders([...plugins, ...src])).toEqual([]);
  });

  it('界面引用的图标名都存在于图标集中', () => {
    const missing = new Set<string>();
    for (const f of walk(join(ROOT, 'src/renderer')).filter((x) => /\.tsx?$/.test(x) && !x.endsWith('names.ts'))) {
      for (const n of readFileSync(f, 'utf8').match(/\bri-[a-z0-9]+(?:-[a-z0-9]+)*\b/g) ?? []) if (!SET.has(n)) missing.add(n);
    }
    expect([...missing]).toEqual([]);
  });

  it('旧式 emoji 或未知值的 icon 会给出警告并回退为默认图标（向后兼容）', () => {
    const y = `id: legacy\nname: 旧插件\nicon: 📚\nrenderer: tree\nroles:\n  extra: { name: 额外, icon: "🛡️", output: review, system: s, task: t }\npipeline:\n  steps:\n    - { id: g, role: generator }\n    - { id: x, role: extra, needs: [g] }\n`;
    const r = parseManifest(y);
    expect(r.errors).toEqual([]);
    expect(r.manifest!.icon).toBe(DEFAULT_TYPE_ICON);
    expect(r.warnings.join()).toMatch(/不是图标名/);
    expect(r.manifest!.roles?.extra?.icon).toBeUndefined();
    expect(parseManifest(y.replace('icon: 📚', 'icon: ri-book-2-line')).manifest!.icon).toBe('ri-book-2-line');
  });
});
