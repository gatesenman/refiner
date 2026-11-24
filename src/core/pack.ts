/**
 * v2.3 更有用的本地导出（无需账号）：
 * - 自包含 HTML（系统字体，可离线打开、打印、发给没有本应用的人）
 * - Markdown 表格（一级部分为表，列=标题/说明/属性）
 * - 交接包：多个开放格式打成一份清单，由渲染进程再打 zip
 */
import type { ArtNode, Artifact, TypeManifest } from './types';
import { walk, normalizeNode } from './tree';
import { toJSONCanvas, toMermaid, fromJSONCanvas } from './interop';
import { readiness, maturityMap } from './maturity';

export interface PackFile { name: string; text: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function mdEscapeCell(s: string) { return s.replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim(); }

/** 每个一级部分一张 Markdown 表 */
export function toMdTable(root: ArtNode, m: TypeManifest): string {
  const props = (m.nodeSchema?.props ?? []).slice(0, 6);
  const lines: string[] = [`# ${root.title}`, ''];
  if (root.content?.trim()) lines.push(root.content.trim(), '');
  const parts = root.children?.length ? root.children : [root];
  for (const part of parts) {
    if (root.children?.length) lines.push(`## ${part.title}`, '');
    const rows: ArtNode[] = [];
    walk(part, (n) => { if (n !== part || !root.children?.length) rows.push(n); });
    if (!rows.length) { lines.push('（空）', ''); continue; }
    const heads = ['标题', '说明', ...props.map((p) => p.label)];
    lines.push('| ' + heads.join(' | ') + ' |');
    lines.push('| ' + heads.map(() => '---').join(' | ') + ' |');
    for (const n of rows) {
      const cells = [mdEscapeCell(n.title), mdEscapeCell(n.content ?? ''), ...props.map((p) => mdEscapeCell(n.props?.[p.key] != null ? String(n.props[p.key]) : ''))];
      lines.push('| ' + cells.join(' | ') + ' |');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderHtmlNode(n: ArtNode, d: number, mm: ReturnType<typeof maturityMap>): string {
  const lv = mm.get(n.id)?.level;
  const color = lv === 'rough' ? '#d97706' : lv === 'medium' ? '#ca8a04' : lv === 'detailed' ? '#16a34a' : 'transparent';
  const kids = (n.children ?? []).map((c) => renderHtmlNode(c, d + 1, mm)).join('');
  const body = n.content?.trim() ? `<p>${esc(n.content).replace(/\n/g, '<br>')}</p>` : '';
  const props = n.props && Object.keys(n.props).length
    ? `<div class="props">${Object.entries(n.props).filter(([, v]) => v != null && v !== '').map(([k, v]) => `<span>${esc(k)}：${esc(String(v))}</span>`).join('')}</div>` : '';
  return `<section class="n d${d}" style="border-left-color:${color}"><h${Math.min(d + 1, 5)}>${esc(n.title)}</h${Math.min(d + 1, 5)}>${body}${props}${kids}</section>`;
}

/** 自包含 HTML，系统字体，可离线打开 */
export function toHtml(root: ArtNode, m: TypeManifest, a?: Artifact): string {
  const r = readiness(root, m);
  const mm = maturityMap(root, m);
  const mer = toMermaid(root, m);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(root.title)}</title>
<style>
  body{font:16px/1.6 system-ui,-apple-system,"Segoe UI","PingFang SC","Noto Sans SC",sans-serif;color:#1c1917;background:#fafaf9;margin:0;padding:32px 20px 64px;max-width:880px;margin-inline:auto}
  h1{font-size:1.6rem;margin:0 0 8px} .meta{color:#57534e;font-size:.9rem;margin-bottom:24px}
  section.n{border-left:3px solid #d6d3d1;padding:0 0 0 12px;margin:10px 0}
  section.n h2,section.n h3,section.n h4,section.n h5{margin:0 0 4px;font-size:1.05rem}
  p{margin:0 0 6px;white-space:pre-wrap} .props{display:flex;gap:12px;flex-wrap:wrap;color:#57534e;font-size:.85rem;margin-bottom:6px}
  pre{background:#f5f5f4;border:1px solid #e7e5e4;border-radius:8px;padding:12px;overflow:auto;font-size:.85rem}
</style></head><body>
<h1>${esc(root.title)}</h1>
<div class="meta">就绪 ${r.percent}% · ${r.items} 项${a?.seed ? ' · 来自：「' + esc(a.seed).slice(0, 80) + '」' : ''} · 由渐进 Refiner 导出</div>
${(root.children ?? []).map((c) => renderHtmlNode(c, 1, mm)).join('\n')}
${mer.text ? `<h2>结构图（${mer.kind === 'gantt' ? '甘特' : '脑图'}，Mermaid）</h2><pre>${esc(mer.text)}</pre>` : ''}
</body></html>
`;
}

/** 交接包内的多个文本文件（zip 由调用方打包） */
export function packFiles(a: Artifact, m: TypeManifest, md?: string, csv?: string): PackFile[] {
  const root = a.root;
  const files: PackFile[] = [
    { name: 'overview.html', text: toHtml(root, m, a) },
    { name: 'table.md', text: toMdTable(root, m) },
    { name: 'board.canvas', text: JSON.stringify(toJSONCanvas(root, m), null, 2) },
    { name: 'diagram.mmd', text: toMermaid(root, m).text },
  ];
  if (md) files.unshift({ name: 'outline.md', text: md });
  if (csv) files.push({ name: 'table.csv', text: csv });
  files.push({ name: 'README.txt', text: `「${root.title}」交接包（由渐进 Refiner 导出）\n\n- overview.html  用浏览器打开即可阅读/打印\n- outline.md / table.md / table.csv  正文与表格\n- board.canvas  可导入 Obsidian 等白板\n- diagram.mmd  Mermaid 图（甘特或脑图）\n` });
  return files;
}



function parseOutlineMd(md: string): ArtNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const root: ArtNode = { id: 'root', title: '导入', children: [] };
  const stack: { d: number; n: ArtNode }[] = [{ d: 0, n: root }];
  let pending = root;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const d = h[1].length;
      const n: ArtNode = { id: '', title: h[2].trim(), children: [] };
      while (stack.length && stack[stack.length - 1].d >= d) stack.pop();
      const parent = stack[stack.length - 1]?.n ?? root;
      parent.children = [...(parent.children ?? []), n];
      stack.push({ d, n });
      pending = n;
      if (d === 1 && root.title === '导入' && !(root.children && root.children.length > 1)) {
        // 第一级标题作为根，不要再套一层
        root.title = n.title;
        root.children = n.children ?? [];
        pending = root;
        stack.pop();
        stack.push({ d, n: root });
        continue;
      }
    } else if (line.trim() && pending) {
      pending.content = (pending.content ? pending.content + '\n' : '') + line.trim();
    }
  }
  return normalizeNode(root.title === '导入' && root.children?.length === 1 ? root.children[0] : root);
}

function parseMdTable(md: string): ArtNode {
  // 退路：每个 ## 一节，表格行变子项
  return parseOutlineMd(md.replace(/^\|\s*标题\s*\|.*$/gm, '').replace(/^\|\s*---.*$/gm, '').replace(/^\|\s*([^|]+)\s*\|\s*([^|]*)\|?/gm, '### $1\n$2'));
}

/** 从交接包内的文本文件还原树。优先 board.canvas，其次 outline.md / table.md。 */
export function importPackFiles(files: { name: string; text: string }[]): { root: ArtNode; source: string; notes: string[] } {
  const by = Object.fromEntries(files.map((f) => [f.name.replace(/^.*[/\\]/, '').toLowerCase(), f.text]));
  const notes: string[] = [];
  const canvas = by['board.canvas'];
  if (canvas) {
    try {
      const doc = JSON.parse(canvas);
      const root = fromJSONCanvas(doc);
      if (!root.title && !root.children?.length) throw new Error('空');
      return { root: normalizeNode(root), source: 'board.canvas', notes };
    } catch (e: any) { notes.push(`白板解析失败：${String(e?.message ?? e).slice(0, 80)}，改试其他文件`); }
  }
  if (by['outline.md']?.trim()) return { root: parseOutlineMd(by['outline.md']), source: 'outline.md', notes };
  if (by['table.md']?.trim()) return { root: parseMdTable(by['table.md']), source: 'table.md', notes };
  throw new Error('交接包里没有可导入的 board.canvas / outline.md / table.md');
}
