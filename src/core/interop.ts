/**
 * v2.0 外部集成（开放格式，无需账号/接口）：
 * - JSON Canvas 1.0（https://jsoncanvas.org/spec/1.0/，Obsidian 白板等支持）：树 → 从左到右的卡片 + 连线，颜色 = 成熟度；
 * - Mermaid（https://mermaid.js.org）：有日期时导出甘特图（section = 一级部分），否则导出脑图；可直接粘进飞书/Notion/GitHub/Obsidian 文档。
 */
import type { ArtNode, TypeManifest } from './types';
import { maturityMap } from './maturity';

const W = 280, GAP_X = 80, ROW = 110;
const lineH = (s: string) => Math.min(6, Math.ceil(s.length / 20));

export function toJSONCanvas(root: ArtNode, m: TypeManifest): { nodes: any[]; edges: any[] } {
  const mm = maturityMap(root, m);
  const COLOR: Record<string, string> = { rough: '2', medium: '3', detailed: '4' };
  const nodes: any[] = []; const edges: any[] = [];
  let leaf = 0;
  const place = (n: ArtNode, d: number): number => {
    const kids = n.children ?? [];
    let y: number;
    if (!kids.length) { y = leaf * ROW; leaf += 1 + Math.floor(lineH(n.content ?? '') / 3); }
    else { const ys = kids.map((k) => place(k, d + 1)); y = Math.round((ys[0] + ys[ys.length - 1]) / 2); }
    const text = `${d === 0 ? '# ' : '**'}${n.title}${d === 0 ? '' : '**'}${n.content ? `\n\n${n.content}` : ''}`;
    const lv = mm.get(n.id)?.level;
    nodes.push({ id: n.id, type: 'text', text, x: d * (W + GAP_X), y, width: W, height: 60 + lineH(n.content ?? '') * 22, ...(d > 0 && lv ? { color: COLOR[lv] } : {}) });
    for (const k of kids) edges.push({ id: `e-${n.id}-${k.id}`, fromNode: n.id, fromSide: 'right', toNode: k.id, toSide: 'left' });
    return y;
  };
  place(root, 0);
  return { nodes: nodes.reverse(), edges };
}

const clean = (s: string) => s.replace(/[()[\]{}<>"`:;#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '（未命名）';
const DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
const isoDate = (v: unknown): string | null => { const r = DATE.exec(String(v ?? '')); return r ? `${r[1]}-${r[2].padStart(2, '0')}-${r[3].padStart(2, '0')}` : null; };

export function toMermaid(root: ArtNode, m: TypeManifest): { kind: 'gantt' | 'mindmap'; text: string } {
  const dateKeys = (m.nodeSchema?.props ?? []).filter((p) => p.type === 'date').map((p) => p.key);
  const dated: { sec: string; n: ArtNode; date: string }[] = [];
  for (const part of root.children ?? []) {
    const walkP = (n: ArtNode) => { const d = dateKeys.map((k) => isoDate(n.props?.[k])).find(Boolean); if (d) dated.push({ sec: part.title, n, date: d }); (n.children ?? []).forEach(walkP); };
    walkP(part);
  }
  if (dated.length >= 2) {
    const lines = ['gantt', `    title ${clean(root.title)}`, '    dateFormat YYYY-MM-DD'];
    let sec = '';
    dated.forEach((x, i) => { if (x.sec !== sec) { sec = x.sec; lines.push(`    section ${clean(sec)}`); } lines.push(`    ${clean(x.n.title)} :t${i + 1}, ${x.date}, 1d`); });
    return { kind: 'gantt', text: lines.join('\n') + '\n' };
  }
  const lines = ['mindmap', `  root((${clean(root.title)}))`];
  const rec = (n: ArtNode, d: number) => { for (const k of n.children ?? []) { lines.push(`${'  '.repeat(d + 2)}${clean(k.title)}`); rec(k, d + 1); } };
  rec(root, 0);
  return { kind: 'mindmap', text: lines.join('\n') + '\n' };
}


/** 从 JSON Canvas 白板还原树（与 toJSONCanvas 对得上；无连线时按 x 分层、y 排序） */
export function fromJSONCanvas(doc: { nodes?: any[]; edges?: any[] }): ArtNode {
  const nodes = Array.isArray(doc?.nodes) ? doc.nodes.filter((n) => n && n.id) : [];
  const edges = Array.isArray(doc?.edges) ? doc.edges : [];
  const parseText = (text: string): { title: string; content?: string } => {
    const raw = String(text ?? '').replace(/^#\s+/, '').replace(/^\*\*/, '').replace(/\*\*$/, '');
    const parts = raw.split(/\n\n/);
    const title = (parts[0] ?? '').replace(/^\*\*|\*\*$/g, '').replace(/^#\s+/, '').trim() || '（未命名）';
    const content = parts.slice(1).join('\n\n').trim();
    return content ? { title, content } : { title };
  };
  const kids = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const e of edges) {
    if (!e?.fromNode || !e?.toNode) continue;
    kids.set(e.fromNode, [...(kids.get(e.fromNode) ?? []), e.toNode]);
    incoming.add(e.toNode);
  }
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const roots = nodes.filter((n) => !incoming.has(n.id));
  const rootN = roots.sort((a, b) => (a.x ?? 0) - (b.x ?? 0))[0] ?? nodes[0];
  if (!rootN) return { id: 'root', title: '（空）' };
  const build = (id: string): ArtNode => {
    const n = byId.get(id);
    const { title, content } = parseText(n?.text ?? '');
    const children = (kids.get(id) ?? []).map(build);
    return { id, title, ...(content ? { content } : {}), ...(children.length ? { children } : {}) };
  };
  return build(String(rootN.id));
}
