import { dump as yamlDump } from 'js-yaml';
import { flatten, walk, toJSONCanvas, toMermaid, toHtml, toMdTable, packFiles } from '../core';
import type { Artifact, ArtNode, TypeManifest } from '../core';
import { mindmapSVG } from './renderers/Mindmap';
import { toDocx, bytesToBase64 } from './docx';

export const EXPORTER_LABEL: Record<string, string> = {
  copy: '复制到剪贴板（Markdown）', docx: 'Word 文档 (.docx)', viewpng: '当前视图图片 (.png)',
  markdown: 'Markdown (.md)', json: 'JSON (.json)', csv: 'CSV 表格 (.csv)', yaml: 'YAML (.yaml)', opml: 'OPML 大纲 (.opml)', canvas: '白板 JSON Canvas (.canvas，Obsidian 等)', mermaid: 'Mermaid 图（甘特 / 脑图，.mmd）',
  html: '网页 HTML（可离线打开、打印）', mdtable: 'Markdown 表格 (.md)', pack: '交接包（.zip，含 HTML/表格/白板/图）',
  svg: '脑图 SVG (.svg)', png: '脑图 PNG (.png)', images: '全部图片（文件夹）', text: '纯文本',
};

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'export';

export function toMarkdown(root: ArtNode, m: TypeManifest): string {
  if (m.output === 'text') return '```' + (m.language ?? '') + '\n' + (root.content ?? '') + '\n```\n';
  const props = m.nodeSchema?.props ?? [];
  const lines: string[] = [`# ${root.title}`, ''];
  if (root.content) lines.push(root.content, '');
  walk(root, (n, _p, d) => {
    if (d === 0) return;
    const pv = props.filter((p) => n.props?.[p.key] != null && p.key !== 'url').map((p) => `${p.label}：${String(n.props![p.key])}`).join(' · ');
    if (d <= 2) {
      lines.push(`${'#'.repeat(d + 1)} ${n.title}`);
      if (pv) lines.push(`> ${pv}`);
      if (n.content) lines.push('', n.content);
      lines.push('');
    } else {
      lines.push(`${'  '.repeat(d - 3)}- **${n.title}**${n.content ? '：' + n.content.replace(/\n/g, ' ') : ''}${pv ? `（${pv}）` : ''}`);
    }
  });
  return lines.join('\n');
}

export function toCSV(root: ArtNode, m: TypeManifest): string {
  const props = (m.nodeSchema?.props ?? []).filter((p) => p.type !== 'url');
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['层级', '分组', '标题', '说明', ...props.map((p) => p.label)];
  const rows = flatten(root).map(({ node, path, depth }) => [depth, path.join(' / '), node.title, node.content ?? '', ...props.map((p) => node.props?.[p.key])]);
  return '\ufeff' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function toOPML(root: ArtNode): string {
  const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]!));
  const rec = (n: ArtNode): string => `<outline text="${esc(n.title)}"${n.content ? ` _note="${esc(n.content)}"` : ''}>${(n.children ?? []).map(rec).join('')}</outline>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>${esc(root.title)}</title></head><body>${rec(root)}</body></opml>`;
}

function stripData(n: ArtNode): ArtNode {
  const o: ArtNode = { ...n };
  if (o.props) o.props = Object.fromEntries(Object.entries(o.props).filter(([, v]) => !(typeof v === 'string' && v.startsWith('data:'))));
  if (o.children) o.children = o.children.map(stripData);
  return o;
}

async function svgToPngBase64(svg: string): Promise<string> {
  const img = new Image();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = img.width * scale; c.height = img.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}

function dataUrlToFile(url: string, name: string): { name: string; data: string; encoding: 'utf8' | 'base64' } {
  const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!m) return { name: name + '.txt', data: url, encoding: 'utf8' };
  const ext = m[1].includes('svg') ? 'svg' : m[1].includes('jpeg') ? 'jpg' : m[1].split('/')[1] ?? 'png';
  return m[2] ? { name: `${name}.${ext}`, data: m[3], encoding: 'base64' } : { name: `${name}.${ext}`, data: decodeURIComponent(m[3]), encoding: 'utf8' };
}

/** 导出菜单：常用的放前面（复制 / Word），再加模板声明的格式 */
export function exportKinds(m: TypeManifest): string[] {
  const own = m.exporters ?? ['markdown', 'json'];
  const base = m.output === 'tree' ? ['docx', 'copy', 'markdown', 'opml', 'canvas', 'mermaid', 'html', 'mdtable', 'pack', 'viewpng'] : ['docx', 'copy', 'viewpng'];
  return [...base, ...own].filter((k, i, arr) => arr.indexOf(k) === i);
}

export async function runExport(kind: string, a: Artifact, m: TypeManifest, dark: boolean): Promise<string | null> {
  const base = safe(a.title);
  const root = a.root;
  switch (kind) {
    case 'copy': await navigator.clipboard.writeText(toMarkdown(root, m)); return null;
    case 'docx': return window.api.saveFile(`${base}.docx`, bytesToBase64(toDocx(root, m)), 'base64');
    case 'viewpng': {
      const el = document.querySelector('.canvas') as HTMLElement | null;
      if (!el) throw new Error('找不到当前视图');
      const r = el.getBoundingClientRect();
      const b64 = await window.api.captureRect({ x: r.left, y: r.top, width: r.width, height: r.height });
      if (!b64) throw new Error('截图失败');
      return window.api.saveFile(`${base}.png`, b64, 'base64');
    }
    case 'markdown': return window.api.saveFile(`${base}.md`, toMarkdown(root, m));
    case 'json': return window.api.saveFile(`${base}.json`, JSON.stringify({ type: m.id, seed: a.seed, root: stripData(root) }, null, 2));
    case 'csv': return window.api.saveFile(`${base}.csv`, toCSV(root, m));
    case 'opml': return window.api.saveFile(`${base}.opml`, toOPML(root));
    case 'canvas': return window.api.saveFile(`${base}.canvas`, JSON.stringify(toJSONCanvas(root, m), null, 2));
    case 'mermaid': return window.api.saveFile(`${base}.mmd`, toMermaid(root, m).text);
    case 'html': return window.api.saveFile(`${base}.html`, toHtml(root, m, a));
    case 'mdtable': return window.api.saveFile(`${base}-表格.md`, toMdTable(root, m));
    case 'pack': {
      const JSZip = ((await import('jszip')) as any).default ?? await import('jszip');
      const zip = new JSZip();
      for (const f of packFiles(a, m, toMarkdown(root, m), toCSV(root, m))) zip.file(f.name, f.text);
      const buf: Uint8Array = await zip.generateAsync({ type: 'uint8array' });
      return window.api.saveFile(`${base}-交接包.zip`, bytesToBase64(buf), 'base64');
    }
    case 'yaml': return window.api.saveFile(`${base}.yaml`, m.output === 'text' ? (root.content ?? '') : yamlDump(stripData(root), { lineWidth: 120 }));
    case 'text': return window.api.saveFile(`${base}.${m.language === 'markdown' ? 'md' : 'txt'}`, root.content ?? '');
    case 'svg': return window.api.saveFile(`${base}.svg`, mindmapSVG(root, dark));
    case 'png': return window.api.saveFile(`${base}.png`, await svgToPngBase64(mindmapSVG(root, dark)), 'base64');
    case 'images': {
      const files = (root.children ?? []).filter((c) => typeof c.props?.url === 'string' && String(c.props.url).startsWith('data:'))
        .map((c, i) => dataUrlToFile(String(c.props!.url), `${String(i + 1).padStart(2, '0')}_${safe(c.title)}`));
      if (!files.length) throw new Error('没有可导出的图片');
      return window.api.saveMany(files);
    }
  }
  throw new Error('未知导出格式 ' + kind);
}
