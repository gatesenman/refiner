import { diffChars, diffWordsWithSpace } from 'diff';
import type { ArtNode, TypeManifest } from './types';
import { walk } from './tree';

/** 并排对比：按 id / 标题对齐两版的一级部分；属性按字段名显示（不出现 {owner:…} 这类机器格式）；改动项给出字级差异 */
export interface PartRow { l?: ArtNode; r?: ArtNode; status: 'same' | 'mod' | 'add' | 'del' }
const norm = (s: string) => s.replace(/\s+/g, '').replace(/^[\d.、()（）]+/, '').toLowerCase();
export const nodeSig = (n: ArtNode): string => JSON.stringify([n.title, n.content ?? '', n.props ?? {}, (n.children ?? []).map(nodeSig)]);

export function alignParts(a: ArtNode, b: ArtNode): PartRow[] {
  const left = a.children ?? [], right = b.children ?? [];
  const used = new Set<string>();
  const rows: PartRow[] = [];
  for (const l of left) {
    const r = right.find((x) => !used.has(x.id) && x.id === l.id) ?? right.find((x) => !used.has(x.id) && norm(x.title) === norm(l.title));
    if (r) { used.add(r.id); rows.push({ l, r, status: nodeSig(l) === nodeSig(r) ? 'same' : 'mod' }); }
    else rows.push({ l, status: 'del' });
  }
  // 右侧独有的部分：插到它在右侧的相邻位置之后
  right.forEach((r, i) => {
    if (used.has(r.id)) return;
    const prev = right[i - 1];
    const at = prev ? rows.findIndex((x) => x.r?.id === prev.id) : -1;
    rows.splice(at + 1, 0, { r, status: 'add' });
    used.add(r.id);
  });
  return rows;
}

/** 属性的可读文本：“状态：已确认 · 负责人：王敏” */
export function propsText(n: ArtNode, schema?: TypeManifest['nodeSchema']): string {
  if (!n.props) return '';
  const label = new Map((schema?.props ?? []).map((p) => [p.key, p.label]));
  return Object.entries(n.props).filter(([, v]) => v != null && v !== '' && !(typeof v === 'string' && v.startsWith('data:'))).map(([k, v]) => `${label.get(k) ?? k}：${Array.isArray(v) ? v.join('、') : String(v)}`).join(' · ');
}

export interface Seg { t: string; add?: boolean; del?: boolean }
/** 字级差异：中文按字、英文按词 */
export function wordDiff(a: string, b: string): Seg[] {
  const cjk = /[\u3400-\u9fff]/.test(a + b);
  const parts = cjk ? diffChars(a, b) : diffWordsWithSpace(a, b);
  // 合并相邻的同类碎片，避免“碎字”阅读困难
  const out: Seg[] = [];
  for (const p of parts) {
    const s: Seg = { t: p.value, ...(p.added ? { add: true } : {}), ...(p.removed ? { del: true } : {}) };
    const last = out[out.length - 1];
    if (last && !!last.add === !!s.add && !!last.del === !!s.del) last.t += s.t; else out.push(s);
  }
  return out;
}

/** 子树内逐节点的状态（相对于另一版） */
export function subtreeStatus(mine: ArtNode, other?: ArtNode): Map<string, { status: 'same' | 'mod' | 'add'; other?: ArtNode }> {
  const byId = new Map<string, ArtNode>(), byTitle = new Map<string, ArtNode[]>();
  if (other) walk(other, (n) => { byId.set(n.id, n); const k = norm(n.title); byTitle.set(k, [...(byTitle.get(k) ?? []), n]); });
  const used = new Set<string>();
  const out = new Map<string, { status: 'same' | 'mod' | 'add'; other?: ArtNode }>();
  // 一一对应：先按 id，再按标题匹配尚未用过的节点（重复标题不会被重复认领）
  walk(mine, (n) => { const o = byId.get(n.id); if (o && !used.has(o.id)) { used.add(o.id); out.set(n.id, { status: 'same', other: o }); } });
  walk(mine, (n) => {
    let o = out.get(n.id)?.other;
    if (!o) { o = (byTitle.get(norm(n.title)) ?? []).find((x) => !used.has(x.id)); if (o) used.add(o.id); }
    if (!o) out.set(n.id, { status: 'add' });
    else out.set(n.id, { status: o.title === n.title && (o.content ?? '') === (n.content ?? '') && JSON.stringify(o.props ?? {}) === JSON.stringify(n.props ?? {}) ? 'same' : 'mod', other: o });
  });
  return out;
}
