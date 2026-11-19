import { Icon } from '../icons/Icon';
import { numberProps, unitOf, rollupAll, fmtNum, budgetFrom, maturityMap, LEVEL_LABEL, type Rollup, type Maturity, type Fact } from '../../core';
import type { ArtNode, TypeManifest } from '../../core';

const ENUM_COLORS = ['#5aa3ff', '#b277f0', '#3fb97f', '#e3a33a', '#ef5f6b', '#4fc1c9'];

export function enumColor(m: TypeManifest, key: string, val: unknown): string | undefined {
  const p = m.nodeSchema?.props?.find((x) => x.key === key);
  if (!p?.options) return undefined;
  const i = p.options.indexOf(String(val));
  return i >= 0 ? ENUM_COLORS[i % ENUM_COLORS.length] : undefined;
}

const fmtDate = (v: string) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(v); return m ? `${Number(m[1])}/${Number(m[2])}` : v; };
/** 属性：合并为一行灰字（如“待定 · 10/26–10/27 · 行政 · 王敏”），悬停显示字段名；枚举值保留颜色点 */
export function PropChips({ m, node, skip = [] }: { m: TypeManifest; node: ArtNode; skip?: string[] }) {
  const props = m.nodeSchema?.props ?? [];
  const items = props.filter((p) => !skip.includes(p.key) && p.type !== 'text' && p.type !== 'url' && node.props?.[p.key] != null && node.props?.[p.key] !== '');
  if (!items.length) return null;
  const val = (k: string) => node.props?.[k];
  const parts: { k: string; text: string; tip: string; color?: string }[] = [];
  const used = new Set<string>();
  const start = items.find((p) => p.type === 'date' && /start|begin|开始/.test(p.key + p.label));
  const end = items.find((p) => p.type === 'date' && /end|due|结束|截止/.test(p.key + p.label));
  for (const p of items) {
    if (used.has(p.key)) continue;
    if (start && end && (p === start || p === end)) {
      used.add(start.key); used.add(end.key);
      const a = fmtDate(String(val(start.key))), b = fmtDate(String(val(end.key)));
      parts.push({ k: 'range', text: a === b ? a : `${a}–${b}`, tip: `${start.label}–${end.label}` });
      continue;
    }
    used.add(p.key);
    const v = String(val(p.key));
    const inf = node.inferred?.includes(p.key);
    const num = p.type === 'number' && typeof val(p.key) === 'number';
    parts.push({ k: p.key, text: num ? fmtNum(val(p.key) as number, unitOf(p)) + (inf ? '（推断）' : '') : p.type === 'date' ? fmtDate(v) : v, tip: inf ? `${p.label}：从说明文字里推断的，可在右侧或表格里改` : p.label, color: enumColor(m, p.key, v) });
  }
  return (
    <div className="props-line">
      {parts.map((x, i) => (
        <span key={x.k} title={x.tip}>{i > 0 && <span className="sep">·</span>}{x.color && <i className="pdot" style={{ background: x.color }} />}{x.text}</span>
      ))}
    </div>
  );
}

/* ───── 改动高亮与逐条审阅（所有渲染积木共用） ───── */
import type { RProps as _RP } from './types';
export function chgClass(p: Pick<_RP, 'changes'>, id: string): string { const c = p.changes?.get(id); return c ? `chg chg-${c.kind}` : ''; }
export function ChangeTag({ p, id }: { p: Pick<_RP, 'changes' | 'review'>; id: string }) {
  const c = p.changes?.get(id);
  if (!c) return null;
  const w = p.review?.whyOf?.(id) ?? p.review?.why;
  const before = c.before ? `改前：${c.before.title}${c.before.content ? '\n' + c.before.content.slice(0, 200) : ''}` : '';
  const title = (c.kind === 'add' ? 'AI 新增的内容' : `AI 修改了这里\n${before}`) + (w ? `\n\n为什么改：${w}` : '');
  return (
    <span className={`chg-tag ${c.kind}`} title={title} onClick={(e) => e.stopPropagation()}>
      {c.kind === 'add' ? '新' : '改'}
      {w && <Icon name="ri-chat-quote-line" />}
      {p.review && <>
        <button className="chg-btn" title="保留这一处" onClick={() => p.review!.onKeep(id)}><Icon name="ri-check-line" /></button>
        <button className="chg-btn" title="撤回这一处（恢复到 AI 改动之前）" onClick={() => p.review!.onRevert(id)}><Icon name="ri-arrow-go-back-line" /></button>
      </>}
    </span>
  );
}

/* ───── v1.7 数字汇总与成熟度（各渲染积木共用） ───── */
export interface NumInfo { key: string; label: string; unit: string; map: Map<string, Rollup>; budget?: number }
/** 类型声明的每个数字字段的汇总（父节点 = 子项合计） */
export function numInfo(root: ArtNode, m: TypeManifest, facts?: Fact[]): NumInfo[] {
  return numberProps(m).map((p) => { const unit = unitOf(p); return { key: p.key, label: p.label.replace(/[（(].*$/, ''), unit, map: rollupAll(root, p.key), budget: budgetFrom(root, p.key, unit, facts) }; });
}
/** 父节点的小计灰字：“小计 3.2 万元”；超出自身预算时红字 */
export function Subtotal({ nodeId, nums, isRoot }: { nodeId: string; nums: NumInfo[]; isRoot?: boolean }) {
  const xs = nums.map((x) => ({ x, r: x.map.get(nodeId) })).filter(({ r }) => r && r.count > 1);
  if (!xs.length) return null;
  return (
    <span className="subtotal">
      {xs.map(({ x, r }) => {
        const over = isRoot ? (x.budget != null && r!.sum > x.budget && r!.own == null ? r!.sum - x.budget : r!.over) : r!.over;
        const cap = isRoot ? (r!.own ?? x.budget) : r!.own;
        return <span key={x.key} className={over ? 'over' : ''} title={over ? `${x.label}合计 ${fmtNum(r!.sum, x.unit)}，超出${isRoot ? '总预算' : '这一项的预算'} ${fmtNum(cap!, x.unit)}` : `${x.label}：${r!.count} 项合计`}>
          {isRoot ? '合计' : '小计'} {fmtNum(r!.sum, x.unit)}{over ? ` · 超出 ${fmtNum(over, x.unit)}` : cap != null ? ` / ${fmtNum(cap, x.unit)}` : ''}
        </span>;
      })}
    </span>
  );
}
/** 成熟度色点：粗 橙 / 中 黄 / 细 绿；悬停说明原因 */
export function MatDot({ mm }: { mm?: Maturity }) {
  if (!mm) return null;
  const tip = `${LEVEL_LABEL[mm.level]}：${mm.reasons.length ? mm.reasons.join('；') : '说明具体、属性齐全'}`;
  return <span className={`mat mat-${mm.level}`} title={tip} aria-label={tip} />;
}
export { maturityMap };
