/**
 * 简单模式的“引导式流程”状态机（纯函数，无 React，便于测试）。
 * 底部操作栏的一切文案与主动作都由 barModel 决定：任何时刻只有一个主动作，且位置固定。
 */
import { effectiveFreedom, findNode, flatten, headChanges, markReviewed, pendingReview } from '../core';
import type { Artifact, OpKind, StageDef, TypeManifest } from '../core';
import { opLabel } from './terms';

export interface StepInfo {
  index: number; total: number; stage: StageDef; next?: StageDef; isLast: boolean; isEmpty: boolean;
  /** 本步已成功运行过（跳过手改 / 回滚产生的版本） */
  done: boolean; ops: OpKind[]; frozen: boolean; requireTarget: boolean; allowWhole: boolean;
}

export function stepInfo(a: Artifact, m: TypeManifest): StepInfo {
  const index = Math.min(a.stageIndex, m.stages.length - 1);
  const stage = m.stages[index];
  const ef = effectiveFreedom(m.stages, index);
  const isEmpty = m.output === 'text' ? !a.root.content : !a.root.children?.length;
  let hv = a.versions.find((v) => v.id === a.head);
  while (hv && (hv.op === 'manual' || hv.op === 'rollback')) hv = a.versions.find((v) => v.id === hv!.parentId);
  const done = !!hv && hv.op !== 'init' && hv.stageId === stage.id && !isEmpty;
  return {
    index, total: m.stages.length, stage, next: m.stages[index + 1], isLast: index >= m.stages.length - 1, isEmpty, done,
    ops: ef.ops, frozen: !!ef.frozen, requireTarget: !!ef.requireTarget && !ef.frozen, allowWhole: ef.scope.includes('artifact'),
  };
}

/** 切换步骤：总是清除选中（避免 AI 改一个用户早已忘记的地方） */
export function changeStage(a: Artifact, i: number): { artifact: Artifact; selectedId: undefined } {
  return { artifact: { ...a, stageIndex: i, finishedAt: undefined }, selectedId: undefined };
}

/** 下一步是否可以直接自动运行：默认作用于全部、不要求先选中、未冻结 */
export function canAutoRun(m: TypeManifest, i: number): boolean {
  if (i >= m.stages.length) return false;
  const ef = effectiveFreedom(m.stages, i);
  return !ef.frozen && !ef.requireTarget && ef.scope.includes('artifact');
}

/** “全部保留，进入下一步”：一次点击 = 保留本次改动 + 进入下一步（可自动运行）；最后一步则进入完成状态 */
export function keepAndAdvance(a: Artifact, m: TypeManifest, now = Date.now(), autoRunSetting = false): { artifact: Artifact; selectedId: undefined; nextIndex: number | null; autoRun: boolean; finished: boolean } {
  const p = pendingReview(a);
  const kept = p ? markReviewed(a, p.version.id) : a;
  const info = stepInfo(a, m);
  if (info.isLast) return { artifact: { ...kept, finishedAt: now }, selectedId: undefined, nextIndex: null, autoRun: false, finished: true };
  const i = info.index + 1;
  return { artifact: { ...kept, stageIndex: i, finishedAt: undefined }, selectedId: undefined, nextIndex: i, autoRun: autoRunSetting && canAutoRun(m, i), finished: false };
}

/** 跳过这一步：记录为已跳过，进入下一步（不运行） */
export function skipStage(a: Artifact, m: TypeManifest): Artifact {
  const info = stepInfo(a, m);
  const skipped = [...new Set([...(a.skipped ?? []), info.stage.id])];
  if (info.isLast) return { ...a, skipped, finishedAt: Date.now() };
  return { ...a, skipped, stageIndex: info.index + 1 };
}

export type BarMode = 'running' | 'failed' | 'review' | 'ready' | 'done' | 'finished';
export type BarAction = 'run' | 'runAll' | 'runMulti' | 'keepNext' | 'next' | 'finish' | 'retry' | 'none';
export interface BarModel {
  mode: BarMode;
  /** 左侧“将修改：…”或改动统计——操作栏永远写明 AI 会改哪里 */
  target: string;
  /** 唯一的主按钮 */
  primary: { label: string; action: BarAction; disabled?: boolean };
  hint?: string;
  /** 未审阅的改动数量（用于 ‹ 1/N › 跳转） */
  changes?: number;
}

export interface BarInput {
  a: Artifact; m: TypeManifest; op: OpKind; running: boolean; failed: boolean; expert?: boolean;
  selectedId?: string; textSel?: boolean;
  /** v1.8 多选（Ctrl+单击）：≥2 处时一次处理所选的几处 */
  multiIds?: string[];
}

export function targetLabel(a: Artifact, m: TypeManifest, selectedId?: string): string {
  const n = selectedId && selectedId !== a.root.id ? findNode(a.root, selectedId) : null;
  if (!n) return '全部';
  const k = flatten(n).length;
  return `「${n.title}」${k ? `（含 ${k} 项）` : ''}`;
}

export function barModel(x: BarInput): BarModel {
  const { a, m, op } = x;
  const info = stepInfo(a, m);
  const OL = (o: string) => opLabel(o, !!x.expert);
  const sel = x.selectedId && x.selectedId !== a.root.id ? findNode(a.root, x.selectedId) : null;
  const hasTarget = !!sel || !!x.textSel;
  const tgt = targetLabel(a, m, x.selectedId);
  const nextName = info.next?.name ?? '';
  if (x.running) return { mode: 'running', target: `正在修改：${op === 'generate' ? '全部' : tgt}`, primary: { label: '停止', action: 'none' } };
  if (x.failed) return { mode: 'failed', target: '这次没有改动任何内容', primary: { label: '重试', action: 'retry' } };
  if (a.finishedAt && info.isLast) return { mode: 'finished', target: `全部 ${info.total} 步已完成`, primary: { label: '', action: 'none' } };
  const pend = pendingReview(a);
  if (pend && pend.version.stageId === info.stage.id) {
    const chg = headChanges(a);
    const n = chg ? chg.added + chg.modified : 0;
    const partial = !!(pend.version.kept?.length) || a.versions.some((v) => v.revert && v.parentId && a.head === v.id);
    const s = pend.version.summary;
    const score = s?.scoreFrom != null ? `（检查得分 ${s.scoreFrom}${s.scoreTo != null && s.scoreTo !== s.scoreFrom ? ` → ${s.scoreTo}` : ''}）` : '';
    const gain = readyGain(a, m, pend.version.parentId);
    const target = (chg ? `AI 新增 ${chg.added} 处、修改 ${chg.modified} 处${chg.removed ? `、删除 ${chg.removed} 处` : ''}${score}` : (pend.base.children?.length ? `AI 这次没有改出新内容${score}（可以换个要求再来一次）` : `AI 写好了第一版：${a.root.children?.length ?? 0} 个部分${score}`)) + (gain ? ` · ${gain}` : '');
    const keep = partial && chg ? `保留其余 ${n} 处` : '全部保留';
    return { mode: 'review', target, changes: chg ? chg.map.size : 0, primary: { label: info.isLast ? `${keep}，完成` : `${keep}，进入下一步：${nextName}`, action: 'keepNext' } };
  }
  const multi = (x.multiIds ?? []).map((id) => findNode(a.root, id)).filter((n): n is NonNullable<typeof n> => !!n && n.id !== a.root.id);
  if (multi.length >= 2 && !info.frozen && op !== 'generate') {
    const names = multi.slice(0, 3).map((n) => `「${n.title.slice(0, 10)}」`).join('') + (multi.length > 3 ? ` 等` : '');
    return { mode: info.done ? 'done' : 'ready', target: `将修改：已选 ${multi.length} 处 ${names}`, hint: '逐个处理所选部分，合成一个版本；其余内容不动', primary: { label: `${OL(op)}所选 ${multi.length} 处`, action: 'runMulti' } };
  }
  if (info.done && hasTarget && !info.frozen && op !== 'generate') {
    return { mode: 'done', target: `将修改：${tgt}`, primary: { label: `${OL(op)}${sel ? `「${sel.title}」` : '所选文字'}`, action: 'run' } };
  }
  if (info.done) {
    return info.isLast
      ? { mode: 'done', target: '这一步已完成', primary: { label: '完成', action: 'finish' } }
      : { mode: 'done', target: `下一步：${nextName}`, primary: { label: `进入下一步：${nextName}`, action: 'next' } };
  }
  // 尚未运行
  if (info.frozen) return { mode: 'ready', target: '内容已定稿，只运行收尾步骤', primary: { label: `开始${info.stage.name}`, action: 'run' } };
  if (op === 'generate') return { mode: 'ready', target: info.isEmpty ? '将生成：整体初稿' : '将替换：全部内容（旧版本保留在历史里）', primary: { label: info.isEmpty ? `开始${info.stage.name}` : '重新生成全部', action: 'run' } };
  if (info.requireTarget && !hasTarget) {
    // 本步只能改选中的部分：主按钮置灰并说明（“跳过这一步”在“更多”里，不再作为蓝色主按钮）
    return { mode: 'ready', target: '将修改：（还没选）', hint: '先点选要修改的部分', primary: info.isLast ? { label: '完成', action: 'finish' } : { label: '先点选要修改的部分', action: 'none', disabled: true } };
  }
  if (!info.allowWhole && !hasTarget) {
    // 本步只允许局部修改：“全部” = 逐个部分各改一次（合成一个版本）
    const k = (a.root.children ?? []).filter((c) => !c.locked).length;
    return { mode: 'ready', target: '将修改：全部', hint: `逐个处理 ${k} 个部分；也可以点选只改其中一项`, primary: { label: `${OL(op)}全部`, action: 'runAll' } };
  }
  return {
    mode: 'ready', target: `将修改：${tgt}`,
    hint: !hasTarget && info.index > 0 ? '点选上面任意一项，只改那一部分' : undefined,
    primary: { label: hasTarget ? `${OL(op)}${sel ? `「${sel.title}」` : '所选文字'}` : `${OL(op)}全部`, action: 'run' },
  };
}

/** 完成卡统计 */
export function finishStats(a: Artifact): { parts: number; items: number; minutes: number; versions: number } {
  return {
    parts: a.root.children?.length ?? 0,
    items: flatten(a.root).length,
    minutes: Math.max(1, Math.round(((a.finishedAt ?? Date.now()) - a.createdAt) / 60000)),
    versions: a.versions.length,
  };
}

/* ───────────── v1.6 费用：运行前预估 ───────────── */
import { checkBudget, costOf, DEFAULT_PRICES, estimateRun, refContext, stagePipeline, toPromptJSON, type Price, type Usage } from '../core';
export function priceTable(over?: Record<string, Price>): Record<string, Price> { return { ...DEFAULT_PRICES, ...(over ?? {}) }; }
export function runEstimate(a: Artifact, m: TypeManifest, stageIndex: number, opts: { model: string; demo: boolean; prices?: Record<string, Price>; disabled?: string[] }): { usage: Usage; cost: number | null; model: string } {
  const steps = stagePipeline(m, stageIndex).steps.filter((x: any) => x.enabled !== false && !(opts.disabled ?? []).includes(x.id));
  const loops = steps.reduce((n: number, x: any) => n + (x.loop?.maxRounds ? x.loop.maxRounds - 1 : 0), 0);
  const calls = Math.max(1, steps.length + loops);
  const ctx = m.output === 'text' ? (a.root.content ?? '') : toPromptJSON(a.root);
  const usage = estimateRun({ calls, contextChars: ctx, refChars: refContext(a.refs).used });
  const model = opts.demo ? 'demo' : opts.model;
  return { usage, cost: costOf(usage, model, priceTable(opts.prices)), model };
}
export function budgetBlock(a: Artifact, est: { cost: number | null }, budget?: { perRun?: number; perWork?: number }): string | null {
  return checkBudget(budget, est.cost, a.usage?.cost ?? 0);
}

/* ───────────── v1.6 运行中：流式部分结果 ───────────── */
import { jsonrepair } from 'jsonrepair';
import type { ArtNode as _N } from '../core';
/** 把流式输出到一半的 JSON 修补成可显示的树（尚无可用结构时返回 null） */
export function partialTree(text: string): _N | null {
  if (!text) return null;
  const i = text.indexOf('{');
  if (i < 0) return null;
  let body = text.slice(i);
  const f = body.indexOf('```');
  if (f > 0) body = body.slice(0, f);
  try {
    const o: any = JSON.parse(jsonrepair(body));
    const kids = o?.children ?? o?.root?.children;
    if (!Array.isArray(kids) || !kids.length) return null;
    const conv = (x: any, k: number, p: string): _N => ({ id: `live-${p}${k}`, title: String(x?.title ?? x?.name ?? ''), ...(x?.content ? { content: String(x.content) } : {}), ...(Array.isArray(x?.children) && x.children.length ? { children: x.children.filter((c: any) => c && typeof c === 'object').map((c: any, j: number) => conv(c, j, `${p}${k}-`)) } : {}) });
    const root = conv(o.root ?? o, 0, '');
    return root.children?.some((c) => c.title) ? root : null;
  } catch { return null; }
}

/* ───────────── v1.7 ───────────── */
import { readiness, findNode as _find } from '../core';
import type { Fact } from '../core';
/** 每步价值小结：“就绪度 45% → 68%” */
export function readyGain(a: Artifact, m: TypeManifest, parentId?: string | null): string {
  if (m.output !== 'tree') return '';
  const before = a.versions.find((v) => v.id === parentId)?.root;
  const r1 = readiness(a.root, m).percent;
  if (!before?.children?.length) return `就绪度 ${r1}%`;
  const r0 = readiness(before, m).percent;
  return r0 === r1 ? `就绪度 ${r1}%` : `就绪度 ${r0}% → ${r1}%`;
}

/** “重新规划”沿用导入的初稿、参考资料、固定事实与派生来源（回归修复） */
export function replanOpts<T extends { title?: string; seed?: unknown; facts?: unknown; source?: unknown }>(p: T, templateId?: string): { title?: string; templateId?: string; seed?: T['seed']; facts?: T['facts']; source?: T['source'] } {
  return { title: p.title, ...(templateId ? { templateId } : {}), ...(p.seed ? { seed: p.seed } : {}), ...(p.facts ? { facts: p.facts } : {}), ...(p.source ? { source: p.source } : {}) };
}

/** 评审里“缺事实”类的问题 → 步骤间追问（评审给了 questions 就用它；否则从问题描述里挑） */
export const FACT_RE = /缺少|缺乏|未明确|不明确|未说明|没有说明|待确认|需确认|需要确认|不清楚|未提供|未给出|未知|依据|是否/;
export function deriveAsks(summary: { issues?: string[]; questions?: { q: string; options?: string[] }[] } | undefined, facts: Fact[] = [], max = 2): { q: string; options?: string[] }[] {
  if (!summary) return [];
  const known = new Set(facts.map((f) => f.q.replace(/\s+/g, '')));
  const src = summary.questions?.length ? summary.questions : (summary.issues ?? []).filter((x) => FACT_RE.test(x)).map((x) => ({ q: x.replace(/[。.]$/, '') + '——能补充一下吗？' }));
  return src.filter((x) => !known.has(x.q.replace(/\s+/g, ''))).slice(0, max);
}

/** 完成卡的交接清单：待定项、缺字段（按属性）、下一步行动 */
export interface Handoff { open: { id: string; title: string; why: string }[]; missing: { label: string; items: { id: string; title: string }[] }[]; actions: { id: string; title: string; owner?: string; date?: string; status?: string }[] }
export function handoff(a: Artifact, m: TypeManifest): Handoff {
  const props = m.nodeSchema?.props ?? [];
  const ownerP = props.find((p) => /owner|assignee|负责人|责任人/i.test(p.key + p.label));
  const dateP = props.find((p) => p.type === 'date' || /date|due|deadline|截止|日期|时间/i.test(p.key + p.label));
  const statusP = props.find((p) => p.type === 'enum' && /status|状态/i.test(p.key + p.label));
  const VAG = /待定|待确认|待讨论|待补充|不确定|未定|TBD|TODO|[?？]/i;
  const out: Handoff = { open: [], missing: [], actions: [] };
  const miss = new Map<string, { id: string; title: string }[]>();
  for (const { node: n } of flatten(a.root)) {
    if (n.id === a.root.id) continue;
    const leaf = !n.children?.length;
    if (n.kind === 'open-question') out.open.push({ id: n.id, title: n.title, why: '待澄清' });
    else if (VAG.test(`${n.title} ${n.content ?? ''}`) || (statusP && /待定|待确认/.test(String(n.props?.[statusP.key] ?? '')))) out.open.push({ id: n.id, title: n.title, why: VAG.exec(`${n.title} ${n.content ?? ''}`)?.[0] ?? String(n.props?.[statusP!.key]) });
    if (leaf && n.kind !== 'open-question') {
      for (const p of [ownerP, dateP].filter(Boolean) as typeof props) {
        const v = n.props?.[p.key];
        if (v === undefined || v === null || v === '') { const l = p.label.replace(/[（(].*$/, ''); miss.set(l, [...(miss.get(l) ?? []), { id: n.id, title: n.title }]); }
      }
      const done = statusP && /完成|done|已上线|关闭/i.test(String(n.props?.[statusP.key] ?? ''));
      if (!done) out.actions.push({ id: n.id, title: n.title, owner: ownerP ? (n.props?.[ownerP.key] as string | undefined) : undefined, date: dateP ? (n.props?.[dateP.key] as string | undefined) : undefined, status: statusP ? (n.props?.[statusP.key] as string | undefined) : undefined });
    }
  }
  out.missing = [...miss.entries()].map(([label, items]) => ({ label, items }));
  return out;
}
/** 交接清单 → 待办 CSV（任何任务工具都能导入） */
export function handoffCsv(a: Artifact, m: TypeManifest): string {
  const h = handoff(a, m);
  const q = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const pathOf = (id: string) => flatten(a.root).find((x) => x.node.id === id)?.path.join(' / ') ?? '';
  const rows = [['标题', '所属', '负责人', '日期', '状态', '待定'].map(q).join(',')];
  const openIds = new Set(h.open.map((o) => o.id));
  for (const t of h.actions) rows.push([t.title, pathOf(t.id), t.owner ?? '', t.date ?? '', t.status ?? '', openIds.has(t.id) ? '是' : ''].map(q).join(','));
  for (const o of h.open.filter((o) => !h.actions.some((t) => t.id === o.id))) rows.push([o.title, pathOf(o.id), '', '', '', '是'].map(q).join(','));
  return '\uFEFF' + rows.join('\r\n');
}
/** 交接清单 → 日历 ICS（带日期的项） */
export function handoffIcs(a: Artifact, m: TypeManifest, now = new Date()): string {
  const h = handoff(a, m);
  const year = now.getFullYear();
  const toDate = (s?: string): string | null => {
    if (!s) return null;
    let mm = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
    if (mm) return `${mm[1]}${mm[2].padStart(2, '0')}${mm[3].padStart(2, '0')}`;
    mm = /^(\d{1,2})[-/.月](\d{1,2})/.exec(s.trim());
    return mm ? `${year}${mm[1].padStart(2, '0')}${mm[2].padStart(2, '0')}` : null;
  };
  const ev = h.actions.map((t) => ({ t, d: toDate(t.date) })).filter((x) => x.d);
  const esc = (x: string) => x.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JianJin Refiner//CN'];
  for (const { t, d } of ev) lines.push('BEGIN:VEVENT', `UID:${t.id}@refiner`, `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${esc(t.title)}`, ...(t.owner ? [`DESCRIPTION:${esc('负责人：' + t.owner)}`] : []), 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
void _find;

/**
 * v1.9 粒度微调（借鉴 ChatGPT Canvas 的“调整长度”滑杆，但作用在“粗到细”这根轴上）：
 * 对选中的一项：更细 = 往下展开 / 补细节；更粗 = 收拢合并成更概括的几项。只用本步允许的算子，不越过自由度约束。
 */
export const COARSEN_INSTR = '把这一部分收拢得更概括：合并相近或重复的子项、去掉枝节，保留 3~5 个要点；不要新增内容';
export const FINER_INSTR = '把这一部分再细一层：补上缺的子项、具体数字、负责人与时间等可执行的细节';
export function grainOps(ops: OpKind[]): { finer?: OpKind; coarser?: OpKind } {
  const finer = (['expand', 'detail'] as OpKind[]).find((o) => ops.includes(o));
  // 收拢需要能替换子项的算子（重组 / 细化都是整体替换；改写会保留子项，收拢不了）
  const coarser = (['restructure', 'detail'] as OpKind[]).find((o) => ops.includes(o));
  return { finer, coarser };
}
