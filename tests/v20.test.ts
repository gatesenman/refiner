import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, runStage, effectiveFreedom, prefFromRevert, prefFromUndoAll, addPref, prefBlock, MAX_PREFS, toJSONCanvas, toMermaid, flatten } from '../src/core';
import type { ArtNode, Providers, TypeManifest, Artifact } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = {
  ...outline, id: 'bp-plan', name: '计划',
  nodeSchema: { ...(outline.nodeSchema ?? {}), props: [{ key: 'owner', label: '负责人', type: 'string' }, { key: 'date', label: '日期', type: 'date' }] },
  stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']),
};
const ROOT = (): ArtNode => normalizeNode({ title: '发布计划 (v2)', children: [
  { title: '准备', children: [{ title: '需求冻结', props: { date: '2026-11-02' } }, { title: '设计评审', props: { date: '2026/11/9' } }] },
  { title: '上线', content: '应用商店提交，预留审核时间', children: [{ title: '提交审核', props: { date: '2026-11-20' } }] },
] });

describe('v2.0 从撤回中学习', () => {
  it('撤回修改 / 撤回新增 / 整次撤回 → 各自一句偏好（不带检查意见）', () => {
    expect(prefFromRevert({ kind: 'mod', before: { title: '目标' } }, { id: '1', title: '目标' }, '说明精简（40→10 字）；回应检查意见：太长')).toBe('「目标」不要这样改（说明精简（40→10 字））');
    expect(prefFromRevert({ kind: 'add' }, { id: '1', title: '工作分解 · 明细A' })).toContain('不需要在这里新增「工作分解 · 明细A」');
    expect(prefFromUndoAll('逐项展开 · 扩展 3 处', '更正式')).toContain('当时的要求：更正式');
  });
  it('同一句再次出现：计数 +1、重新启用、移到最前；最多保留 MAX_PREFS 条', () => {
    let l = addPref(undefined, 'A', 'revert', 'p1', 1);
    l = addPref(l, 'B', 'revert', 'p2', 2);
    l = [{ ...l[1], on: false }, l[0]];
    l = addPref(l, 'A', 'revert', 'p3', 3);
    expect(l[0]).toMatchObject({ id: 'p1', text: 'A', on: true, hits: 2 });
    for (let i = 0; i < 20; i++) l = addPref(l, `x${i}`, 'revert', `q${i}`);
    expect(l).toHaveLength(MAX_PREFS);
  });
  it('只把启用的偏好注入提示词', () => {
    const b = prefBlock([{ id: '1', text: '不要用英文缩写', on: true, from: 'user', at: 0 }, { id: '2', text: '停用的', on: false, from: 'revert', at: 0 }]);
    expect(b).toContain('【用户偏好】'); expect(b).toContain('不要用英文缩写'); expect(b).not.toContain('停用的');
    expect(prefBlock([])).toBe('');
  });
  it('引擎：作品上的偏好进入生成者的提示词', async () => {
    const root = ROOT();
    const a: Artifact = { ...commitManual(createArtifact(M, '发布'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: 1, prefs: [{ id: 'p', text: '「准备」不要拆得更细', on: true, from: 'revert', at: 0 }] };
    const seen: string[] = [];
    const p: Providers = { text: { id: 's', chat: async (req) => { seen.push(req.messages.map((x) => x.content).join('\n')); const role = String(req.meta?.role ?? ''); if (role === 'critic' || role === 'consistency') return '{"score":8}'; return JSON.stringify({ id: root.children![1].id, title: '上线', content: '提交并跟进审核' }); } } };
    await runStage({ artifact: a, manifest: M, stageIndex: 1, op: effectiveFreedom(M.stages, 1).ops[0], targetId: root.children![1].id, providers: p });
    expect(seen.some((x) => x.includes('「准备」不要拆得更细'))).toBe(true);
  });
});

describe('v2.0 诚实反馈：没改出东西就说没改', () => {
  it('多处运行结果与底稿完全相同 → 报“没有改动”，不生成空版本', async () => {
    const root = ROOT();
    const a: Artifact = { ...commitManual(createArtifact(M, '发布'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: 1 };
    const echo: Providers = { text: { id: 'e', chat: async (req) => { const role = String(req.meta?.role ?? ''); if (role === 'critic' || role === 'consistency') return '{"score":8}'; const t = req.meta?.target as ArtNode | undefined; return t ? JSON.stringify(t) : '{}'; } } };
    const { runStageMulti } = await import('../src/core');
    await expect(runStageMulti({ artifact: a, manifest: M, stageIndex: 1, op: effectiveFreedom(M.stages, 1).ops[0], providers: echo, disabledSteps: ['planner', 'critic', 'reviser', 'consistency'] }, root.children!.map((c) => c.id))).rejects.toThrow();
  });
});

describe('v2.0 外部集成：JSON Canvas 与 Mermaid', () => {
  it('JSON Canvas：每个节点一张卡、每条父子关系一条连线；子在父右侧；字段符合 1.0 规范', () => {
    const root = ROOT();
    const c = toJSONCanvas(root, M);
    expect(c.nodes).toHaveLength(flatten(root).length + 1);
    expect(c.edges).toHaveLength(flatten(root).length);
    for (const n of c.nodes) { expect(n.type).toBe('text'); for (const k of ['id', 'x', 'y', 'width', 'height']) expect(n).toHaveProperty(k); expect(Number.isInteger(n.x) && Number.isInteger(n.y)).toBe(true); }
    const pos = new Map(c.nodes.map((n) => [n.id, n]));
    for (const e of c.edges) expect(pos.get(e.toNode).x).toBeGreaterThan(pos.get(e.fromNode).x);
    expect(c.nodes.filter((n) => n.color).every((n) => ['2', '3', '4'].includes(n.color))).toBe(true);
  });
  it('Mermaid：有 ≥2 个日期 → 甘特图（一级部分为 section，日期规范为 YYYY-MM-DD，去掉会破坏语法的符号）', () => {
    const r = toMermaid(ROOT(), M);
    expect(r.kind).toBe('gantt');
    expect(r.text).toContain('dateFormat YYYY-MM-DD');
    expect(r.text).toContain('section 准备');
    expect(r.text).toContain('设计评审 :t2, 2026-11-09, 1d');
    expect(r.text).toContain('title 发布计划 v2');
  });
  it('Mermaid：没有日期 → 脑图', () => {
    const r = toMermaid(normalizeNode({ title: '想法', children: [{ title: 'A', children: [{ title: 'A1' }] }] }), M);
    expect(r.kind).toBe('mindmap');
    expect(r.text).toBe('mindmap\n  root((想法))\n    A\n      A1\n');
  });
});
