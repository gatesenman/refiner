import { stripWhys } from './reasons';
import { prefBlock } from './prefs';
import { DEFAULT_PIPELINE, DEFAULT_ROLES } from './roles';
import { describeConstraints, effectiveFreedom, OP_DESC, OP_LABEL, OP_REGISTRY } from './freedom';
import { getCheck } from './checks';
import { extractJSON, extractText } from './parse';
import { render, evalWhen } from './template';
import {
  ancestors, clone, collectIds, findNode, insertByOrder, normalizeNode, replaceNode, toOutlineText, toPromptJSON, uid, walk,
} from './tree';
import { fillNumbers } from './numbers';
import type {
  AgentLogEntry, AgentRoleDef, AgentStep, ArtNode, FreedomSpec, MediaProvider, MediaSpec, RunRequest, RunResult, TypeManifest, Version, Scope,
} from './types';

export class EngineError extends Error {}

/** 本次运行失败（不提交版本）：例如模型没有按要求返回内容。raw 为模型原始回复，便于“查看原始回复” */
export class RunFailedError extends EngineError {
  kind: 'junk' | 'empty';
  raw?: string;
  log: AgentLogEntry[] = [];
  constructor(message: string, kind: 'junk' | 'empty', raw?: string) { super(message); this.kind = kind; this.raw = raw; this.name = 'RunFailedError'; }
}

export const JUNK_MESSAGE = '这次 AI 没有按要求返回内容，已保留原样，未做任何修改。可能原因：模型能力不足或输出被截断。';
const REFUSAL = /^[\s"'“「]*(抱歉|对不起|不好意思|我不(太)?(明白|理解|清楚|确定|知道)|我无法|我不能|作为(一个)?(AI|人工智能|语言模型)|sorry|i('m| am) (sorry|not sure|unable)|i can(no|')t|as an ai)/i;

/** 产出是否为“垃圾”：拒答、空内容、无法解析成结构（与场景无关的通用判据） */
export function isJunkText(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return true;
  if (/```/.test(t)) return false;
  return REFUSAL.test(t) && t.length < 400;
}
export function isJunkTree(obj: unknown, raw: string): boolean {
  if (obj == null || typeof obj !== 'object') return true; // jsonrepair 会把任意文本修成字符串
  const o: any = Array.isArray(obj) ? { children: obj } : ((obj as any).root ?? obj);
  if (!o || typeof o !== 'object') return true;
  const title = String(o.title ?? o.name ?? o.label ?? '').trim();
  const kids = Array.isArray(o.children) ? o.children : Array.isArray(o.items) ? o.items : [];
  const content = String(o.content ?? o.description ?? '').trim();
  if (!title && !kids.length && !content) return true;
  if (!kids.length && (REFUSAL.test(title) || REFUSAL.test(content))) return true;
  if (!kids.length && REFUSAL.test(raw.trim())) return true;
  return false;
}

/** 拓扑排序：needs 只表达先后顺序；被跳过的依赖不阻塞后续步骤 */
export function orderSteps(steps: AgentStep[]): AgentStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done = new Set<string>();
  const out: AgentStep[] = [];
  const visiting = new Set<string>();
  const visit = (s: AgentStep) => {
    if (done.has(s.id)) return;
    if (visiting.has(s.id)) throw new EngineError(`智能体流水线存在循环依赖：${s.id}`);
    visiting.add(s.id);
    for (const d of s.needs ?? []) { const dep = byId.get(d); if (dep) visit(dep); }
    visiting.delete(s.id);
    done.add(s.id);
    out.push(s);
  };
  steps.forEach(visit);
  return out;
}

export function resolveRoles(manifest: TypeManifest, extra?: Record<string, AgentRoleDef>): Record<string, AgentRoleDef> {
  const roles: Record<string, AgentRoleDef> = { ...DEFAULT_ROLES, ...(extra ?? {}) };
  for (const [id, r] of Object.entries(manifest.roles ?? {})) {
    roles[id] = { ...(roles[id] ?? { id, name: id, output: 'review', system: '', task: '' }), ...r, id } as AgentRoleDef;
  }
  return roles;
}

export function stagePipeline(manifest: TypeManifest, stageIndex: number) {
  return manifest.stages[stageIndex]?.pipeline ?? manifest.pipeline ?? DEFAULT_PIPELINE;
}

function schemaText(m: TypeManifest): string {
  const props = m.nodeSchema?.props ?? [];
  if (!props.length) return '';
  return props.map((p) => `- props.${p.key}（${p.label}）：${p.type}${p.options ? ' 可选值 ' + p.options.join(' / ') : ''}${p.type === 'number' ? '（数字。必须填写在 props.' + p.key + ' 里，不要只写在说明文字里）' : ''}`).join('\n');
}

function formatText(m: TypeManifest, hasSelection: boolean, op: string): string {
  if (m.output === 'text') {
    if (hasSelection) return `只输出替换“选中片段”的新文本，放在 \`\`\`${m.language ?? 'text'} 代码块中，不要输出其它部分。`;
    return `输出完整的${m.language ?? '文本'}内容，放在一个 \`\`\`${m.language ?? 'text'} 代码块中，不要额外解释。${m.prompts?.format ?? ''}`;
  }
  return [
    '只输出一个 JSON 对象（不要任何解释或 Markdown），结构：',
    '{"id": "已有节点保留原 id，新节点省略", "title": "标题", "content": "可选，正文/说明", "props": {可选，按属性定义}, "children": [同结构子节点…]}',
    op === 'generate'
      ? '输出完整的根节点：title 为主题，children 中包含多个（通常 4~8 个）一级部分，必要时每个部分再包含子项。\n示例：{"title":"主题","children":[{"title":"第一部分","content":"一句话说明","children":[{"title":"要点一"},{"title":"要点二"}]},{"title":"第二部分","children":[{"title":"要点一"}]}]}'
      : op === 'expand'
        ? '输出处理后的【目标部分】完整子树（根为目标节点本身，保留其 id 与已有子项），并在 children 中追加若干新的子项。'
        : '输出处理后的【目标部分】完整子树（根为目标节点本身，保留其 id）。',
    '新增或修改的节点可以带一个 why 字段：一句话说明为什么这样改（会展示给用户，不会写进内容）。',
    m.nodeSchema?.maxDepth ? `树深度不超过 ${m.nodeSchema.maxDepth} 层。` : '',
    m.prompts?.format ?? '',
  ].filter(Boolean).join('\n');
}

/** 评审输出规范化：所有启发式集中在这里，无效评分显式标注而不是默默给个默认分 */
export function normalizeReview(text: string): { score?: number; ok?: boolean; issues: string[]; suggestions: string[]; note?: string; questions?: { q: string; options?: string[] }[] } {
  let r: any;
  try { r = extractJSON(text); } catch { return { issues: [], suggestions: [], note: '评分无效：无法解析评审输出' }; }
  if (!r || typeof r !== 'object') return { issues: [], suggestions: [], note: '评分无效：评审输出不是 JSON 对象' };
  const issues: string[] = Array.isArray(r.issues) ? r.issues.map(String) : [];
  const suggestions: string[] = Array.isArray(r.suggestions) ? r.suggestions.map(String) : [];
  let score: number | undefined = typeof r.score === 'number' ? r.score : parseFloat(String(r.score ?? ''));
  let note: string | undefined;
  if (score == null || Number.isNaN(score)) { score = undefined; note = '评分缺失'; }
  else if (score > 10 && score <= 100) { score = Math.round(score) / 10; note = '百分制已换算为十分制'; }
  else if (score > 100 || score < 0) { score = undefined; note = '评分越界，已忽略'; }
  else if (score === 0 && !issues.length) { score = undefined; note = '评分无效：0 分却没有指出问题，已忽略'; }
  const ok = typeof r.ok === 'boolean' ? r.ok : score != null ? score >= 8 : undefined;
  const questions = Array.isArray(r.questions) ? r.questions.map((x: any) => (typeof x === 'string' ? { q: x } : { q: String(x?.q ?? x?.question ?? ''), options: Array.isArray(x?.options) ? x.options.map(String).slice(0, 5) : undefined })).filter((x: any) => x.q) : undefined;
  return { score, ok, issues, suggestions, note, ...(questions?.length ? { questions } : {}) };
}

/** 主入口：在一个阶段上执行一次操作，产出新版本 */
export async function runStage(req: RunRequest): Promise<RunResult> {
  const { artifact, manifest, stageIndex, op, providers } = req;
  const stage = manifest.stages[stageIndex];
  if (!stage) throw new EngineError('阶段不存在');
  // 有效自由度 = 0..i 阶段逐维取严（约束自动向后继承）
  const f = effectiveFreedom(manifest.stages, stageIndex);
  if (!f.ops.includes(op)) throw new EngineError(`阶段「${stage.name}」不允许「${OP_LABEL[op] ?? op}」操作`);

  const isText = manifest.output === 'text';
  const oldRoot = artifact.root;
  let target = req.targetId && op !== 'generate' && !f.frozen ? findNode(oldRoot, req.targetId) : null;
  if (target && target.id === oldRoot.id) target = null;
  const sel = isText && op !== 'generate' && !f.frozen && req.selection && req.selection.text ? req.selection : undefined;
  const hasTarget = !!target || !!sel;

  const scope: Scope = !hasTarget ? 'artifact' : (op === 'patch' || op === 'rewrite') ? 'node' : 'subtree';
  const scopeOk = f.scope.includes(scope) || (scope === 'node' && f.scope.includes('subtree')) || (scope === 'subtree' && f.scope.includes('node') && op !== 'expand');
  if (!scopeOk && !f.frozen) {
    if (scope === 'artifact') throw new EngineError(`阶段「${stage.name}」需要先在编辑区选中一个具体部分`);
    throw new EngineError(`阶段「${stage.name}」只允许作用于整体（${f.scope.join('/')}）`);
  }
  if (f.requireTarget && !hasTarget && !f.frozen) throw new EngineError(`阶段「${stage.name}」需要先选中一个具体部分`);
  if (target?.locked) throw new EngineError(`「${target.title}」已锁定，不能修改`);
  if (target) {
    const la = ancestors(oldRoot, target.id).find((n) => n.locked);
    if (la) throw new EngineError(`上级「${la.title}」已锁定，其下的内容不能修改（先解锁上级）`);
  }

  // 回到更早阶段 = 显式放宽
  const headV = artifact.versions.find((v) => v.id === artifact.head);
  const headStage = headV && headV.op !== 'init' ? manifest.stages.findIndex((s) => s.id === headV.stageId) : -1;
  const loosened = headStage > stageIndex;

  const roles = resolveRoles(manifest, req.roles);
  const allSteps = stagePipeline(manifest, stageIndex).steps;
  const steps = orderSteps(allSteps);
  const stepById = new Map(allSteps.map((x) => [x.id, x]));
  const disabled = new Set(req.disabledSteps ?? []);
  const log: AgentLogEntry[] = [];
  const warnings: string[] = [];
  const results: Record<string, any> = {};

  let hasLocked = false, hasPinned = false;
  walk(oldRoot, (n) => { if (n.locked) hasLocked = true; if (n.pinned?.length) hasPinned = true; });
  const currentText = isText ? (oldRoot.content ?? '') : toPromptJSON(oldRoot);
  const vars: Record<string, any> = {
    type: { ...manifest, prompts: { domain: manifest.prompts?.domain ?? '', format: manifest.prompts?.format ?? '' } },
    stage: { ...stage, guidance: stage.guidance ?? '', description: stage.description ?? '' },
    seed: artifact.seed,
    op, opLabel: OP_LABEL[op] ?? op, opDesc: OP_DESC[op] ?? '',
    instruction: req.instruction?.trim() ?? '',
    constraints: describeConstraints(f, hasTarget, { hasLocked, hasPinned }),
    schema: schemaText(manifest),
    outline: isText ? (oldRoot.content ?? '（空）') : (oldRoot.children?.length ? toOutlineText(oldRoot) : '（空）'),
    // 有目标时只给“目标子树 + 祖先摘要”，不再给全文（防止模型返回整份文档被并进目标）
    current: op === 'generate' ? '' : (sel ? (oldRoot.content ?? '') : (target ? (isText ? '' : ancestryText(oldRoot, target)) : currentText)),
    ancestry: target && !isText ? ancestryText(oldRoot, target) : '',
    target: sel ? `选中片段：\n"""\n${sel.text}\n"""` : target ? toPromptJSON(target) : '',
    targetTitle: target?.title ?? (sel ? sel.text.slice(0, 30) : ''),
    format: formatText(manifest, !!sel, op),
    persona: req.persona ? `${req.persona.name}：${req.persona.brief}` : '',
    plan: '', draft: '', reviews: '',
  };

  const scored: { score: number; node: ArtNode | null; raw: string | null }[] = [];
  let draftRaw = null as string | null; // 文本型：文本；树型：JSON 字符串
  let draftNode = null as ArtNode | null;
  const reviewNotes: string[] = [];
  let attempt = 0;
  const baseTemp = f.temperature;
  const guardOpts = { op, freedom: f };

  const facts = (artifact.facts ?? []).filter((x) => x.a?.trim());
  const factBlock = facts.length ? `\n\n【固定事实】以下是用户确认过的事实，必须遵守，不要再猜：\n${facts.map((x) => `- ${x.q.replace(/[？?]\s*$/, '')}：${x.a}`).join('\n')}` : '';
  const refBlock = factBlock + prefBlock(artifact.prefs) + (req.references?.trim() ? `\n\n【参考资料】以下是用户提供的参考资料，内容须与之保持一致、优先采用其中的事实与约束：\n${req.references.trim()}` : '');
  const emit = (e: AgentLogEntry) => req.onLog?.({ ...e });
  const sysEntry = (stepId: string, roleName: string, summary: string, status: AgentLogEntry['status'] = 'done') => {
    const e: AgentLogEntry = { id: uid('log'), stepId, role: 'guard', roleName, status, startedAt: Date.now(), endedAt: Date.now(), summary };
    log.push(e); emit(e);
  };

  /** 草稿产出后立即做一次“只检查不修补”：守卫违规 + 类型声明的程序化检查，回流给后续修订者 */
  const checkDraft = () => {
    const issues: string[] = [];
    if (!isText && draftNode) {
      const merged = mergeTree(oldRoot, draftNode, op, target?.id);
      issues.push(...guard(oldRoot, merged, manifest, stageIndex, target?.id, guardOpts).warnings);
    }
    for (const id of manifest.checks ?? []) {
      const c = getCheck(id);
      if (!c) { warnings.push(`未注册的检查「${id}」`); continue; }
      const text = isText ? (sel ? spliceSelection(oldRoot.content ?? '', sel, draftRaw ?? '').text : draftRaw ?? '') : undefined;
      try { issues.push(...c.fn({ text, root: draftNode ?? undefined }, manifest).map((x) => `[${c.name}] ${x}`)); } catch (e: any) { issues.push(`[${c.name}] 检查异常：${e?.message ?? e}`); }
    }
    results.guard = { violations: issues.length, ok: issues.length === 0 };
    if (issues.length) {
      reviewNotes.push(`【约束守卫】发现 ${issues.length} 处违规，修订时必须纠正：\n${issues.map((i) => '- ' + i).join('\n')}`);
      vars.reviews = reviewNotes.join('\n\n');
      sysEntry('guard-check', '约束守卫（预检）', `发现 ${issues.length} 处违规，已回流给修订者：${issues[0]}`);
    }
  };

  const execStep = async (step: AgentStep, round?: number): Promise<boolean> => {
    const role = roles[step.role];
    const nm = (step.name ?? role?.name ?? step.role) + (round ? `（第 ${round} 轮）` : '');
    const entry: AgentLogEntry = { id: uid('log'), stepId: step.id, role: step.role, roleName: nm, status: 'running', startedAt: Date.now() };
    if (req.signal?.aborted) throw new EngineError('已取消');
    if (!role) { entry.status = 'error'; entry.summary = `未知角色 ${step.role}`; log.push(entry); emit(entry); return false; }
    emit(entry);
    try {
      if (role.output === 'media') {
        const base: ArtNode | null = draftNode ?? (isText ? null : clone(target ?? oldRoot));
        const spec = manifest.media;
        const cap = step.capability ?? role.capability ?? spec?.capability;
        if (!base || !spec || !cap) { entry.status = 'skipped'; entry.summary = !spec ? '类型未声明 media，跳过' : '无可处理的节点'; }
        else {
          entry.summary = await runMedia(base, { ...spec, capability: cap }, providers.media?.[cap], req.signal);
          draftNode = base;
          if (draftRaw == null) draftRaw = JSON.stringify(base);
          entry.status = 'done';
          results[step.id] = { ok: true };
        }
      } else {
        const temperature = Math.max(0, Math.min(1.5, baseTemp + (role.temperatureDelta ?? 0)));
        const messages = [
          { role: 'system' as const, content: (render(role.system, vars).trim() || `你是「${manifest.name}」助手。`) + refBlock },
          { role: 'user' as const, content: render(role.task, vars).trim() },
        ];
        const meta = {
          role: step.role, output: role.output, op, stageId: stage.id, typeId: manifest.id, manifestOutput: manifest.output,
          demo: manifest.demo, nodeSchema: manifest.nodeSchema, language: manifest.language, seed: artifact.seed,
          instruction: vars.instruction, target: target ? clone(target) : null, root: clone(oldRoot),
          selection: sel ?? null, draft: draftNode ? clone(draftNode) : draftRaw, attempt: attempt++, reviews: reviewNotes.slice(),
          persona: req.persona?.id,
        };
        const text = await providers.text.chat({ messages, temperature, meta }, (d) => req.onDelta?.(step.id, d), req.signal);
        entry.output = text;
        if (role.output === 'plan') {
          vars.plan = text.trim();
          results[step.id] = { ok: true, length: text.length };
          entry.summary = text.trim().split('\n').filter(Boolean).slice(0, 1).join(' ').slice(0, 80);
          entry.status = 'done';
        } else if (role.output === 'review') {
          const r = normalizeReview(text);
          const prevScore = results[step.id]?.score;
          results[step.id] = { score: r.score, ok: r.ok, issues: r.issues.length, invalid: r.score == null };
          entry.score = r.score;
          if (r.score != null && step.role === 'critic') {
            results.__scores = [...(results.__scores ?? []), r.score];
            // 记录“这一份草稿得了多少分”，修订后变差时可以退回更好的一版
            scored.push({ score: r.score, node: draftNode ? clone(draftNode) : null, raw: draftRaw });
          }
          if (r.questions?.length) results.__questions = [...(results.__questions ?? []), ...r.questions];
          if (r.issues.length && !results.__issues) results.__issues = r.issues.slice(0, 4);
          entry.summary = (r.score != null ? `评分 ${r.score}/10` : '评分无效')
            + (prevScore != null && r.score != null ? `（上轮 ${prevScore}）` : '')
            + (r.issues.length ? `，问题 ${r.issues.length} 条：${r.issues[0]}` : r.score != null ? '，未发现问题' : '')
            + (r.note ? `〔${r.note}〕` : '');
          if (r.score != null || r.issues.length) {
            reviewNotes.push(`【${nm}】评分 ${r.score ?? '无效'}\n${[...r.issues.map((i) => '- 问题：' + i), ...r.suggestions.map((x) => '- 建议：' + x)].join('\n')}`);
            vars.reviews = reviewNotes.join('\n\n');
          }
          entry.status = 'done';
        } else {
          if (isText) {
            if (isJunkText(extractText(text))) throw new RunFailedError(JUNK_MESSAGE, 'junk', text);
            draftRaw = extractText(text);
            draftNode = null;
            entry.summary = `产出 ${draftRaw.split('\n').length} 行`;
          } else {
            let obj: any;
            try { obj = extractJSON(text); } catch { throw new RunFailedError(JUNK_MESSAGE, 'junk', text); }
            if (isJunkTree(obj, text)) throw new RunFailedError(JUNK_MESSAGE, 'junk', text);
            if (op === 'generate' && !(Array.isArray(obj) ? obj.length : (obj.root ?? obj).children?.length ?? (obj.root ?? obj).items?.length) && !isText) {
              throw new RunFailedError('这次 AI 只返回了一个标题，没有展开任何内容，已保留原样，未做任何修改。可以重试，或换一个更强的模型。', 'empty', text);
            }
            const existing = collectIds(oldRoot);
            let cand = normalizeNode(Array.isArray(obj) ? { title: target?.title ?? artifact.title, children: obj } : (obj.root ?? obj), existing);
            let note = '';
            if (target) {
              // 范围守卫：有目标时，产出必须是目标子树；返回了整份文档则只取其中的目标部分，取不到就丢弃
              const d = scopeDrift(oldRoot, target, cand);
              if (d.drift) {
                const sub = d.salvage;
                if (sub) { cand = sub; note = '（模型返回了整份内容，已只取目标部分）'; }
                else {
                  results.__drift = (results.__drift ?? 0) + 1;
                  if (draftNode) { entry.summary = `修改越界（${d.why}），已忽略，沿用上一份草稿`; entry.status = 'done'; results[step.id] = { ok: false, drift: true }; warnings.push(`${nm}的修改超出了「${target.title}」，已忽略`); entry.endedAt = Date.now(); log.push(entry); emit(entry); return false; }
                  throw new RunFailedError(`AI 这次改动超出了「${target.title}」的范围（${d.why}），已全部丢弃，内容保持原样。可以重试，或换一个更强的模型。`, 'junk', text);
                }
                results.__drift = (results.__drift ?? 0) + 1;
              }
            }
            draftNode = cand;
            draftRaw = JSON.stringify(draftNode);
            let n = 0; walk(draftNode, () => n++);
            entry.summary = `产出 ${n} 个节点${note}`;
          }
          vars.draft = isText ? draftRaw : toPromptJSON(draftNode!);
          results[step.id] = { ok: true };
          entry.status = 'done';
        }
      }
    } catch (e: any) {
      entry.status = 'error';
      entry.summary = e instanceof RunFailedError ? '失败：模型没有按要求返回内容' : String(e?.message ?? e);
      entry.endedAt = Date.now();
      log.push(entry); emit(entry);
      if (role.output === 'artifact' && draftRaw == null) {
        if (e instanceof RunFailedError) { e.log = log; throw e; }
        if (req.signal?.aborted) throw new EngineError('已取消');
        const err = new EngineError(String(e?.message ?? e)); (err as any).log = log; throw err;
      }
      if (req.signal?.aborted) throw new EngineError('已取消');
      warnings.push(e instanceof RunFailedError ? `${entry.roleName}没有返回有效内容，已沿用上一份草稿` : `${entry.roleName}失败：${entry.summary}`);
      return false;
    }
    entry.endedAt = Date.now();
    log.push(entry); emit(entry);
    if (role.output === 'artifact' && entry.status === 'done') checkDraft();
    return entry.status === 'done';
  };

  for (const step of steps) {
    const role = roles[step.role];
    const skip = (summary: string) => {
      const e: AgentLogEntry = { id: uid('log'), stepId: step.id, role: step.role, roleName: step.name ?? role?.name ?? step.role, status: 'skipped', startedAt: Date.now(), endedAt: Date.now(), summary };
      log.push(e); emit(e);
    };
    if (req.signal?.aborted) throw new EngineError('已取消');
    if (step.enabled === false || disabled.has(step.id)) { skip('已关闭'); continue; }
    // 守卫预检发现违规时，后续的产出型步骤（修订者）即使条件不满足也要运行一次
    const forcedByGuard = role?.output === 'artifact' && draftRaw != null && results.guard?.violations > 0;
    if (!evalWhen(step.when, results) && !forcedByGuard) { skip(`条件不满足：${step.when}`); continue; }
    if (role?.output === 'review' && draftRaw == null) { skip('尚无草稿可评审'); continue; }
    const ok = await execStep(step);
    // 评审—修订循环：直到达标 / 无提升 / 到达上限
    if (ok && step.loop) {
      const L = step.loop;
      const critic = stepById.get(L.with);
      const max = Math.max(1, L.maxRounds ?? 2);
      const minGain = L.minGain ?? 0.3;
      let round = 1;
      let prev: number | undefined = results[L.with]?.score;
      let reason = '';
      if (!critic || disabled.has(critic.id) || critic.enabled === false) reason = '评审步骤不可用，不再循环';
      while (!reason) {
        if (round >= max) { reason = `到达上限 ${max} 轮`; break; }
        await execStep(critic!, round + 1);
        const sc: number | undefined = results[L.with]?.score;
        if (L.until && evalWhen(L.until, results)) { reason = `达标（${sc} 分）`; break; }
        if (sc == null) { reason = '评分无效，停止循环'; break; }
        if (prev != null && sc - prev < minGain) { reason = `无明显提升（${prev} → ${sc}）`; break; }
        prev = sc;
        round++;
        await execStep(step, round);
      }
      results[step.id] = { ...(results[step.id] ?? {}), rounds: round };
      sysEntry(`${step.id}-loop`, '循环控制', `评审—修订循环结束：${reason}，共修订 ${round} 轮`);
    }
  }

  if (draftRaw == null) { const err = new RunFailedError('这次没有产出任何内容（撰写步骤被关闭了？），已保留原样。', 'empty'); err.log = log; throw err; }

  // 修订变差时保留更好的一版：当前草稿就是最后一次被评分的那份，且更早有一份得分更高
  let keptNote: string | undefined;
  if (scored.length > 1) {
    const last = scored[scored.length - 1];
    const best = scored.reduce((b, x) => (x.score > b.score ? x : b), scored[0]);
    if (last.raw === draftRaw && best !== last && best.score > last.score && best.raw != null) {
      draftRaw = best.raw; draftNode = best.node;
      keptNote = `修订未改善（${best.score} → ${last.score}），已保留修改前得分更高的版本`;
      sysEntry('best-keep', '择优', keptNote);
      warnings.push(keptNote);
    }
  }

  // ── 合并 + 约束守卫（最终兜底修补） ──
  let newRoot: ArtNode;
  if (isText) {
    let text = draftRaw;
    if (sel) {
      const r = spliceSelection(oldRoot.content ?? '', sel, draftRaw);
      text = r.text;
      if (r.note) warnings.push(r.note);
    }
    newRoot = { ...oldRoot, content: text };
  } else {
    newRoot = mergeTree(oldRoot, draftNode as ArtNode, op, target?.id);
    const g = guard(oldRoot, newRoot, manifest, stageIndex, target?.id, guardOpts);
    newRoot = g.root;
    warnings.push(...g.warnings);
    // 数字字段：模型只写在说明里的数字抽取到属性中（标“推断”）
    newRoot = carryMarks(oldRoot, newRoot);
    const fn = fillNumbers(newRoot, manifest);
    if (fn.filled) { newRoot = fn.root; sysEntry('numbers', '数字整理', `从说明中整理出 ${fn.filled} 个数字字段`); }
    const sw = stripWhys(newRoot); newRoot = sw.root;
    if (Object.keys(sw.whys).length) results.__whys = sw.whys;
  }
  sysEntry('guard', '约束守卫', warnings.length ? warnings.join('；') : '所有约束均满足');

  const label = `${req.persona ? `〔${req.persona.name}〕` : ''}${stage.name} · ${OP_LABEL[op] ?? op}${target ? `「${target.title}」` : sel ? '「选区」' : ''}`;
  const version: Version = {
    id: uid('v'), parentId: artifact.head, stageId: stage.id, op, targetId: target?.id, instruction: req.instruction,
    label, root: newRoot, log, createdAt: Date.now(),
  };
  if (loosened) version.loosened = true;
  const sc: number[] = results.__scores ?? [];
  if (sc.length || results.__issues || results.__questions || keptNote || results.__drift || results.__whys) version.summary = {
    scoreFrom: sc[0], scoreTo: keptNote ? Math.max(...sc) : sc.length > 1 ? sc[sc.length - 1] : undefined, issues: results.__issues,
    rounds: Object.values(results).find((x: any) => x?.rounds)?.rounds,
    ...(results.__questions ? { questions: results.__questions.slice(0, 3) } : {}), ...(keptNote ? { kept: keptNote } : {}), ...(results.__drift ? { drift: results.__drift } : {}), ...(results.__whys ? { whys: results.__whys } : {}),
  };
  return { root: newRoot, log, warnings, version };
}

/**
 * 多人设交叉设计（发散阶段）：每个人设独立生成一份方案 → 由“下一位”人设交叉评分 →
 * 全部作为版本树上的兄弟分支返回（按分数从高到低），head 指向最高分。
 */
export async function runFork(req: RunRequest & { personas: { id: string; name: string; brief: string }[] }): Promise<RunResult[]> {
  const { personas } = req;
  if (!personas.length) return [await runStage(req)];
  const group = uid('fork');
  const outs: RunResult[] = [];
  for (const p of personas) {
    if (req.signal?.aborted) throw new EngineError('已取消');
    const r = await runStage({ ...req, persona: p, disabledSteps: [...(req.disabledSteps ?? []), 'planner'] });
    r.version.fork = { group, persona: p.name };
    outs.push(r);
  }
  // 交叉评分：人设 i 的方案由人设 i+1 评审（不自评）
  const roles = resolveRoles(req.manifest, req.roles);
  const critic = roles.critic;
  for (let i = 0; i < outs.length; i++) {
    const judge = personas[(i + 1) % personas.length];
    const draft = req.manifest.output === 'text' ? (outs[i].root.content ?? '') : toPromptJSON(outs[i].root);
    const vars = {
      type: { ...req.manifest, prompts: { domain: req.manifest.prompts?.domain ?? '', format: req.manifest.prompts?.format ?? '' } },
      stage: req.manifest.stages[req.stageIndex], seed: req.artifact.seed, opLabel: OP_LABEL[req.op] ?? req.op, instruction: req.instruction ?? '',
      constraints: `- 你以「${judge.name}」（${judge.brief}）的视角，评审「${personas[i].name}」提交的方案`, draft,
    };
    const entry: AgentLogEntry = { id: uid('log'), stepId: 'cross-review', role: 'critic', roleName: `交叉评审：${judge.name} → ${personas[i].name}`, status: 'running', startedAt: Date.now() };
    req.onLog?.({ ...entry });
    try {
      const text = await req.providers.text.chat({
        messages: [{ role: 'system', content: render(critic.system, vars) }, { role: 'user', content: render(critic.task, vars) }],
        temperature: Math.max(0, req.manifest.stages[req.stageIndex].freedom.temperature - 0.4),
        meta: { role: 'critic', output: 'review', op: req.op, persona: judge.id, crossOf: personas[i].id, reviews: ['cross'] },
      }, undefined, req.signal);
      const r = normalizeReview(text);
      entry.score = r.score; entry.status = 'done';
      entry.summary = r.score != null ? `评分 ${r.score}/10${r.issues[0] ? '：' + r.issues[0] : ''}` : (r.note ?? '评分无效');
      outs[i].version.fork!.score = r.score;
    } catch (e: any) {
      entry.status = 'error'; entry.summary = String(e?.message ?? e);
    }
    entry.endedAt = Date.now();
    outs[i].log.push(entry); outs[i].version.log = outs[i].log;
    req.onLog?.({ ...entry });
  }
  return outs.sort((a, b) => (b.version.fork?.score ?? -1) - (a.version.fork?.score ?? -1));
}

/**
 * 文本选区合并（严格模式的程序化保证）：
 * - 正常情况：模型只返回选区的新内容 → 直接替换选区字符；
 * - 模型返回了整份文档（小模型常见）→ 按行对齐，只取选区所在行的新内容，选区外的行一律保持原样。
 */
export function spliceSelection(old: string, sel: { from: number; to: number; text: string }, out: string): { text: string; note?: string } {
  const oldLines = old.split('\n');
  const ls0 = old.slice(0, sel.from).split('\n').length - 1;
  const le0 = old.slice(0, sel.to).split('\n').length - 1;
  const outside = new Set(oldLines.filter((l, i) => (i < ls0 || i > le0) && l.trim()).map((l) => l.trim()));
  const hits = new Set(out.split('\n').map((l) => l.trim()).filter((l) => outside.has(l))).size;
  const looksWhole = outside.size > 0 && hits >= Math.max(2, Math.ceil(outside.size * 0.5));
  if (!looksWhole) {
    // 小模型常见：复述了选区外的上下文。只保留“选区外不存在”的行作为真正的修改
    const outLines = out.split('\n');
    const nonblank = outLines.filter((l) => l.trim());
    const echoed = nonblank.filter((l) => outside.has(l.trim()));
    if (echoed.length >= 2 && echoed.length >= nonblank.length * 0.5) {
      const selSet = new Set(sel.text.split('\n').map((l) => l.trim()).filter(Boolean));
      const novel = outLines.filter((l) => l.trim() && !outside.has(l.trim()));
      const changed = novel.some((l) => !selSet.has(l.trim()));
      if (!changed) return { text: old, note: '模型未对选区做出有效修改（只复述了上下文），已保持原样' };
      const keepNl = sel.text.endsWith('\n') ? '\n' : '';
      return { text: old.slice(0, sel.from) + novel.join('\n') + keepNl + old.slice(sel.to), note: '模型复述了选区外的上下文，已只采纳新增/修改的行' };
    }
    return { text: old.slice(0, sel.from) + out + old.slice(sel.to) };
  }
  const newLines = out.replace(/\n$/, old.endsWith('\n') ? '\n' : '').split('\n');
  const ls = old.slice(0, sel.from).split('\n').length - 1;
  const le = old.slice(0, sel.to).split('\n').length - 1;
  const tail = oldLines.length - 1 - le;
  let p = 0;
  while (p < ls && p < newLines.length && newLines[p] === oldLines[p]) p++;
  let s = 0;
  while (s < tail && s < newLines.length - p && newLines[newLines.length - 1 - s] === oldLines[oldLines.length - 1 - s]) s++;
  const clean = p === ls && s === tail;
  let middle: string[];
  if (clean) middle = newLines.slice(p, newLines.length - s);
  else {
    // 以“选区后第一行”为锚点在新文本中定位选区结束位置；找不到则按原选区行数截取
    const anchor = oldLines[le + 1];
    const start = Math.min(ls, newLines.length);
    let end = anchor !== undefined && anchor.trim() ? newLines.indexOf(anchor, start) : -1;
    if (end < start) end = start + (le - ls + 1);
    middle = newLines.slice(start, end);
  }
  const text = [...oldLines.slice(0, ls), ...middle, ...oldLines.slice(le + 1)].join('\n');
  return { text, note: clean ? '模型返回了整份文档，已只采纳选区所在行的修改' : '模型改动超出选区，选区外的改动已被丢弃' };
}

/** 依据算子语义（注册表中声明的合并策略）把草稿合并回整棵树 */
export function mergeTree(oldRoot: ArtNode, draft: ArtNode, op: string, targetId?: string): ArtNode {
  if (!targetId) {
    if ((OP_REGISTRY.get(op)?.merge ?? 'replace') === 'replace-root') return { ...draft, id: oldRoot.id };
    return mergeNode(oldRoot, draft, op);
  }
  const target = findNode(oldRoot, targetId)!;
  const merged = mergeNode(target, { ...draft, id: target.id }, op);
  return replaceNode(oldRoot, targetId, merged);
}

/** 模型常丢掉 id：同一层级里同名的子项沿用原 id（保持改动高亮、锁定、手改固定都能对上） */
const normT = (t: string) => (t ?? '').replace(/\s+/g, '');
export function reattachIds(old: ArtNode, d: ArtNode): ArtNode {
  const oldKids = old.children ?? [];
  if (!d.children?.length || !oldKids.length) return d;
  const draftIds = new Set(d.children.map((k) => k.id));
  const byTitle = new Map(oldKids.filter((c) => !draftIds.has(c.id)).map((c) => [normT(c.title), c]));
  const used = new Set<string>();
  return { ...d, children: d.children.map((k) => {
    let o = oldKids.find((c) => c.id === k.id);
    if (!o) { const t = byTitle.get(normT(k.title)); if (t && !used.has(t.id)) o = t; }
    if (!o) return k;
    used.add(o.id);
    return reattachIds(o, { ...k, id: o.id });
  }) };
}

function mergeNode(old: ArtNode, draft0: ArtNode, op: string): ArtNode {
  const strategy = OP_REGISTRY.get(op)?.merge ?? 'replace';
  const draft = strategy === 'append-children' ? draft0 : reattachIds(old, draft0);
  const keepFlags = (n: ArtNode): ArtNode => { const o: ArtNode = { ...n }; if (old.pinned) o.pinned = old.pinned; return o; };
  if (strategy === 'append-children') {
    const draftKids = draft.children ?? [];
    // 模型可能丢掉 id：同名子项视为原有子项，避免把旧内容重复追加一遍
    const norm = (t: string) => t.replace(/\s+/g, '');
    const byId = new Map(draftKids.map((k) => [k.id, k]));
    const byTitle = new Map(draftKids.map((k) => [norm(k.title), k]));
    const kept = (old.children ?? []).map((c) => byId.get(c.id) ? { ...byId.get(c.id)!, id: c.id } : byTitle.has(norm(c.title)) ? (() => { const d = byTitle.get(norm(c.title))!; return { ...c, ...d, id: c.id, children: d.children ? reattachIds(c, d).children : c.children }; })() : c);
    const oldIds = new Set((old.children ?? []).map((c) => c.id));
    const oldTitles = new Set((old.children ?? []).map((c) => norm(c.title)));
    const added = draftKids.filter((k) => !oldIds.has(k.id) && !oldTitles.has(norm(k.title)));
    return keepFlags({ ...old, ...draft, id: old.id, children: [...kept, ...added] });
  }
  if (strategy === 'keep-children') {
    // 若模型省略了 children，则保留原有子节点
    return keepFlags({ ...draft, id: old.id, children: draft.children ?? old.children });
  }
  return keepFlags({ ...draft, id: old.id });
}

function getField(n: ArtNode, f: string): unknown {
  if (f === 'title') return n.title;
  if (f === 'content') return n.content ?? '';
  if (f.startsWith('props.')) return n.props?.[f.slice(6)];
  return undefined;
}
function setField(n: ArtNode, f: string, v: unknown) {
  if (f === 'title') n.title = String(v);
  else if (f === 'content') { if (v) n.content = String(v); else delete n.content; }
  else if (f.startsWith('props.')) { n.props = { ...(n.props ?? {}) }; if (v === undefined) delete n.props[f.slice(6)]; else n.props[f.slice(6)] = v; }
}

/**
 * 约束守卫（程序化智能体）：锁定节点（按原位恢复）、手动固定字段、锁定属性、新增数量、严格模式目标外还原、枚举校验。
 * 返回修补后的树与违规清单；同一函数也用于“预检”，违规清单会回流给修订者。
 */
export function guard(oldRoot: ArtNode, newRoot: ArtNode, manifest: TypeManifest, stageIndex: number, targetId?: string, opts: { op?: string; freedom?: FreedomSpec } = {}): { root: ArtNode; warnings: string[] } {
  const f = opts.freedom ?? effectiveFreedom(manifest.stages, stageIndex);
  const warnings: string[] = [];
  let root = clone(newRoot);
  const restore = (n: ArtNode, p: ArtNode | null, why: string) => {
    const parentNow = p ? findNode(root, p.id) : null;
    root = insertByOrder(root, parentNow?.id ?? root.id, clone(n), (p?.children ?? []).map((c) => c.id));
    warnings.push(why);
  };
  // 1. 锁定节点原样恢复（被删则按原兄弟顺序插回）
  walk(oldRoot, (n, p) => {
    if (!n.locked) return;
    const now = findNode(root, n.id);
    if (!now) restore(n, p, `锁定节点「${n.title}」被删除，已按原位置恢复`);
    else if (JSON.stringify(now) !== JSON.stringify(n)) {
      root = replaceNode(root, n.id, clone(n));
      warnings.push(`锁定节点「${n.title}」被修改，已还原`);
    }
  });
  // 2. 用户手动固定的字段（pinned）：显式选中目标做改写/微调时，目标自身的固定被视为用户主动放开
  const releaseOn = targetId && (opts.op === 'rewrite' || opts.op === 'patch') ? targetId : undefined;
  walk(oldRoot, (n, p) => {
    if (!n.pinned?.length) return;
    let now = findNode(root, n.id);
    if (!now) {
      if (ancestors(oldRoot, n.id).some((a) => a.locked)) return;
      restore(n, p, `手动编辑过的「${n.title}」被删除，已按原位置恢复`);
      return;
    }
    if (n.id === releaseOn) { delete now.pinned; return; }
    now = findNode(root, n.id)!;
    for (const fld of n.pinned) {
      const a = getField(n, fld), b = getField(now, fld);
      if (JSON.stringify(a ?? '') !== JSON.stringify(b ?? '')) {
        setField(now, fld, a);
        warnings.push(`「${n.title}」的 ${fld} 是手动编辑内容（已固定），已还原 AI 的修改`);
      }
    }
    now.pinned = n.pinned;
  });
  // 3. 锁定属性
  if (f.lockedProps?.length) {
    walk(oldRoot, (n) => {
      const now = findNode(root, n.id);
      if (!now) return;
      for (const k of f.lockedProps!) {
        const a = n.props?.[k];
        const b = now.props?.[k];
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          now.props = { ...(now.props ?? {}) };
          if (a === undefined) delete now.props[k]; else now.props[k] = a;
          warnings.push(`属性「${k}」已锁定，已还原「${n.title}」上的修改`);
        }
      }
    });
  }
  // 4. 新增节点数量上限
  if (f.maxNewNodes != null) {
    const oldIds = collectIds(oldRoot);
    let budget = f.maxNewNodes;
    let trimmed = 0;
    const prune = (n: ArtNode): ArtNode => ({
      ...n,
      children: n.children?.filter((c) => {
        if (oldIds.has(c.id)) return true;
        if (budget > 0) { budget--; return true; }
        trimmed++; return false;
      }).map(prune),
    });
    root = prune(root);
    if (trimmed) warnings.push(`超出本阶段新增上限 ${f.maxNewNodes}，已裁剪 ${trimmed} 个节点`);
  }
  // 5. 严格模式：目标外的任何变化一律还原（只采纳目标子树）
  if (targetId && f.strictness === 'strict') {
    const outside = (r: ArtNode) => { const c = clone(r); const t = findNode(c, targetId); if (t) { t.children = []; t.title = ''; t.content = ''; t.props = {}; delete t.pinned; } return JSON.stringify(c); };
    const t = findNode(root, targetId);
    if (t && outside(oldRoot) !== outside(root)) {
      root = replaceNode(clone(oldRoot), targetId, t);
      warnings.push('严格模式：检测到目标外内容变化，已还原');
    }
  }
  // 6. schema 枚举校验
  const props = manifest.nodeSchema?.props ?? [];
  walk(root, (n) => {
    for (const p of props) {
      const v = n.props?.[p.key];
      if (p.type === 'enum' && v != null && p.options && !p.options.includes(String(v))) {
        warnings.push(`「${n.title}」的 ${p.label}=${String(v)} 不在可选值中`);
      }
    }
  });
  return { root, warnings };
}

/**
 * 通用媒体步骤：核心只知道“能力 + 读哪个字段 + 写哪个字段”。
 * - scope=nodes：每个带提示词、且提示词变化过的节点调用一次（同步结果）；
 * - scope=root：把整棵树合成一个请求（异步任务，写 <out>Status / <out>Job / <out>Message）。
 * 未配置对应能力时如实标注，绝不伪造结果。
 */
export async function runMedia(base: ArtNode, spec: MediaSpec, p: MediaProvider | undefined, signal?: AbortSignal): Promise<string> {
  const pf = spec.promptField ?? 'prompt';
  const of = spec.outputField ?? 'url';
  const params: Record<string, unknown> = { ...(spec.params ?? {}) };
  for (const [k, prop] of Object.entries(spec.paramProps ?? {})) if (base.props?.[prop] != null) params[k] = base.props[prop];
  if ((spec.scope ?? 'nodes') === 'root') {
    if (!p) {
      base.props = { ...base.props, [of + 'Status']: 'unconfigured', [of + 'Message']: `未配置「${spec.capability}」能力的服务：已保留脚本，可在设置中配置后提交` };
      return `未配置「${spec.capability}」服务，仅保留脚本（不伪造结果）`;
    }
    const parts = (base.children ?? []).map((c, i) => `${i + 1}. ${(c.props?.[pf] as string) ?? c.title}`).join('\n');
    const prompt = `${base.title}\n${parts}`.slice(0, 1800);
    const r = await p.run({ prompt, params, meta: { title: base.title } });
    base.props = { ...base.props, [of + 'Status']: r.status, [of + 'Job']: r.jobId, [of]: r.urls?.[0], [of + 'Message']: r.message };
    return `已提交「${spec.capability}」任务 ${r.jobId ?? ''}（${r.status}）`;
  }
  if (!p) return `未配置「${spec.capability}」服务，已保留提示词`;
  const jobs: ArtNode[] = [];
  walk(base, (n) => {
    const prompt = n.props?.[pf] as string | undefined;
    if (prompt && (!n.props?.[of] || n.props?.[of + 'Prompt'] !== prompt)) jobs.push(n);
  });
  let ok = 0;
  for (const n of jobs) {
    if (signal?.aborted) break;
    try {
      const r = await p.run({ prompt: String(n.props![pf]), params, meta: { title: n.title } });
      const url = r.urls?.[0];
      if (url) { n.props = { ...n.props, [of]: url, [of + 'Prompt']: n.props![pf] }; delete n.props[of + 'Error']; ok++; }
      else n.props = { ...n.props, [of + 'Error']: r.message ?? r.status };
    } catch (e: any) {
      n.props = { ...n.props, [of + 'Error']: String(e?.message ?? e) };
    }
  }
  return jobs.length ? `「${spec.capability}」生成 ${ok}/${jobs.length} 项（${p.id}）` : '没有需要（重新）生成的媒体';
}

/** 目标的上下文摘要：祖先链（标题 + 一句说明）与同级标题——不含全文 */
export function ancestryText(root: ArtNode, target: ArtNode): string {
  const anc = ancestors(root, target.id);
  const lines = anc.map((a, i) => `${'  '.repeat(i)}- ${a.title}${a.content ? '：' + a.content.slice(0, 60) : ''}`);
  const parent = anc[anc.length - 1];
  const sibs = (parent?.children ?? []).filter((c) => c.id !== target.id).map((c) => c.title);
  return `所在位置（上级）：\n${lines.join('\n') || '（顶层）'}${sibs.length ? `\n同级的其他部分（不要改动、不要重复）：${sibs.slice(0, 12).join('、')}` : ''}`;
}

const nt = (t: string) => (t ?? '').replace(/[\s·:：、，,。.()（）「」\-—_]/g, '').toLowerCase();
/**
 * 范围漂移检测：有目标时，产出若根标题≠目标标题且（等于全文根标题，或一半以上的标题来自目标子树之外），判为越界。
 * 能从产出中找到目标节点（同 id 或同标题）时返回 salvage = 该子树。
 */
export function scopeDrift(oldRoot: ArtNode, target: ArtNode, draft: ArtNode): { drift: boolean; why?: string; salvage?: ArtNode } {
  const inside = new Set<string>(); walk(target, (n) => inside.add(nt(n.title)));
  const outside = new Set<string>(); walk(oldRoot, (n) => { if (!inside.has(nt(n.title))) outside.add(nt(n.title)); });
  // 目标子树内的节点不计入 outside
  const tIds = collectIds(target);
  const outsideT = new Set<string>(); walk(oldRoot, (n) => { if (!tIds.has(n.id)) outsideT.add(nt(n.title)); });
  inside.forEach((t) => outsideT.delete(t));
  const titles: string[] = []; walk(draft, (n) => titles.push(nt(n.title)));
  const rootT = nt(draft.title);
  const sameAsTarget = draft.id === target.id || rootT === nt(target.title);
  const hits = titles.filter((t) => t && outsideT.has(t)).length;
  const ratio = titles.length ? hits / titles.length : 0;
  const isWhole = (!sameAsTarget && rootT === nt(oldRoot.title)) || (titles.length >= 3 && ratio > 0.5) || (!sameAsTarget && hits >= 2 && ratio > 0.3);
  if (!isWhole) return { drift: false };
  let salvage: ArtNode | undefined;
  walk(draft, (n) => { if (!salvage && n !== draft && (n.id === target.id || nt(n.title) === nt(target.title))) salvage = n; });
  return { drift: true, why: rootT === nt(oldRoot.title) ? '返回了整份文档' : `${hits} 处内容来自其他部分`, salvage: salvage ? { ...salvage, id: target.id } : undefined };
}

/**
 * 多目标运行（“接着细化最粗的 3 处”、只允许局部的步骤上“改全部”）：
 * 依次对每个目标运行同一操作，每次都以上一次的结果为基础；最后合成一个版本（撤销一步到位）。
 */
/**
 * 多目标运行（v1.8 起并行）：借鉴 LangGraph 的 Send/map-reduce 与 gpt-researcher 的并发子任务——
 * map：每个目标基于同一份底稿独立运行（受 concurrency 限流，默认 3 路）；
 * reduce：全部结束后按目标原顺序把各自的子树合并回一份根（延迟汇总，不会用到半途结果），合成一个版本。
 * 某一处失败只记警告，不影响其余；重叠的目标（一个在另一个里面）只保留外层。
 */
export async function runStageMulti(req: RunRequest, targetIds: string[], onTarget?: (i: number, title: string, p?: { done: number; active: string[]; par: number }) => void, opts: { concurrency?: number } = {}): Promise<RunResult> {
  if (!targetIds.length) throw new EngineError('没有可处理的部分');
  const base = req.artifact;
  const all = [...new Set(targetIds)].map((id) => findNode(base.root, id)).filter((n): n is ArtNode => !!n && n.id !== base.root.id);
  const inside = (outer: ArtNode, id: string) => outer.id !== id && !!findNode(outer, id);
  const targets = all.filter((t) => !all.some((o) => inside(o, t.id)));
  if (!targets.length) throw new EngineError('没有可处理的部分');
  const par = Math.max(1, Math.min(opts.concurrency ?? 3, targets.length));
  const results: (RunResult | null)[] = targets.map(() => null);
  const errs: (string | null)[] = targets.map(() => null);
  const errLogs: AgentLogEntry[][] = targets.map(() => []);
  const active = new Set<string>(); let done = 0; let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      const t = targets[i];
      if (req.signal?.aborted) throw new EngineError('已取消');
      active.add(t.title); onTarget?.(i, t.title, { done, active: [...active], par });
      try {
        results[i] = await runStage({ ...req, artifact: base, targetId: t.id });
      } catch (e: any) {
        if (req.signal?.aborted || String(e?.message) === '已取消') throw e;
        if (e?.log) errLogs[i] = e.log;
        errs[i] = String(e?.message ?? e).slice(0, 80);
      } finally {
        active.delete(t.title); done++; onTarget?.(i, t.title, { done, active: [...active], par });
      }
    }
  };
  await Promise.all(Array.from({ length: par }, worker));
  // ── reduce（延迟汇总）：按原顺序把各目标子树并回底稿 ──
  let root = base.root;
  const log: AgentLogEntry[] = []; const warnings: string[] = []; const doneT: string[] = [];
  const scores: number[] = []; const issues: string[] = []; const questions: { q: string; options?: string[] }[] = []; const whys: Record<string, string> = {};
  let last: RunResult | null = null;
  targets.forEach((t, i) => {
    const r = results[i];
    if (!r) { log.push(...errLogs[i]); warnings.push(`「${t.title}」没有改动：${errs[i] ?? '未知原因'}`); return; }
    const sub = findNode(r.root, t.id);
    if (!sub) { warnings.push(`「${t.title}」没有改动：结果里找不到这一部分`); return; }
    root = replaceNode(root, t.id, sub);
    log.push(...r.log); warnings.push(...r.warnings.map((w) => `「${t.title}」${w}`));
    const s = r.version.summary;
    if (s?.scoreFrom != null) scores.push(s.scoreTo ?? s.scoreFrom);
    issues.push(...(s?.issues ?? [])); questions.push(...(s?.questions ?? []));
    Object.assign(whys, s?.whys ?? {});
    doneT.push(t.title); last = r;
  });
  if (!last || JSON.stringify(root) === JSON.stringify(base.root)) { const err = new RunFailedError(warnings[0] ?? '这次没有改动任何部分', 'empty'); err.log = log; throw err; }
  const stage = req.manifest.stages[req.stageIndex];
  const short = (x: string) => (x.length > 10 ? x.slice(0, 10) + '…' : x);
  const label = `${stage.name} · ${OP_LABEL[req.op] ?? req.op} ${doneT.length} 处：${doneT.map((x) => `「${short(x)}」`).join('')}`;
  const version: Version = { ...(last as RunResult).version, id: uid('v'), parentId: base.head, targetId: undefined, label, root, log, createdAt: Date.now() };
  version.summary = { ...(scores.length ? { scoreFrom: Math.min(...scores), scoreTo: Math.max(...scores) } : {}), issues: issues.length ? [...new Set(issues)].slice(0, 4) : undefined, ...(questions.length ? { questions: questions.slice(0, 3) } : {}), ...(Object.keys(whys).length ? { whys } : {}) };
  return { root, log, warnings, version };
}

/** 模型输出不带程序标记：同 id 的节点沿用“推断”（值未变时）与“待澄清”（标题未变时）标记 */
export function carryMarks(oldRoot: ArtNode, newRoot: ArtNode): ArtNode {
  const old = new Map<string, ArtNode>(); walk(oldRoot, (n) => old.set(n.id, n));
  const rec = (n: ArtNode): ArtNode => {
    const o = old.get(n.id);
    let out = n;
    if (o) {
      const inf = (o.inferred ?? []).filter((k) => JSON.stringify(o.props?.[k]) === JSON.stringify(n.props?.[k]) && !n.inferred?.includes(k));
      if (inf.length) out = { ...out, inferred: [...(n.inferred ?? []), ...inf] };
      if (o.kind && !n.kind && o.title === n.title) out = { ...out, kind: o.kind };
    }
    return out.children?.length ? { ...out, children: out.children.map(rec) } : out;
  };
  return rec(newRoot);
}
