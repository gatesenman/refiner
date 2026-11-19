import type { FreedomSpec, OpKind, Scope, StageDef, Strictness } from './types';


/**
 * 自由度形式化：F(stage) ∈ [0,100]
 *   F = 100 × (0.35·T̂ + 0.25·Ŝ + 0.25·Ô + 0.15·Ĉ)
 *   T̂ = temperature / 1.2（截断到 1）
 *   Ŝ = 最宽作用域权重（artifact 1 / subtree 0.6 / node 0.25）
 *   Ô = Σ 算子权重 / Σ 全部算子权重
 *   Ĉ = 严格度反向权重（loose 1 / schema 0.55 / strict 0.15）
 * 注意：标量分只用于界面指示。真正的“自由度递减”由逐维约束保证（见 effectiveFreedom / checkMonotonicStrict）：
 *   E_k = Δ_0 ∧ Δ_1 ∧ … ∧ Δ_k   （∧ = 逐维取更严格者）
 */
export const SCOPE_WEIGHT: Record<Scope, number> = { artifact: 1, subtree: 0.6, node: 0.25 };
export const STRICT_WEIGHT: Record<Strictness, number> = { loose: 1, schema: 0.55, strict: 0.15 };
const STRICT_RANK: Record<Strictness, number> = { loose: 0, schema: 1, strict: 2 };

/* ───── 算子注册表：核心不写死算子集合，新算子声明权重与合并语义即可接入 ───── */
export type MergeStrategy = 'replace-root' | 'append-children' | 'keep-children' | 'replace';
export interface OpDef { id: string; label: string; desc: string; weight: number; merge: MergeStrategy }
export const OP_REGISTRY = new Map<string, OpDef>();
export const OP_WEIGHT: Record<string, number> = {};
export const OP_LABEL: Record<string, string> = {};
export const OP_DESC: Record<string, string> = {};
let OP_TOTAL = 0;
export function registerOp(d: OpDef) {
  OP_REGISTRY.set(d.id, d);
  OP_WEIGHT[d.id] = d.weight; OP_LABEL[d.id] = d.label; OP_DESC[d.id] = d.desc;
  OP_TOTAL = [...OP_REGISTRY.values()].filter((x) => BUILTIN_OPS.includes(x.id as OpKind)).reduce((a, b) => a + b.weight, 0) || 1;
}
export const BUILTIN_OPS: OpKind[] = ['generate', 'expand', 'restructure', 'detail', 'rewrite', 'patch'];
export function listOps(): string[] { return [...OP_REGISTRY.keys()]; }
([
  { id: 'generate', label: '生成', weight: 1, merge: 'replace-root', desc: '从种子想法生成完整的粗略初稿（最大自由度）' },
  { id: 'expand', label: '扩展', weight: 0.8, merge: 'append-children', desc: '为选中部分新增子项，向下展开一层或多层' },
  { id: 'restructure', label: '重组', weight: 0.7, merge: 'replace', desc: '重新组织选中部分的子项顺序与分组，不改变核心含义' },
  { id: 'detail', label: '细化', weight: 0.55, merge: 'replace', desc: '为选中部分补充细节、描述与属性，使其更具体' },
  { id: 'rewrite', label: '改写', weight: 0.45, merge: 'keep-children', desc: '在保持结构不变的前提下改写选中部分的表述' },
  { id: 'patch', label: '微调', weight: 0.2, merge: 'keep-children', desc: '严格按照指令做最小改动，其他内容逐字保持不变（最低自由度）' },
] as OpDef[]).forEach(registerOp);

export const SCOPE_LABEL: Record<Scope, string> = { artifact: '整体', subtree: '子树', node: '单节点' };
export const STRICT_LABEL: Record<Strictness, string> = { loose: '宽松', schema: '遵守结构', strict: '严格保持' };

export interface FreedomFacets { temperature: number; scope: number; ops: number; constraint: number; score: number }

export function freedomFacets(f: FreedomSpec): FreedomFacets {
  const t = Math.min(1, Math.max(0, f.temperature / 1.2));
  const s = Math.max(0, ...f.scope.map((x) => SCOPE_WEIGHT[x] ?? 0));
  const o = Math.min(1, f.ops.reduce((a, op) => a + (OP_WEIGHT[op] ?? 0), 0) / OP_TOTAL);
  let c = STRICT_WEIGHT[f.strictness] ?? 0.5;
  if (f.lockedProps?.length) c *= 0.85;
  if (f.requireTarget) c *= 0.8;
  if (f.frozen) return { temperature: 0, scope: 0, ops: 0, constraint: 0, score: 0 };
  const score = Math.round(100 * (0.35 * t + 0.25 * s + 0.25 * o + 0.15 * c));
  return { temperature: t, scope: s, ops: o, constraint: c, score };
}

export function freedomScore(f: FreedomSpec): number {
  return freedomFacets(f).score;
}

const maxOpWeight = (f: FreedomSpec) => Math.max(0, ...f.ops.map((o) => OP_WEIGHT[o] ?? 0));
const widest = (f: FreedomSpec) => Math.max(0, ...f.scope.map((x) => SCOPE_WEIGHT[x] ?? 0));

/**
 * 逐维 meet：阶段 i 的有效自由度 = 阶段 0..i 声明的逐维最严值。
 * - 温度取最小；最强算子权重、最宽作用域取最小（超出者被剔除）；严格度取最严；
 * - maxNewNodes 取最小；lockedProps 取并集；requireTarget / frozen 一旦开启向后继承（冻结阶段本身不需要目标）。
 * 因此“自由度递减”由构造保证，而不依赖插件作者自觉。
 */
export function effectiveFreedom(stages: StageDef[], i: number): FreedomSpec {
  const cur = stages[i].freedom;
  let temp = cur.temperature, opCap = maxOpWeight(cur), scopeCap = widest(cur), strict = cur.strictness;
  let maxNew = cur.maxNewNodes;
  const locked = new Set(cur.lockedProps ?? []);
  let requireTarget = !!cur.requireTarget, frozen = !!cur.frozen;
  for (let k = 0; k < i; k++) {
    const p = stages[k].freedom;
    if (p.frozen) { frozen = true; continue; }
    temp = Math.min(temp, p.temperature);
    opCap = Math.min(opCap, maxOpWeight(p));
    scopeCap = Math.min(scopeCap, widest(p));
    if (STRICT_RANK[p.strictness] > STRICT_RANK[strict]) strict = p.strictness;
    if (p.maxNewNodes != null) maxNew = maxNew == null ? p.maxNewNodes : Math.min(maxNew, p.maxNewNodes);
    for (const l of p.lockedProps ?? []) locked.add(l);
    if (p.requireTarget) requireTarget = true;
  }
  let ops = cur.ops.filter((o) => (OP_WEIGHT[o] ?? 0) <= opCap + 1e-9);
  if (!ops.length) ops = cur.ops.slice(0, 1);
  let scope = cur.scope.filter((x) => SCOPE_WEIGHT[x] <= scopeCap + 1e-9);
  if (!scope.length) scope = cur.scope.slice(0, 1);
  const out: FreedomSpec = { ...cur, temperature: temp, ops, scope, strictness: strict };
  if (maxNew != null) out.maxNewNodes = maxNew;
  if (locked.size) out.lockedProps = [...locked];
  if (requireTarget && !frozen) out.requireTarget = true;
  if (frozen) { out.frozen = true; delete out.requireTarget; }
  return out;
}

/** 逐维单调校验：指出“哪一维被放宽了”（运行时会被 effectiveFreedom 收紧） */
export function checkMonotonicStrict(stages: StageDef[]): string[] {
  const w: string[] = [];
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1].freedom, b = stages[i].freedom, n = stages[i].name, pn = stages[i - 1].name;
    if (b.frozen) continue;
    if (a.frozen) { w.push(`阶段「${n}」位于冻结阶段「${pn}」之后，将被视为冻结`); continue; }
    if (b.temperature > a.temperature + 1e-9) w.push(`阶段「${n}」放宽了【温度】${a.temperature} → ${b.temperature}`);
    if (maxOpWeight(b) > maxOpWeight(a) + 1e-9) w.push(`阶段「${n}」放宽了【算子】：重新允许了比「${pn}」更强的算子（${b.ops.filter((o) => (OP_WEIGHT[o] ?? 0) > maxOpWeight(a)).map((o) => OP_LABEL[o] ?? o).join('、')}）`);
    if (widest(b) > widest(a) + 1e-9) w.push(`阶段「${n}」放宽了【作用域】：${a.scope.join('/')} → ${b.scope.join('/')}`);
    if (STRICT_RANK[b.strictness] < STRICT_RANK[a.strictness]) w.push(`阶段「${n}」放宽了【严格度】：${STRICT_LABEL[a.strictness]} → ${STRICT_LABEL[b.strictness]}`);
    if (a.maxNewNodes != null && (b.maxNewNodes == null || b.maxNewNodes > a.maxNewNodes)) w.push(`阶段「${n}」放宽了【新增上限】：${a.maxNewNodes} → ${b.maxNewNodes ?? '不限'}`);
  }
  return w;
}

/** 校验阶段序列：标量分单调 + 逐维单调，返回警告列表 */
export function checkMonotonic(stages: StageDef[]): string[] {
  return [...checkMonotonicScore(stages), ...checkMonotonicStrict(stages)];
}

/** 仅比较标量分（界面曲线用） */
export function checkMonotonicScore(stages: StageDef[]): string[] {
  const warns: string[] = [];
  for (let i = 1; i < stages.length; i++) {
    const a = freedomScore(stages[i - 1].freedom);
    const b = freedomScore(stages[i].freedom);
    if (b > a) warns.push(`阶段「${stages[i].name}」自由度 ${b} 高于上一阶段「${stages[i - 1].name}」的 ${a}，违反“自由度递减”原则`);
  }
  return warns;
}

/** 把自由度向量翻译为自然语言约束（注入提示词） */
export function describeConstraints(f: FreedomSpec, hasTarget: boolean, ctx: { hasLocked?: boolean; hasPinned?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`- 当前自由度：${freedomScore(f)}/100（数值越低越需要克制）`);
  lines.push(`- 作用范围：${hasTarget ? '仅限选中的部分，其他部分不得改动' : '整份内容'}`);
  if (f.strictness === 'strict') lines.push('- 严格模式：除指令明确要求的地方外，所有内容必须逐字保持不变');
  else if (f.strictness === 'schema') lines.push('- 必须遵守既定结构与字段定义，保持已有节点的 id 不变');
  else lines.push('- 可以自由发挥、大胆提出方案');
  if (f.maxNewNodes != null) lines.push(`- 本次最多新增 ${f.maxNewNodes} 个节点`);
  if (f.lockedProps?.length) lines.push(`- 以下属性不得修改：${f.lockedProps.join(', ')}`);
  if (ctx.hasPinned) lines.push('- 带有 [手动固定] 标记（pinned）的字段是用户亲手修改过的，必须原样保留');
  if (ctx.hasLocked) lines.push('- 带有 [锁定] 标记（locked: true）的已有节点必须原样保留，不要新建名为 locked 的节点');
  if (f.frozen) lines.push('- 冻结阶段：内容不得做任何修改');
  return lines.join('\n');
}
