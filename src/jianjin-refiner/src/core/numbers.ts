/**
 * v1.7 结构化数字：从说明文字里抽取数字填入类型声明的 number 属性；汇总（合计 / 小计）与超预算标记。
 * 与场景无关：单位取自属性名括号里的单位（“金额(元)”“工期(天)”“工时(h)”），没有单位时只认“key: 数字”。
 */
import type { ArtNode, PropDef, TypeManifest } from './types';

export function numberProps(m: TypeManifest): PropDef[] { return (m.nodeSchema?.props ?? []).filter((p) => p.type === 'number'); }

/** 属性名里的单位：金额(元) → 元；工期（天） → 天 */
export function unitOf(p: PropDef): string { return /[（(]\s*([^)）]+?)\s*[)）]/.exec(p.label)?.[1] ?? ''; }

const MUL: Record<string, number> = { 万: 10000, 千: 1000, k: 1000, K: 1000, w: 10000, W: 10000, 百: 100 };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 从一段文字中按单位抽取数字；算式取等号后的结果，“另计/另加/+”连接的多项求和 */
export function parseAmount(text: string, unit: string): number | undefined {
  if (!text || !unit) return undefined;
  const u = unit === '元' ? '(?:元|块)' : unit === '天' ? '(?:人天|个工作日|工作日|天)' : unit === '小时' || unit === 'h' ? '(?:小时|h|H)' : esc(unit);
  const re = new RegExp(`(-?\\d[\\d,，]*(?:\\.\\d+)?)\\s*(万|千|百|k|K|w|W)?\\s*${u}(?![/／]|每)`, 'g');
  const hits: { v: number; at: number }[] = [];
  for (const mm of text.matchAll(re)) {
    const v = parseFloat(mm[1].replace(/[,，]/g, '')) * (mm[2] ? MUL[mm[2]] : 1);
    if (!Number.isNaN(v)) hits.push({ v, at: mm.index ?? 0 });
  }
  // 万元写法：“21 万”后面没写“元”时也认（仅金额）
  if (!hits.length && unit === '元') {
    for (const mm of text.matchAll(/(\d+(?:\.\d+)?)\s*万(?!\s*(?:人|字|次|个|名|户|平|㎡))/g)) hits.push({ v: parseFloat(mm[1]) * 10000, at: mm.index ?? 0 });
  }
  if (!hits.length) return undefined;
  const eq = Math.max(text.lastIndexOf('='), text.lastIndexOf('＝'));
  if (eq >= 0) { const after = hits.filter((h) => h.at > eq); if (after.length) return after[0].v; }
  if (hits.length > 1 && /另计|另加|另需|加上|\+|\uFF0B|合计|共计/.test(text) && !/合计|共计/.test(text.slice(0, hits[0].at))) {
    // “人工约 7,500 元，主材另计约 18,000 元” → 两项之和
    if (/另计|另加|另需|加上|\+|\uFF0B/.test(text)) return hits.reduce((s, h) => s + h.v, 0);
  }
  return hits[0].v;
}

/** 为空的 number 属性从说明（及标题）中抽取，标记为推断；手动改过（pinned）的字段不动 */
export function fillNumbers(root: ArtNode, m: TypeManifest): { root: ArtNode; filled: number } {
  const props = numberProps(m).map((p) => ({ p, unit: unitOf(p) })).filter((x) => x.unit);
  if (!props.length) return { root, filled: 0 };
  let filled = 0;
  const rec = (n: ArtNode): ArtNode => {
    let out = n;
    for (const { p, unit } of props) {
      const cur = out.props?.[p.key];
      if (cur !== undefined && cur !== null && cur !== '') {
        // 模型把数字写成了字符串：“4,500” → 4500
        if (typeof cur === 'string') { const v = parseAmount(cur + unit, unit) ?? parseFloat(cur.replace(/[,，\s]/g, '')); if (!Number.isNaN(v)) { out = { ...out, props: { ...out.props, [p.key]: v } }; } }
        continue;
      }
      if (out.pinned?.includes('props.' + p.key)) continue;
      const v = parseAmount(out.content ?? '', unit) ?? parseAmount(out.title, unit);
      if (v === undefined) continue;
      out = { ...out, props: { ...(out.props ?? {}), [p.key]: v }, inferred: [...new Set([...(out.inferred ?? []), p.key])] };
      filled++;
    }
    return out.children?.length ? { ...out, children: out.children.map(rec) } : out;
  };
  return { root: rec(root), filled };
}

export interface Rollup { sum: number; count: number; own?: number; over?: number }
/** 汇总：叶子取自身值；父节点取子项合计（子项都没有值时取自身值）。自身值视为“预算/上限”，子项合计超出时给出 over */
export function rollup(n: ArtNode, key: string, memo = new Map<string, Rollup>()): Rollup {
  const own = typeof n.props?.[key] === 'number' ? (n.props![key] as number) : undefined;
  const kids = n.children ?? [];
  let sum = 0, count = 0;
  for (const c of kids) { const r = rollup(c, key, memo); sum += r.sum; count += r.count; }
  let r: Rollup;
  if (!count) r = own != null ? { sum: own, count: 1, own } : { sum: 0, count: 0 };
  else r = { sum, count, own, over: own != null && kids.length && sum > own + 1e-9 ? sum - own : undefined };
  memo.set(n.id, r);
  return r;
}
export function rollupAll(root: ArtNode, key: string): Map<string, Rollup> { const memo = new Map<string, Rollup>(); rollup(root, key, memo); return memo; }

/** 作品总预算：根节点自身的值，或固定事实里“预算”的回答（取上限） */
export function budgetFrom(root: ArtNode, key: string, unit: string, facts: { q: string; a: string }[] = []): number | undefined {
  const own = typeof root.props?.[key] === 'number' ? (root.props![key] as number) : undefined;
  if (own != null) return own;
  for (const f of facts) {
    if (!/预算|总价|总额|上限|budget/i.test(f.q + f.a)) continue;
    const nums = [...f.a.matchAll(/(\d+(?:\.\d+)?)\s*(万|千|k|w)?/gi)].map((m) => parseFloat(m[1]) * (m[2] ? MUL[m[2]] ?? MUL[m[2].toLowerCase()] ?? 1 : 1));
    if (nums.length && unit === '元') return Math.max(...nums);
  }
  return undefined;
}

/** 数字的显示：元 ≥ 1 万显示“2.1 万元”，其余千分位 */
export function fmtNum(v: number, unit = ''): string {
  if (unit === '元' && Math.abs(v) >= 10000) { const w = v / 10000; return `${Number.isInteger(w) ? w : w.toFixed(Math.abs(w) >= 100 ? 0 : 1).replace(/\.0$/, '')} 万元`; }
  return `${Math.round(v * 100) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (unit ? ` ${unit}` : '');
}
