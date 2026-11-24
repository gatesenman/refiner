import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, runStageConfirming, effectiveFreedom, EngineError } from '../src/core';
import type { ArtNode, Providers, TypeManifest, Artifact } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = { ...outline, id: 'bp-x', stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']) };
const ROOT = (): ArtNode => normalizeNode({ title: '计划', children: [
  { title: 'A', content: 'a' }, { title: 'B', content: 'b' }, { title: 'C', content: 'c' },
] });
const artOf = (root: ArtNode): Artifact => ({ ...commitManual(createArtifact(M, '计划'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: 1 });
const op = () => effectiveFreedom(M.stages, 1).ops[0];
const off = ['planner', 'critic', 'reviser', 'consistency'];

function prov() {
  const p: Providers = { text: { id: 't', chat: async (req) => {
    const role = String(req.meta?.role ?? '');
    if (role === 'critic' || role === 'consistency') return '{"score": 8, "issues": []}';
    const t = req.meta?.target as ArtNode | undefined;
    if (!t) return '{}';
    return JSON.stringify({ id: t.id, title: `${t.title}·细化`, content: `${t.title} 的具体说明` });
  } } };
  return p;
}

describe('v2.8 逐处确认中途取消保留已确认项', () => {
  it('先保留一处再 abort：返回 partial 版本，已保留的改动还在', async () => {
    const root = ROOT(); const a = artOf(root);
    const ctrl = new AbortController();
    let n = 0;
    const r = await runStageConfirming(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: prov(), disabledSteps: off, signal: ctrl.signal },
      root.children!.map((c) => c.id),
      async () => {
        n++;
        if (n === 1) return 'keep';
        ctrl.abort();
        return 'stop';
      },
    );
    expect(r.version.partial).toBe(true);
    expect(r.root.children![0].title).toBe('A·细化');
    expect(r.root.children![1].title).toBe('B');
    expect(r.warnings.join()).toMatch(/停止|未处理/);
  });

  it('一处都没保留就取消：抛出已取消', async () => {
    const root = ROOT(); const a = artOf(root);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runStageConfirming(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: prov(), disabledSteps: off, signal: ctrl.signal },
      root.children!.map((c) => c.id),
      async () => 'keep',
    )).rejects.toSatisfy((e: any) => e instanceof EngineError && String(e.message) === '已取消');
  });
});
