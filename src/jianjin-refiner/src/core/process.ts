import { validateManifest } from './manifest';
import { checkMonotonicStrict, effectiveFreedom, listOps, OP_WEIGHT, SCOPE_WEIGHT } from './freedom';
import { DEFAULT_PIPELINE } from './roles';
import { extractJSON } from './parse';
import { uid } from './tree';
import { splitDetail } from './errors';
import type { AgentLogEntry, FreedomSpec, OpKind, PipelineDef, PropDef, Providers, Scope, StageDef, Strictness, TypeManifest } from './types';

/**
 * 流程规划（Process Planning）—— 产品的第一层抽象：
 * 任何意图（婚礼、公司战略、一首歌、数据库结构、一次旅行、一个研究问题……）都被映射为同一个过程：
 *   制品状态 S 沿检查点 c_0 … c_n 演进，自由度向量 F(c_k) 逐维单调不增，
 *   每个检查点允许的算子集合由 F 限定，智能体是算子的执行者，用户的编辑成为约束。
 * “类型/插件”只是缓存下来的蓝图（模板）。本模块不包含任何场景知识：
 * 场景由流程规划师（一个智能体）在运行时推断；推断结果经 validateManifest + 逐维单调检查，错误回流给修订者；
 * 无论模型输出什么，最终都会得到一个合法、单调的蓝图（最差情况下回退为通用大纲型蓝图）。
 */

export interface TemplateMatch { id: string; name: string; score: number }
export interface BlueprintShape {
  name?: string; icon?: string; summary?: string; renderer?: string; views?: string[];
  levels?: string[]; childLabel?: string; props?: PropDef[]; parts?: string[]; template?: string;
}
export interface ScheduleStage {
  id?: string; name: string; description?: string; temperature?: number; scope?: Scope[]; ops?: OpKind[];
  strictness?: Strictness; maxNewNodes?: number; requireTarget?: boolean; guidance?: string;
}
export interface PlanRequest {
  intent: string;
  providers: Providers;
  /** 模板库（注册表中的蓝图）：用于相似度匹配，规划师可选择复用 */
  templates?: TypeManifest[];
  /** 用户指定使用某个模板 */
  templateId?: string;
  /** 已注册的渲染积木（界面层提供），用于约束规划师可选的视图 */
  renderers?: string[];
  signal?: AbortSignal;
  onLog?: (e: AgentLogEntry) => void;
  onDelta?: (stepId: string, d: string) => void;
  maxRepairRounds?: number;
}
export interface PlanResult {
  manifest: TypeManifest;
  source: 'derived' | 'template' | 'fallback';
  candidates: TemplateMatch[];
  log: AgentLogEntry[];
  warnings: string[];
  /** 模型没有按要求返回规划时的提示（界面黄条显示）；正常为 undefined */
  degraded?: string;
}

/* ───── 1. 模板相似度（纯文本统计，无场景知识） ───── */

/** 过于通用、不携带领域信息的二元组 */
const STOP = new Set(['一个', '一场', '一款', '一份', '一次', '一首', '一套', '一部', '一下', '如何', '怎么', '我们', '我的', '帮我', '设计', '策划', '制作', '完成', '进行', '规划', '计划', '准备', '打造', '搭建', '想要', '需要', '可以', '以及', '的一', '一些']);
function grams(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const w of t.match(/[a-z0-9]{2,}/g) ?? []) if (!STOP.has(w)) out.add(w);
  for (const run of t.match(/[\u4e00-\u9fff]+/g) ?? []) for (let i = 0; i + 1 < run.length; i++) { const g = run.slice(i, i + 2); if (!STOP.has(g)) out.add(g); }
  return out;
}
export function templateSimilarity(intent: string, m: TypeManifest): number {
  const gi = grams(intent);
  if (!gi.size) return 0;
  const gn = grams(m.name);
  const gt = grams([m.name, m.description, m.seedPlaceholder, m.category].filter(Boolean).join(' '));
  const nameCov = gn.size ? [...gn].filter((g) => gi.has(g)).length / gn.size : 0;
  const intentCov = [...gi].filter((g) => gt.has(g)).length / gi.size;
  return Math.round((0.6 * nameCov + 0.4 * intentCov) * 100) / 100;
}
export function matchTemplates(intent: string, templates: TypeManifest[], top = 3): TemplateMatch[] {
  return templates.map((m) => ({ id: m.id, name: m.name, score: templateSimilarity(intent, m) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, top);
}
/** 相似度达到该值时，演示规划师会直接复用模板 */
export const TEMPLATE_REUSE_THRESHOLD = 0.45;

/* ───── 2. 自由度时间表：n 个检查点 → 逐维单调的 FreedomSpec 序列（与场景无关） ───── */

const GENERIC_NAMES: Record<number, string[]> = {
  1: ['生成'], 2: ['草拟', '定稿'], 3: ['生成', '细化', '调整'], 4: ['发散', '成形', '细化', '定稿'],
  5: ['发散', '收敛', '成形', '细化', '打磨'], 6: ['发散', '收敛', '成形', '细化', '打磨', '定稿'],
};
export function genericCheckpointNames(n: number): string[] {
  const k = Math.max(1, Math.min(6, n));
  return GENERIC_NAMES[k];
}
/** 在 t∈[0,1]（0 = 最自由，1 = 最收敛）处的自由度 */
export function freedomAt(t: number): FreedomSpec {
  const r = (x: number) => Math.round(x * 100) / 100;
  if (t <= 0) return { temperature: 1.0, scope: ['artifact'], ops: ['generate'], strictness: 'loose' };
  const f: FreedomSpec = t < 0.45 ? { temperature: r(1.0 - 0.6 * t), scope: ['artifact', 'subtree'], ops: ['expand', 'detail', 'restructure'], strictness: 'schema' }
    : t < 0.8 ? { temperature: r(1.0 - 0.7 * t), scope: ['artifact', 'subtree', 'node'].slice(t < 0.6 ? 0 : 1) as Scope[], ops: ['detail', 'rewrite'], strictness: 'schema' }
      : { temperature: r(Math.max(0.2, 1.0 - 0.8 * t)), scope: ['subtree', 'node'], ops: ['rewrite', 'patch'], strictness: 'strict', requireTarget: true };
  f.maxNewNodes = Math.max(0, Math.round(30 * Math.pow(1 - t, 1.6)));
  return f;
}
const LIGHT_PIPELINE: PipelineDef = { steps: [{ id: 'generator', role: 'generator' }, { id: 'consistency', role: 'consistency', needs: ['generator'] }] };
/** 由检查点名称生成一条单调的自由度时间表 */
export function buildSchedule(names: string[], descs: (string | undefined)[] = []): StageDef[] {
  const n = names.length;
  return names.map((name, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    const freedom = freedomAt(t);
    return { id: `cp${i + 1}`, name, description: descs[i] ?? describeT(t), freedom, ...(freedom.strictness === 'strict' ? { pipeline: LIGHT_PIPELINE } : {}) };
  });
}
function describeT(t: number) {
  return t <= 0 ? '从意图出发生成整体初稿，自由度最高' : t < 0.45 ? '在既有骨架上扩展、细化、重组' : t < 0.8 ? '补足细节，改写表述，不再大改结构' : '选中具体片段做精确的小范围修改';
}
/** 兜底：把任意阶段序列收紧为逐维单调（每个检查点取其与之前所有检查点的逐维 meet） */
export function enforceMonotone(stages: StageDef[]): StageDef[] {
  const out: StageDef[] = [];
  stages.forEach((s, i) => {
    const f = { ...effectiveFreedom(stages, i) };
    const prev = out[i - 1]?.freedom;
    if (prev && !f.frozen && !prev.frozen) {
      const w = (o: string) => OP_WEIGHT[o] ?? 0;
      const cap = Math.max(0, ...prev.ops.map(w));
      if (Math.max(0, ...f.ops.map(w)) > cap + 1e-9) { const ok = f.ops.filter((o) => w(o) <= cap + 1e-9); f.ops = ok.length ? ok : [prev.ops.reduce((a, b) => (w(a) <= w(b) ? a : b))]; }
      const sw = (x: Scope) => SCOPE_WEIGHT[x];
      const scap = Math.max(0, ...prev.scope.map(sw));
      if (Math.max(0, ...f.scope.map(sw)) > scap + 1e-9) { const ok = f.scope.filter((x) => sw(x) <= scap + 1e-9); f.scope = ok.length ? ok : [prev.scope.reduce((a, b) => (sw(a) <= sw(b) ? a : b))]; }
      if (prev.maxNewNodes != null && (f.maxNewNodes == null || f.maxNewNodes > prev.maxNewNodes)) f.maxNewNodes = prev.maxNewNodes;
      f.temperature = Math.min(f.temperature, prev.temperature);
      const R = { loose: 0, schema: 1, strict: 2 } as const;
      if (R[f.strictness] < R[prev.strictness]) f.strictness = prev.strictness;
    }
    out.push({ ...s, freedom: f });
  });
  return out;
}

/* ───── 3. 由形态 + 时间表组装蓝图（manifest），并做规范化 ───── */

const SCOPES: Scope[] = ['artifact', 'subtree', 'node'];
const STRICTS: Strictness[] = ['loose', 'schema', 'strict'];
const PROP_TYPES = ['string', 'text', 'number', 'enum', 'date', 'url'];
function slug(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); }

export function normalizeStage(s: ScheduleStage, i: number, n: number): StageDef {
  const base = freedomAt(n === 1 ? 0 : i / (n - 1));
  const ops = (s.ops ?? []).filter((o) => listOps().includes(o));
  const scope = (s.scope ?? []).filter((x) => SCOPES.includes(x));
  const f: FreedomSpec = {
    temperature: typeof s.temperature === 'number' && isFinite(s.temperature) ? Math.max(0, Math.min(1.5, s.temperature)) : base.temperature,
    scope: scope.length ? scope : base.scope,
    ops: ops.length ? ops : base.ops,
    strictness: STRICTS.includes(s.strictness as Strictness) ? s.strictness! : base.strictness,
  };
  const mx = s.maxNewNodes ?? base.maxNewNodes;
  if (mx != null && isFinite(mx)) f.maxNewNodes = Math.max(0, Math.round(mx));
  if (s.requireTarget ?? base.requireTarget) f.requireTarget = true;
  if (i === 0 && !f.ops.includes('generate')) f.ops = ['generate', ...f.ops];
  return { id: `cp${i + 1}`, name: String(s.name || `检查点 ${i + 1}`).slice(0, 12), description: s.description, guidance: s.guidance, freedom: f, ...(f.strictness === 'strict' ? { pipeline: LIGHT_PIPELINE } : {}) };
}

export function assembleBlueprint(intent: string, shape: BlueprintShape, schedule: ScheduleStage[] | undefined, renderers?: string[]): any {
  const okR = (r?: string) => !!r && (!renderers?.length || renderers.includes(r)) && r !== 'code' && r !== 'gallery';
  const renderer = okR(shape.renderer) ? shape.renderer! : 'tree';
  const views = [...new Set((shape.views ?? []).filter((v) => okR(v) && v !== renderer))].slice(0, 3);
  const props = (shape.props ?? []).filter((p) => p && p.key && /^[a-z][\w]*$/i.test(p.key) && PROP_TYPES.includes(p.type)).slice(0, 6)
    .map((p) => ({ key: p.key, label: String(p.label || p.key), type: p.type, ...(p.type === 'enum' && Array.isArray(p.options) && p.options.length ? { options: p.options.map(String).slice(0, 8) } : {}) }))
    .map((p) => (p.type === 'enum' && !(p as any).options ? { ...p, type: 'string' as const } : p));
  const stages = (schedule?.length ? schedule.slice(0, 8) : genericCheckpointNames(3).map((name) => ({ name }))).map((s, i, a) => normalizeStage(s, i, a.length));
  const parts = (shape.parts ?? []).map(String).filter(Boolean).slice(0, 8);
  const levels = (shape.levels ?? []).map(String).filter(Boolean).slice(0, 5);
  const name = String(shape.name || intent).replace(/\s+/g, ' ').slice(0, 20);
  return {
    id: `bp-${slug(intent + name)}`, name, icon: shape.icon, category: '流程蓝图',
    description: shape.summary ?? `由意图「${intent.slice(0, 40)}」即时派生的流程`,
    output: 'tree', renderer, views,
    ...(renderer === 'board' || views.includes('board') ? { rendererOptions: { groupBy: props.find((p) => p.type === 'enum')?.key } } : {}),
    nodeSchema: { props, childLabel: shape.childLabel || levels[levels.length - 1] || '要点', ...(levels.length ? { levels, maxDepth: Math.max(2, levels.length) } : {}) },
    stages, pipeline: DEFAULT_PIPELINE,
    prompts: {
      domain: [`用户的意图：${intent}`, levels.length ? `内容按层级组织：${levels.join(' → ')}。` : '', parts.length ? `建议的一级结构：${parts.join('、')}。` : ''].filter(Boolean).join('\n'),
    },
    exporters: ['markdown', 'json', 'csv'],
    seedPlaceholder: intent,
    demo: parts.length ? { root: { id: 'r', title: '{{seed}}', children: parts.map((p, i) => ({ id: `p${i}`, title: p })) } } : undefined,
    intent,
  };
}

/** 无需任何模型的通用蓝图：大纲形态 + 推断出的检查点数量（意图越长越复杂，检查点越多） */
export function genericBlueprint(intent: string, names?: string[]): TypeManifest {
  const n = names?.length ? names.length : intent.length > 40 ? 4 : 3;
  const raw = assembleBlueprint(intent, { name: intent.slice(0, 16), renderer: 'tree', views: ['mindmap', 'table', 'doc'] }, (names?.length ? names : genericCheckpointNames(n)).map((name) => ({ name })));
  const r = validateManifest(raw);
  return { ...r.manifest!, origin: { kind: 'fallback' } };
}

export function blueprintFromTemplate(t: TypeManifest, intent: string): TypeManifest {
  return { ...structuredCloneSafe(t), intent, origin: { kind: 'template', templateId: t.id, templateName: t.name } };
}
function structuredCloneSafe<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** 校验蓝图：结构错误 + 逐维单调违规（都回流给修订者） */
export function checkBlueprint(raw: any): { manifest: TypeManifest | null; problems: string[]; warnings: string[] } {
  const r = validateManifest(raw);
  if (!r.manifest) return { manifest: null, problems: r.errors, warnings: r.warnings };
  return { manifest: r.manifest, problems: checkMonotonicStrict(r.manifest.stages), warnings: r.warnings.filter((w) => !w.includes('运行时将按逐维取严')) };
}

/* ───── 4. 规划智能体：形态（高自由度）→ 时间表（中）→ 校验与修订（低） ───── */

const SHAPE_SYS = `你是“流程规划师”。用户会描述任何想做或想决定的事（任何领域）。你的任务不是完成它，而是推断：这件事最终的产物应该长什么样。
产物统一表示为一棵节点树：根节点 = 整体，子节点 = 部分，可以带结构化属性。只输出 JSON。`;
const SHAPE_TASK = (intent: string, cands: TemplateMatch[], renderers: string[]) => `意图：${intent}

请输出 JSON：
{
  "name": "这类产物的简短名称（≤10 字）",
  "icon": "Remix Icon 图标名，如 ri-calendar-line / ri-database-2-line / ri-music-2-line / ri-compass-3-line",
  "summary": "一句话说明产物是什么",
  "levels": ["第1层节点种类", "第2层节点种类", "第3层（可选）"],
  "props": [{"key": "英文键", "label": "中文名", "type": "string|text|number|enum|date|url", "options": ["enum 时的可选值"]}],
  "parts": ["建议的一级结构 3~6 个"],
  "renderer": "${renderers.join(' | ')} 之一（最适合的主视图）",
  "views": ["其他可切换视图"]${cands.length ? `,
  "template": "如果下列已有模板之一几乎完全合适，填它的 id，否则省略：${cands.map((c) => `${c.id}（${c.name}）`).join('、')}"` : ''}
}
props 最多 5 个，只放对这件事真正有用的属性（有时间就用 date 型 start/end，有状态就用 enum）。`;
const SCHEDULE_SYS = `你是“流程规划师”。你要为一件事设计“由粗到细、自由度由高到低”的推进节奏：若干个命名检查点，每个检查点声明自由度。只输出 JSON。`;
const SCHEDULE_TASK = (intent: string, shape: BlueprintShape) => `意图：${intent}
产物形态：${shape.name ?? ''}；层级：${(shape.levels ?? []).join(' → ')}

请输出 JSON：{"stages": [{"name": "检查点名（≤6 字）", "description": "这一步做什么", "temperature": 0~1.5, "scope": ["artifact"|"subtree"|"node"], "ops": [算子], "strictness": "loose|schema|strict", "maxNewNodes": 数字}]}
要求：
- 2~6 个检查点；第一个必须只用 generate、scope 为 artifact、strictness 为 loose。
- 算子由强到弱：generate > expand > restructure > detail > rewrite > patch。
- 自由度必须逐维单调不增：温度不升、最强算子不变强、作用域不变宽、严格度不变松、maxNewNodes 不增。`;
const REVISE_SYS = '你是流程蓝图的修订者。根据校验器给出的问题修正检查点序列，只输出 JSON。';
const REVISE_TASK = (stages: ScheduleStage[], problems: string[]) => `当前检查点序列：
${JSON.stringify(stages, null, 1)}

校验器发现的问题：
${problems.map((p) => '- ' + p).join('\n')}

请输出修正后的 JSON：{"stages": [...]}（保留名称与数量，只修正违规的维度，使自由度逐维单调不增）。`;

export async function planProcess(req: PlanRequest): Promise<PlanResult> {
  const intent = req.intent.trim();
  const log: AgentLogEntry[] = [];
  const warnings: string[] = [];
  const templates = req.templates ?? [];
  const candidates = matchTemplates(intent, templates);
  const renderers = (req.renderers?.length ? req.renderers : ['tree', 'mindmap', 'table', 'board', 'timeline', 'doc']).filter((r) => r !== 'code' && r !== 'gallery');
  const entry = (stepId: string, roleName: string, role = 'process-planner'): AgentLogEntry => {
    const e: AgentLogEntry = { id: uid('l'), stepId, role, roleName, status: 'running', startedAt: Date.now() };
    log.push(e); req.onLog?.({ ...e });
    return e;
  };
  const done = (e: AgentLogEntry, patch: Partial<AgentLogEntry>) => { Object.assign(e, { status: 'done', endedAt: Date.now() }, patch); req.onLog?.({ ...e }); };
  const ask = async (stepId: string, system: string, task: string, temperature: number, meta: Record<string, unknown>) => {
    const text = await req.providers.text.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: task }], temperature, meta: { ...meta, intent } }, (d) => req.onDelta?.(stepId, d), req.signal);
    let json: any = null;
    try { json = extractJSON(text); } catch { /* 交给后续兜底 */ }
    return { text, json };
  };

  // 用户指定模板：蓝图即模板的副本
  const forced = req.templateId ? templates.find((t) => t.id === req.templateId) : undefined;
  if (forced) {
    const e = entry('template', '模板');
    done(e, { summary: `使用模板「${forced.name}」：${forced.stages.length} 个检查点`, output: forced.stages.map((s) => s.name).join(' → ') });
    return { manifest: blueprintFromTemplate(forced, intent), source: 'template', candidates, log, warnings };
  }

  let callError: string | undefined;
  // ① 形态（自由度最高：推断产物是什么、长什么样）
  const e1 = entry('shape', '流程规划 · 形态');
  let shape: BlueprintShape = {};
  try {
    const r = await ask('shape', SHAPE_SYS, SHAPE_TASK(intent, candidates, renderers), 0.9, { role: 'process-shape', candidates, renderers });
    shape = r.json && typeof r.json === 'object' ? r.json : {};
    const tpl = shape.template ? templates.find((t) => t.id === shape.template) : undefined;
    if (tpl) {
      done(e1, { summary: `与模板「${tpl.name}」几乎一致，直接复用`, output: r.text });
      return { manifest: blueprintFromTemplate(tpl, intent), source: 'template', candidates, log, warnings };
    }
    done(e1, { summary: shape.name ? `产物：${shape.name}；层级 ${(shape.levels ?? []).join(' → ') || '—'}；属性 ${(shape.props ?? []).map((p) => p.label).join('、') || '无'}` : '未能解析形态，使用通用大纲形态', output: r.text });
  } catch (err: any) {
    if (req.signal?.aborted) throw err;
    callError = splitDetail(String(err?.message ?? err)).message;
    done(e1, { status: 'error', summary: '形态推断失败：' + callError + '；使用通用形态' });
  }

  // ② 检查点与自由度时间表（中等自由度：在形态确定后安排节奏）
  const e2 = entry('schedule', '流程规划 · 检查点');
  let schedule: ScheduleStage[] = [];
  try {
    const r = await ask('schedule', SCHEDULE_SYS, SCHEDULE_TASK(intent, shape), 0.5, { role: 'process-schedule', shape });
    schedule = Array.isArray(r.json?.stages) ? r.json.stages.filter((s: any) => s && typeof s === 'object') : [];
    done(e2, { summary: schedule.length ? `${schedule.length} 个检查点：${schedule.map((s) => s.name).join(' → ')}` : '未能解析检查点，使用通用节奏', output: r.text });
  } catch (err: any) {
    if (req.signal?.aborted) throw err;
    callError ??= splitDetail(String(err?.message ?? err)).message;
    done(e2, { status: 'error', summary: '检查点推断失败，使用通用节奏' });
  }

  // ③ 程序化校验 → 修订者（低自由度：只修违规的维度），最多 N 轮
  let raw = assembleBlueprint(intent, shape, schedule, req.renderers);
  let chk = checkBlueprint(raw);
  const rounds = req.maxRepairRounds ?? 2;
  for (let round = 1; round <= rounds && (chk.problems.length || !chk.manifest); round++) {
    const ev = entry(`check-${round}`, '蓝图校验', 'guard');
    done(ev, { summary: `发现 ${chk.problems.length} 个问题，回流给修订者`, output: chk.problems.join('\n') });
    const er = entry(`revise-${round}`, '蓝图修订', 'reviser');
    try {
      const cur = (raw.stages as StageDef[]).map((s) => ({ name: s.name, description: s.description, ...s.freedom }));
      const r = await ask(`revise-${round}`, REVISE_SYS, REVISE_TASK(cur, chk.problems), 0.2, { role: 'process-reviser', stages: cur, problems: chk.problems });
      const next = Array.isArray(r.json?.stages) ? r.json.stages : null;
      if (next?.length) { schedule = next; raw = assembleBlueprint(intent, shape, schedule, req.renderers); chk = checkBlueprint(raw); }
      done(er, { summary: chk.problems.length ? `仍有 ${chk.problems.length} 个问题` : '已修正，自由度逐维单调', output: r.text });
    } catch (err: any) {
      if (req.signal?.aborted) throw err;
      done(er, { status: 'error', summary: '修订失败：' + String(err?.message ?? err) });
      break;
    }
  }
  let manifest = chk.manifest;
  let source: PlanResult['source'] = 'derived';
  const lost = [!shape.name && !(shape.levels ?? []).length ? '产物形态' : '', !schedule.length ? '检查点' : ''].filter(Boolean);
  const degraded = callError ? `调用模型失败：${callError} 已先使用通用流程，你可以直接开始，或修好设置后重新规划。` : lost.length ? `模型没有返回有效的流程规划（${lost.join('、')}），已使用通用流程。你可以直接开始，或换个模型重新规划。` : undefined;
  if (!manifest) {
    warnings.push(`规划结果无法通过结构校验（${chk.problems.join('；')}），已回退为通用蓝图`);
    manifest = genericBlueprint(intent, (schedule ?? []).map((s) => s?.name).filter(Boolean) as string[]);
    source = 'fallback';
  } else if (chk.problems.length) {
    warnings.push(`自由度仍有放宽（${chk.problems.join('；')}），已按逐维取严自动收紧`);
    manifest = { ...manifest, stages: enforceMonotone(manifest.stages) };
  }
  warnings.push(...chk.warnings);
  const ef = entry('final', '蓝图定稿', 'guard');
  done(ef, { summary: `${manifest.stages.length} 个检查点，自由度逐维单调${source === 'fallback' ? '（通用回退）' : ''}` });
  return { manifest: { ...manifest, intent, origin: { kind: source === 'fallback' ? 'fallback' : 'derived' } }, source, candidates, log, warnings, degraded: source === 'fallback' ? (degraded ?? '模型返回的流程规划无法通过校验，已使用通用流程。') : degraded };
}

/* ───── 5. 澄清：意图含糊时，先问 1~3 个带选项的问题（与场景无关） ───── */
export interface ClarifyQuestion { id: string; q: string; options: string[] }
export const DEFAULT_CLARIFY: ClarifyQuestion[] = [
  { id: 'what', q: '你想做的是？', options: ['活动或计划', '文档或文章', '方案或决策', '设计或结构', '其他'] },
  { id: 'who', q: '给谁看？', options: ['自己', '团队', '客户或老板'] },
  { id: 'depth', q: '要多细？', options: ['一页概要', '可执行清单', '详细方案'] },
];
const VAGUE_WORDS = /(弄|搞|整|处理|弄弄|看看|随便|一下|东西|这个|那个|啥|什么都行|something|stuff|anything|help me)/i;
export function compactLen(intent: string): number { return (intent ?? '').replace(/[\s\p{P}\p{S}]/gu, '').length; }
/** 明显含糊：太短（<5 字）或主要由“弄一下/这个/东西”之类的填充词构成 */
export function isVagueIntent(intent: string): boolean {
  const n = compactLen(intent);
  if (n < 5) return true;
  const stripped = intent.replace(new RegExp(VAGUE_WORDS.source, 'gi'), '').replace(/(帮我|帮忙|请|我想|我要|给我|你|我)/g, '');
  return VAGUE_WORDS.test(intent) && compactLen(stripped) < 4;
}
/** 值得问一下：明显含糊，或少于 8 个字（交给模型判断是否需要追问） */
export function shouldClarify(intent: string): boolean { return isVagueIntent(intent) || compactLen(intent) < 8; }
const CLARIFY_SYS = '你是“流程规划师”的助手。用户的意图可能太含糊，无法规划。只输出 JSON。';
const CLARIFY_TASK = (intent: string) => `意图：「${intent}」
如果意图已经足够清楚（能看出要做什么），输出 {"questions": []}。
否则输出最多 3 个澄清问题，每个带 2~5 个简短选项：{"questions": [{"q": "问题", "options": ["选项1", "选项2"]}]}
问题应当帮助弄清：要做的是什么、给谁用、要多细。
优先问**决定成本、范围、时间的事实**（只有用户知道、AI 猜错代价最大的那些）：例如预算类必问总额、地点（城市）、档次；计划类必问截止时间、人手；活动类必问人数、日期。`;
export async function clarifyIntent(req: { intent: string; providers: Providers; signal?: AbortSignal }): Promise<ClarifyQuestion[]> {
  const intent = req.intent.trim();
  if (!shouldClarify(intent)) return [];
  try {
    const text = await req.providers.text.chat({ messages: [{ role: 'system', content: CLARIFY_SYS }, { role: 'user', content: CLARIFY_TASK(intent) }], temperature: 0.3, meta: { role: 'process-clarify', intent, vague: isVagueIntent(intent) } }, undefined, req.signal);
    const j = extractJSON(text);
    const qs = Array.isArray(j?.questions) ? j.questions : [];
    const out = qs.filter((x: any) => x && typeof x.q === 'string' && x.q.trim()).slice(0, 3).map((x: any, i: number) => ({ id: `q${i + 1}`, q: String(x.q).trim(), options: (Array.isArray(x.options) ? x.options : []).map(String).filter(Boolean).slice(0, 5) }));
    if (!out.length && isVagueIntent(intent)) return DEFAULT_CLARIFY; // 模型说“清楚”，但确实太含糊
    return out;
  } catch (e) {
    if (req.signal?.aborted) throw e;
    return isVagueIntent(intent) ? DEFAULT_CLARIFY : []; // 模型失败也不阻塞：含糊时退回通用问题
  }
}
/** 把回答拼进意图（未回答的跳过） */
export function composeIntent(intent: string, questions: ClarifyQuestion[], answers: Record<string, string>): string {
  const parts = questions.map((q) => (answers[q.id]?.trim() ? `${q.q.replace(/[？?]$/, '')}：${answers[q.id].trim()}` : '')).filter(Boolean);
  return parts.length ? `${intent.trim()}（${parts.join('；')}）` : intent.trim();
}

/** 把蓝图另存为模板：换一个稳定的 id，去掉一次性信息 */
export function blueprintToTemplate(m: TypeManifest, name?: string): TypeManifest {
  const { origin: _o, intent: _i, ...rest } = m;
  const nm = name || m.name;
  return { ...rest, id: `tpl-${slug(nm + Date.now())}`, name: nm, category: '我的模板' };
}
