import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, runStageMulti, effectiveFreedom, hasPendingCheckpoint, applyCheckpoint, discardCheckpoint, checkpointLabel } from '../src/core';
import type { ArtNode, Providers, TypeManifest, Artifact, RunCheckpoint } from '../src/core';

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

describe('v2.7 长任务检查点', () => {
  it('每完成一处就发出检查点，root 逐步合并', async () => {
    const root = ROOT(); const a = artOf(root);
    const cps: RunCheckpoint[] = [];
    const p: Providers = { text: { id: 't', chat: async (req) => {
      const role = String(req.meta?.role ?? '');
      if (role === 'critic' || role === 'consistency') return '{"score": 8, "issues": []}';
      const t = req.meta?.target as ArtNode | undefined;
      if (!t) return '{}';
      return JSON.stringify({ id: t.id, title: `${t.title}·细化`, content: 'x' });
    } } };
    await runStageMulti(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: p, disabledSteps: off, onCheckpoint: (c) => cps.push(c) },
      root.children!.map((c) => c.id),
      undefined,
      { concurrency: 1 },
    );
    expect(cps.length).toBe(3);
    expect(cps[0].done).toHaveLength(1);
    expect(cps[2].done).toHaveLength(3);
    expect(cps[2].root.children!.every((c) => c.title.endsWith('·细化'))).toBe(true);
  });

  it('应用检查点会提交一个 partial 版本并清掉日记；丢弃只清日记', () => {
    const root = ROOT();
    const a = artOf(root);
    const next = { ...root, children: root.children!.map((c, i) => i === 0 ? { ...c, title: 'A·细化', content: 'x' } : c) };
    const j: RunCheckpoint = { artifactId: a.id, stageIndex: 1, op: 'expand', startedAt: 1, done: [{ id: root.children![0].id, title: 'A' }], root: next };
    const pending = { ...a, runJournal: j };
    expect(hasPendingCheckpoint(pending)).toBe(true);
    expect(checkpointLabel(j)).toMatch(/已完成的/);
    const applied = applyCheckpoint(pending);
    expect(applied.runJournal).toBeUndefined();
    expect(applied.root.children![0].title).toBe('A·细化');
    expect(applied.versions[applied.versions.length - 1].partial).toBe(true);
    expect(applied.head).not.toBe(a.head);
    const dropped = discardCheckpoint(pending);
    expect(dropped.runJournal).toBeUndefined();
    expect(dropped.head).toBe(a.head);
    expect(dropped.root.children![0].title).toBe('A');
    expect(hasPendingCheckpoint({ ...a, runJournal: { ...j, root: a.root, done: [] } })).toBe(false);
  });
});
