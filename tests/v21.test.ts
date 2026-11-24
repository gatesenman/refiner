import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, commitVersion, effectiveFreedom, findNode, draftItems, draftItemsBetween, KIND_LABEL, runStageConfirming, uniqueTargets, changeMap } from '../src/core';
import type { ArtNode, Providers, TypeManifest, Artifact, ConfirmDecision } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = { ...outline, id: 'bp-x', stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']) };
const ROOT = (): ArtNode => normalizeNode({ title: '计划', children: [
  { title: 'A', content: 'a' }, { title: 'B', content: 'b', children: [{ title: 'B1' }] }, { title: 'C', content: 'c' }, { title: 'D', content: 'd' },
] });
const artOf = (root: ArtNode): Artifact => ({ ...commitManual(createArtifact(M, '计划'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: 1 });
const op = () => effectiveFreedom(M.stages, 1).ops[0];

function prov() {
  const p: Providers = { text: { id: 't', chat: async (req) => {
    const role = String(req.meta?.role ?? '');
    if (role === 'critic' || role === 'consistency') return '{"score": 8, "issues": []}';
    if (role === 'planner') return '1. 补充';
    const t = req.meta?.target as ArtNode | undefined;
    if (!t) return '{}';
    return JSON.stringify({ id: t.id, title: t.title, content: `${t.title} 的具体说明，补充了细节`, children: [...(t.children ?? []), { title: `${t.title}·新项`, content: '新增子项' }] });
  } } };
  return p;
}

describe('v2.1 草稿层清单', () => {
  it('headChanges 有新增/修改时，draftItems 列出每处标题、理由、改前改后', async () => {
    const root = ROOT();
    const a0 = artOf(root);
    const { runStage } = await import('../src/core');
    const r = await runStage({ artifact: a0, manifest: M, stageIndex: 1, op: op(), targetId: root.children![0].id, providers: prov(), disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] });
    const a: Artifact = commitVersion(a0, r.version);
    const items = draftItems(a, M);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((x) => x.kind === 'mod' && x.title === 'A')).toBe(true);
    expect(items.some((x) => x.kind === 'add' && x.title.includes('新项'))).toBe(true);
    expect(items.every((x) => x.why || x.kind === 'del')).toBe(true);
    expect(items.find((x) => x.kind === 'mod')?.before).toContain('A');
    expect(KIND_LABEL.add).toBe('新');
  });
  it('首次铺开（空底稿）→ draftItems 为空，与 headChanges 一致', () => {
    const empty = normalizeNode({ title: '空' });
    const a0 = { ...createArtifact(M, '空'), root: empty, stageIndex: 0 };
    const filled = normalizeNode({ title: '空', children: [{ title: '一' }, { title: '二' }] });
    const a = commitVersion(a0, { id: 'v1', parentId: a0.head, stageId: M.stages[0].id, op: 'generate', label: '第一版', root: filled, log: [], createdAt: 1 });
    expect(draftItems(a, M)).toEqual([]);
  });
  it('删除的节点出现在清单里（kind=del）', () => {
    const base = ROOT();
    const after: ArtNode = { ...base, children: base.children!.filter((c) => c.title !== 'C') };
    const items = draftItemsBetween(base, after, M);
    expect(items.some((x) => x.kind === 'del' && x.title === 'C')).toBe(true);
  });
});

describe('v2.1 逐处确认', () => {
  it('uniqueTargets 去掉被包含的内层目标', () => {
    const root = ROOT();
    const b = root.children!.find((c) => c.title === 'B')!;
    const b1 = b.children![0];
    const ts = uniqueTargets(root, [b.id, b1.id, root.children![0].id]);
    expect(ts.map((t) => t.title).sort()).toEqual(['A', 'B']);
  });
  it('保留 A、撤回 B → 只有 A 进入结果，B 保持原文', async () => {
    const root = ROOT();
    const a = artOf(root);
    const ids = ['A', 'B'].map((t) => root.children!.find((c) => c.title === t)!.id);
    const seen: string[] = [];
    const seq: ConfirmDecision[] = ['keep', 'revert'];
    let k = 0;
    const r = await runStageConfirming(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: prov(), disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] },
      ids,
      async (info) => { seen.push(info.title); expect(info.n).toBe(2); expect(findNode(info.preview, info.targetId)?.content).toContain('具体说明'); return seq[k++]; },
    );
    expect(seen).toEqual(['A', 'B']);
    expect(r.root.children!.find((c) => c.title === 'A')?.content).toContain('具体说明');
    expect(r.root.children!.find((c) => c.title === 'B')?.content).toBe('b');
    expect(r.version.label).toContain('逐处确认');
    expect(r.version.label).toContain('1 处');
  });
  it('在第一处选停止且尚未保留 → 抛没有改动', async () => {
    const root = ROOT();
    const a = artOf(root);
    const ids = ['A', 'B'].map((t) => root.children!.find((c) => c.title === t)!.id);
    await expect(runStageConfirming(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: prov(), disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] },
      ids,
      async () => 'stop',
    )).rejects.toThrow(/没有改动/);
  });
  it('keepRest：第一处确认后其余自动跑完', async () => {
    const root = ROOT();
    const a = artOf(root);
    const ids = ['A', 'B', 'C'].map((t) => root.children!.find((c) => c.title === t)!.id);
    const asked: string[] = [];
    const r = await runStageConfirming(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: prov(), disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] },
      ids,
      async (info) => { asked.push(info.title); return 'keepRest'; },
    );
    expect(asked).toEqual(['A']);
    expect(r.root.children!.slice(0, 3).every((c) => (c.content ?? '').includes('具体说明'))).toBe(true);
    expect(r.root.children![3].content).toBe('d');
    expect(r.version.label).toContain('3 处');
  });
  it('全部撤回 → 抛没有改动', async () => {
    const root = ROOT();
    const a = artOf(root);
    const ids = [root.children![0].id];
    await expect(runStageConfirming(
      { artifact: a, manifest: M, stageIndex: 1, op: op(), providers: prov(), disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] },
      ids,
      async () => 'revert',
    )).rejects.toThrow(/没有改动/);
  });
});

void changeMap;
