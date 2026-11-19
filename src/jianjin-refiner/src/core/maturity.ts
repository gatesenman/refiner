/**
 * v1.7 成熟度：把“自由度”落到内容上——粗 = 还有自由度（还没想清楚），细 = 已收敛（可以执行）。
 * 纯本地确定性规则、零成本、与场景无关：只看说明是否具体、是否含“待定/？/TODO”、类型声明的属性是否填写、数字是否有依据。
 */
import type { ArtNode, TypeManifest } from './types';
import { numberProps } from './numbers';

export type Level = 'rough' | 'medium' | 'detailed';
export const LEVEL_LABEL: Record<Level, string> = { rough: '粗', medium: '中', detailed: '细' };
export const LEVEL_SCORE: Record<Level, number> = { rough: 0, medium: 0.5, detailed: 1 };

/** 含糊标记：明确表示“还没定” */
export const VAGUE = /待定|待确认|待讨论|待补充|不确定|未定|没定|再说|TBD|TODO|FIXME|XXX|\?{1}|？|大概|若干|之类|等等|也许|可能要/i;
const vagueHit = (t: string): string | undefined => { const m = VAGUE.exec(t); return m ? m[0] : undefined; };

export interface Maturity { level: Level; score: number; reasons: string[]; vague?: string; missing: string[] }

/** 单个节点自身（不看子项）的成熟度 */
export function nodeMaturity(n: ArtNode, m: TypeManifest, opts: { isPart?: boolean } = {}): Maturity {
  const reasons: string[] = [];
  const text = `${n.title} ${n.content ?? ''}`;
  const c = (n.content ?? '').trim();
  const vague = n.kind === 'open-question' ? '待澄清' : vagueHit(text);
  const declared = (m.nodeSchema?.props ?? []).filter((p) => !['url'].includes(p.type) && !/prompt|image|url|图|提示词/i.test(p.key));
  const missing = declared.filter((p) => { const v = n.props?.[p.key]; return v === undefined || v === null || v === ''; }).map((p) => p.label.replace(/[（(].*$/, ''));
  const nums = numberProps(m);
  const inferredNum = nums.filter((p) => n.inferred?.includes(p.key)).map((p) => p.label.replace(/[（(].*$/, ''));
  let rough = false;
  if (n.kind === 'open-question') { rough = true; reasons.push('待澄清的问题'); }
  if (!c) { rough = true; reasons.push(opts.isPart ? '还没有说明，也没有展开' : '还没有具体说明'); }
  else if (c.length < 12) { rough = true; reasons.push(`说明太短（${c.length} 字）`); }
  if (vague && n.kind !== 'open-question') { rough = true; reasons.push(`含“${vague}”`); }
  if (declared.length && missing.length * 2 > declared.length) { rough = true; reasons.push(`缺：${missing.join('、')}`); }
  else if (missing.length) reasons.push(`缺：${missing.join('、')}`);
  if (inferredNum.length) reasons.push(`${inferredNum.join('、')}是从说明里推断的`);
  const level: Level = rough ? 'rough' : missing.length || inferredNum.length ? 'medium' : 'detailed';
  return { level, score: LEVEL_SCORE[level], reasons, vague, missing };
}

/** 子树成熟度：叶子按自身；有子项的节点按全部叶子的平均（一级部分没有子项也算粗） */
export function subtreeMaturity(n: ArtNode, m: TypeManifest, depth = 1): Maturity & { leaves: number; rough: number; medium: number; detailed: number } {
  const kids = n.children ?? [];
  if (!kids.length) {
    const own = nodeMaturity(n, m, { isPart: depth === 1 });
    return { ...own, leaves: 1, rough: +(own.level === 'rough'), medium: +(own.level === 'medium'), detailed: +(own.level === 'detailed') };
  }
  let leaves = 0, rough = 0, medium = 0, detailed = 0, total = 0;
  const rs = new Map<string, number>();
  const visit = (x: ArtNode, d: number) => {
    if (x.children?.length) { x.children.forEach((c) => visit(c, d + 1)); return; }
    const mm = nodeMaturity(x, m, { isPart: d === 1 });
    leaves++; total += mm.score;
    if (mm.level === 'rough') rough++; else if (mm.level === 'medium') medium++; else detailed++;
    for (const r of mm.reasons) { const k = r.startsWith('缺：') ? '缺' : r.startsWith('含“') ? '含糊' : r.startsWith('说明太短') ? '太短' : r; rs.set(k, (rs.get(k) ?? 0) + 1); }
  };
  kids.forEach((c) => visit(c, depth + 1));
  const score = leaves ? total / leaves : 0;
  const level: Level = score < 0.45 ? 'rough' : score < 0.85 ? 'medium' : 'detailed';
  const reasons: string[] = [];
  const name: Record<string, string> = { 缺: '项缺属性', 含糊: '项含“待定/？”等', 太短: '项说明太短', '还没有具体说明': '项还没有具体说明' };
  for (const [k, v] of [...rs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) reasons.push(`${v} ${name[k] ?? '项' + k}`);
  reasons.unshift(`${leaves} 项中 ${detailed} 项已具体${rough ? `、${rough} 项还比较粗` : ''}`);
  return { level, score, reasons, missing: [], leaves, rough, medium, detailed };
}

/** 每个节点的显示级别（父节点按子树汇总） */
export function maturityMap(root: ArtNode, m: TypeManifest): Map<string, Maturity> {
  const out = new Map<string, Maturity>();
  const rec = (n: ArtNode, d: number) => { out.set(n.id, n.children?.length ? subtreeMaturity(n, m, d) : nodeMaturity(n, m, { isPart: d === 1 })); n.children?.forEach((c) => rec(c, d + 1)); };
  (root.children ?? []).forEach((c) => rec(c, 1));
  return out;
}

export interface Readiness { percent: number; items: number; detailed: number; medium: number; rough: number; open: number; missing: Record<string, number>; vague: number }
/** 作品就绪度：全部叶子的平均成熟度（粗 0、中 0.5、细 1） */
export function readiness(root: ArtNode, m: TypeManifest): Readiness {
  const r: Readiness = { percent: 0, items: 0, detailed: 0, medium: 0, rough: 0, open: 0, missing: {}, vague: 0 };
  let total = 0;
  const visit = (x: ArtNode, d: number) => {
    if (x.children?.length) { x.children.forEach((c) => visit(c, d + 1)); return; }
    const mm = nodeMaturity(x, m, { isPart: d === 1 });
    r.items++; total += mm.score; r[mm.level]++;
    if (x.kind === 'open-question') r.open++;
    if (mm.vague && x.kind !== 'open-question') r.vague++;
    for (const k of mm.missing) r.missing[k] = (r.missing[k] ?? 0) + 1;
  };
  (root.children ?? []).forEach((c) => visit(c, 1));
  r.percent = r.items ? Math.round((total / r.items) * 100) : 0;
  return r;
}

/** “接着细化最粗的 N 处”：在一、二级里挑最粗的、互不包含、未锁定的部分 */
export function roughest(root: ArtNode, m: TypeManifest, k = 3): { id: string; title: string; level: Level; why: string }[] {
  const mm = maturityMap(root, m);
  const cands: { n: ArtNode; d: number; s: number; anc: string[] }[] = [];
  const rec = (n: ArtNode, d: number, anc: string[]) => {
    if (n.locked) return;
    if (d >= 1 && d <= 2) { const x = mm.get(n.id)!; if (x.level !== 'detailed') cands.push({ n, d, s: x.score, anc }); }
    if (d < 2) n.children?.forEach((c) => rec(c, d + 1, d >= 1 ? [...anc, n.id] : anc));
  };
  rec(root, 0, []);
  // 一级部分优先（整块还粗时细化整块，比细化其中一项更有效），同级按分数
  cands.sort((a, b) => a.s - b.s || a.d - b.d);
  const picked: typeof cands = [];
  for (const c of cands) {
    if (picked.length >= k) break;
    if (picked.some((p) => c.anc.includes(p.n.id) || p.anc.includes(c.n.id))) continue;
    picked.push(c);
  }
  return picked.map((p) => { const x = mm.get(p.n.id)!; return { id: p.n.id, title: p.n.title, level: x.level, why: x.reasons.slice(0, 2).join('；') }; });
}

export function roughCount(root: ArtNode, m: TypeManifest): number {
  let n = 0;
  const mm = maturityMap(root, m);
  for (const c of root.children ?? []) { const x = mm.get(c.id); if (x?.level === 'rough') n++; c.children?.forEach((g) => { if (mm.get(g.id)?.level === 'rough') n++; }); }
  return n;
}
