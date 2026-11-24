import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', 'src', 'renderer');

function walk(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, acc);
    else if (f.name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

describe('v2.12 可访问性：图标按钮有名称、对话框有角色', () => {
  it('所有 icon-btn 都带 aria-label 或可见文字', () => {
    const missing: string[] = [];
    for (const file of walk(root)) {
      const t = readFileSync(file, 'utf8');
      const re = /<button\b[^>]*>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) {
        const tag = m[0];
        if (!/icon-btn/.test(tag)) continue;
        if (/aria-label=/.test(tag)) continue;
        // 按钮标签内可能有文字，但 icon-btn 一般是纯图标
        missing.push(`${file.slice(root.length + 1)}: ${tag.slice(0, 120)}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });
  it('确认对话框声明 role=dialog、aria-modal、aria-labelledby', () => {
    const t = readFileSync(join(root, 'components/Shell.tsx'), 'utf8');
    expect(t).toMatch(/role="dialog"/);
    expect(t).toMatch(/aria-modal="true"/);
    expect(t).toMatch(/aria-labelledby="app-dialog-title"/);
    expect(t).toMatch(/id="app-dialog-title"/);
    expect(t).toMatch(/autoFocus/);
  });
});
