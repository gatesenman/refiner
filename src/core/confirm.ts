/**
 * v2.1 多目标逐处确认：每改完一处先问再继续（默认关闭并行合并）。
 * 保留的部分累加到同一份底稿，最后合成一个版本；撤回的部分不进入结果。
 */
import { findNode, replaceNode, uid } from './tree';
import { EngineError, RunFailedError, runStage, runStageMulti } from './engine';
import { OP_LABEL } from './freedom';
import type { ArtNode, Artifact, RunRequest, RunResult, Version } from './types';

export type ConfirmDecision = 'keep' | 'revert' | 'stop' | 'keepRest';

export interface ConfirmAsk {
  i: number;
  n: number;
  title: string;
  targetId: string;
  preview: ArtNode;
  base: ArtNode;
  result: RunResult;
}

/** 去掉被包含的目标，只留外层（与 runStageMulti 相同） */
export function uniqueTargets(root: ArtNode, targetIds: string[]) {
  const all = [...new Set(targetIds)].map((id) => findNode(root, id)).filter((n): n is ArtNode => !!n && n.id !== root.id);
  const inside = (outer: ArtNode, id: string) => outer.id !== id && !!findNode(outer, id);
  return all.filter((t) => !all.some((o) => inside(o, t.id)));
}

export async function runStageConfirming(
  req: RunRequest,
  targetIds: string[],
  ask: (info: ConfirmAsk) => Promise<ConfirmDecision>,
  onTarget?: (i: number, title: string, p?: { done: number; active: string[]; par: number }) => void,
  opts: { concurrencyRest?: number } = {},
): Promise<RunResult> {
  if (!targetIds.length) throw new EngineError('没有可处理的部分');
  const baseArt = req.artifact;
  const targets = uniqueTargets(baseArt.root, targetIds);
  if (!targets.length) throw new EngineError('没有可处理的部分');
  let root = baseArt.root;
  const log: RunResult['log'] = [];
  const warnings: string[] = [];
  const kept: string[] = [];
  const scores: number[] = [];
  const issues: string[] = [];
  const questions: { q: string; options?: string[] }[] = [];
  const whys: Record<string, string> = {};
  let last: RunResult | null = null;
  const n = targets.length;

  const apply = (r: RunResult, title: string) => {
    log.push(...r.log);
    warnings.push(...r.warnings.map((w) => `「${title}」${w}`));
    const s = r.version.summary;
    if (s?.scoreFrom != null) scores.push(s.scoreTo ?? s.scoreFrom);
    issues.push(...(s?.issues ?? []));
    questions.push(...(s?.questions ?? []));
    Object.assign(whys, s?.whys ?? {});
    last = r;
  };

  for (let i = 0; i < targets.length; i++) {
    if (req.signal?.aborted) throw new EngineError('已取消');
    const t = targets[i];
    onTarget?.(i, t.title, { done: i, active: [t.title], par: 1 });
    const live: Artifact = { ...baseArt, root };
    const result = await runStage({ ...req, artifact: live, targetId: t.id });
    const sub = findNode(result.root, t.id);
    const preview = sub ? replaceNode(root, t.id, sub) : root;
    const decision = await ask({ i, n, title: t.title, targetId: t.id, preview, base: root, result });
    if (decision === 'keep' || decision === 'keepRest') {
      root = preview;
      kept.push(t.title);
      apply(result, t.title);
      onTarget?.(i, t.title, { done: i + 1, active: [], par: 1 });
      if (decision === 'keepRest') {
        const rest = targets.slice(i + 1).map((x) => x.id);
        if (rest.length) {
          try {
            const r2 = await runStageMulti({ ...req, artifact: { ...baseArt, root } }, rest, onTarget, { concurrency: opts.concurrencyRest ?? 3 });
            root = r2.root;
            apply(r2, rest.map((id) => findNode(root, id)?.title ?? id).join('、'));
            kept.push(...targets.slice(i + 1).map((x) => x.title));
          } catch (e: any) {
            if (e instanceof RunFailedError && e.kind === 'empty') warnings.push('其余部分没有改动');
            else throw e;
          }
        }
        break;
      }
    } else if (decision === 'revert') {
      warnings.push(`用户撤回了「${t.title}」的改动`);
      onTarget?.(i, t.title, { done: i + 1, active: [], par: 1 });
    } else {
      const restN = targets.slice(i + 1).map((x) => x.title);
      if (restN.length) warnings.push(`在「${t.title}」处停止，未处理：${restN.join('、')}`);
      break;
    }
  }

  if (!kept.length || JSON.stringify(root) === JSON.stringify(baseArt.root)) {
    const err = new RunFailedError((warnings.length ? warnings.join('；') + '。' : '') + '这次没有改动任何部分（已逐处撤回或停止）', 'empty');
    err.log = log;
    throw err;
  }

  const short = (x: string) => (x.length > 10 ? x.slice(0, 10) + '…' : x);
  const stage = req.manifest.stages[req.stageIndex];
  const label = `逐处确认 · ${stage.name} · ${OP_LABEL[req.op] ?? req.op} ${kept.length} 处：${kept.map((x) => `「${short(x)}」`).join('')}`;
  const version: Version = {
    ...(last as unknown as RunResult).version,
    id: uid('v'), parentId: baseArt.head, targetId: undefined, label, root, log, createdAt: Date.now(),
    instruction: req.instruction,
    summary: {
      ...(scores.length ? { scoreFrom: Math.min(...scores), scoreTo: Math.max(...scores) } : {}),
      issues: issues.length ? [...new Set(issues)].slice(0, 4) : undefined,
      ...(questions.length ? { questions: questions.slice(0, 3) } : {}),
      ...(Object.keys(whys).length ? { whys } : {}),
    },
  };
  return { root, log, warnings, version };
}
