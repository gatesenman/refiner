import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, runStageMulti, effectiveFreedom, findNode, EngineError } from '../src/core';
import type { ArtNode, Providers, TypeManifest, Artifact } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = { ...outline, id: 'bp-x', stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']) };
const ROOT = (): ArtNode => normalizeNode({ title: '计划', children: [
  { title: 'A', content: 'a' }, { title: 'B', content: 'b' }, { title: 'C', content: 'c' }, { title: 'D', content: 'd' },
] });
const artOf = (root: ArtNode): Artifact => ({ ...commitManual(createArtifact(M, '计划'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: 1 });
const op = () => effectiveFreedom(M.stages, 1).ops[0];
const off = ['planner', 'critic', 'reviser', 'consistency'];

function gated(ctrl: AbortController, abortAfterTitle: string) {
  const p: Providers = { text: { id: 'g', chat: async (req) => {
    const role = String(req.meta?.role ?? '');
    if (role === 'critic' || role === 'consistency') return '{"score": 8, "issues": []}';
    if (role === 'planner') return '1. 补充';
    const t = req.meta?.target as ArtNode | undefined;
    if (!t) return '{}';
    if (t.title === abortAfterTitle) ctrl.abort();
    return JSON.stringify({ id: t.id, title: `${t.title}·细化`, content: `${t.title} 的具体说明` });
  } } };
  return p;
}

describe('v2.6 多处运行取消时保留已完成部分', () => {
  it('中途取消：已完成的部分写入结果，未处理的保持原样，标记 partial', async () => {
    const root = ROOT(); const a = artOf(root);
    const ids = root.children!.map((c) => c.id);
    const ctrl = new AbortController();
    const r = await runStageMulti(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: gated(ctrl, 'NEVER'), disabledSteps: off, signal: ctrl.signal },
      ids,
      (_i, _t, pr) => { if ((pr?.done ?? 0) >= 1) ctrl.abort(); },
      { concurrency: 1 },
    );
    expect(r.version.partial).toBe(true);
    expect(r.warnings.join()).toMatch(/已停止：已保留/);
    expect(r.version.label).toMatch(/已停止，已保留/);
    expect(r.root.children!.map((c) => c.title)[0]).toBe('A·细化');
    // B/C/D 未跑或未完成，至少 D 应保持原样；A 已改
    expect(findNode(r.root, root.children![0].id)!.title).toBe('A·细化');
    const titles = r.root.children!.map((c) => c.title);
    expect(titles.some((t) => t === 'C' || t === 'D' || t === 'B')).toBe(true);
  });

  it('取消发生在任何一处完成之前：仍抛出「已取消」，不造空版本', async () => {
    const root = ROOT(); const a = artOf(root);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runStageMulti(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: gated(ctrl, 'A'), disabledSteps: off, signal: ctrl.signal },
      root.children!.map((c) => c.id),
      undefined,
      { concurrency: 1 },
    )).rejects.toSatisfy((e: any) => e instanceof EngineError && String(e.message) === '已取消');
  });
});
