import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, runStageMulti, effectiveFreedom, findNode } from '../src/core';
import type { ArtNode, Providers, TypeManifest, Artifact } from '../src/core';
import { grainOps, COARSEN_INSTR } from '../src/renderer/flow';

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

/** 慢速 Provider：生成/修订时把目标标题改成“X·细化”；记录同时在跑的请求数 */
function slow(failOn?: string) {
  let cur = 0; const st = { peak: 0 };
  const p: Providers = { text: { id: 'slow', chat: async (req) => {
    const role = String(req.meta?.role ?? '');
    cur++; st.peak = Math.max(st.peak, cur);
    await new Promise((r) => setTimeout(r, 30));
    cur--;
    if (role === 'critic' || role === 'consistency') return '{"score": 8, "issues": []}';
    if (role === 'planner') return '1. 补充';
    const u = req.messages[req.messages.length - 1].content;
    const m = /"id":\s*"([^"]+)",\s*"title":\s*"([A-D])"/.exec(u);
    if (!m) return '{}';
    if (failOn && m[2] === failOn) throw new Error('服务商限流');
    return JSON.stringify({ id: m[1], title: `${m[2]}·细化`, content: `${m[2]} 的具体说明，补充了细节` });
  } } };
  return { p, st };
}

describe('v1.9 并行多处细化（map-reduce）', () => {
  it('并发数 3：同时在跑的请求 > 1；结果按原顺序合并，未选的部分不动', async () => {
    const root = ROOT(); const a = artOf(root);
    const ids = ['A', 'B', 'C'].map((t) => root.children!.find((c) => c.title === t)!.id);
    const { p, st } = slow();
    const prog: number[] = [];
    const r = await runStageMulti({ artifact: a, manifest: M, stageIndex: 1, op: op(), providers: p, disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] }, ids, (_i, _t, pr) => prog.push(pr?.done ?? -1), { concurrency: 3 });
    expect(st.peak).toBeGreaterThan(1);
    expect(r.root.children!.map((c) => c.title)).toEqual(['A·细化', 'B·细化', 'C·细化', 'D']);
    expect(r.version.label).toContain('3 处');
    expect(Math.max(...prog)).toBe(3);
  });
  it('并发数 1 = 依次处理（同一时间只有 1 个请求）', async () => {
    const root = ROOT(); const a = artOf(root);
    const { p, st } = slow();
    await runStageMulti({ artifact: a, manifest: M, stageIndex: 1, op: op(), providers: p, disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] }, root.children!.slice(0, 3).map((c) => c.id), undefined, { concurrency: 1 });
    expect(st.peak).toBe(1);
  });
  it('某一处失败只记警告，其余照常合并', async () => {
    const root = ROOT(); const a = artOf(root);
    const { p } = slow('B');
    const r = await runStageMulti({ artifact: a, manifest: M, stageIndex: 1, op: op(), providers: p, disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] }, root.children!.map((c) => c.id), undefined, { concurrency: 4 });
    expect(r.root.children!.map((c) => c.title)).toEqual(['A·细化', 'B', 'C·细化', 'D·细化']);
    expect(r.warnings.join()).toContain('「B」没有改动');
  });
  it('目标重叠（B 与 B 的子项 B1 都选了）：只处理外层 B', async () => {
    const root = ROOT(); const a = artOf(root);
    const b = root.children![1]; const b1 = b.children![0];
    const { p } = slow();
    const r = await runStageMulti({ artifact: a, manifest: M, stageIndex: 1, op: op(), providers: p, disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] }, [b1.id, b.id], undefined, { concurrency: 2 });
    expect(r.version.label).toContain('1 处');
    expect(findNode(r.root, b.id)!.title).toBe('B·细化');
  });
});

describe('v1.9 粒度：更粗 / 更细', () => {
  it('只用本步允许的算子；不允许改结构时“更粗”不可用', () => {
    expect(grainOps(['expand', 'detail', 'restructure'])).toEqual({ finer: 'expand', coarser: 'restructure' });
    expect(grainOps(['expand', 'detail'])).toEqual({ finer: 'expand', coarser: 'detail' });
    expect(grainOps(['rewrite', 'patch'])).toEqual({ finer: undefined, coarser: undefined });
    expect(grainOps(['patch'])).toEqual({ finer: undefined, coarser: undefined });
    expect(COARSEN_INSTR).toContain('不要新增内容');
  });
});
