import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, runStage, effectiveFreedom, changeReason, changeReasons, stripWhys, changeMap, walk } from '../src/core';
import type { ArtNode, Providers, TypeManifest, Artifact } from '../src/core';
import { barModel } from '../src/renderer/flow';
import { COACH_TIPS } from '../src/renderer/views/V18';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = {
  ...outline, id: 'bp-budget', name: '预算表',
  nodeSchema: { ...(outline.nodeSchema ?? {}), props: [
    { key: 'amount', label: '金额(元)', type: 'number' }, { key: 'owner', label: '负责人', type: 'string' },
  ] },
  stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']),
};
const PLAN = (): ArtNode => normalizeNode({ title: '发布计划', children: [
  { title: '目标', content: '待定' }, { title: '里程碑', content: 'M1 需求冻结' }, { title: '风险', content: '审核' },
] });
const artOf = (root: ArtNode, stage = 1): Artifact => ({ ...commitManual(createArtifact(M, '发布'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: stage });

describe('v1.8 逐条改动理由', () => {
  it('程序理由：补了哪些字段、把“待定”写具体、关联提到该部分的检查意见', () => {
    const after: ArtNode = { id: 'x', title: '目标', content: '月活 5,000，30 日留存 35%', props: { owner: '王敏' } };
    const r = changeReason({ kind: 'mod', before: { title: '目标', content: '待定' } }, after, M, ['目标缺少可衡量的数字', '风险没有对策']);
    expect(r).toContain('补了负责人');
    expect(r).toContain('把“待定”写成了具体内容');
    expect(r).toContain('回应检查意见：目标缺少可衡量的数字');
    expect(r).not.toContain('风险没有对策');
  });
  it('模型给了 why 就优先用它；新增节点写明新增了什么', () => {
    expect(changeReason({ kind: 'mod', before: { title: 'a', content: 'b' } }, { id: '1', title: 'a', content: 'bb' }, M, [], '老板要求 Q4 上线')).toMatch(/^老板要求 Q4 上线/);
    expect(changeReason({ kind: 'add' }, { id: '1', title: '数据埋点', children: [{ id: '2', title: 'x' }] }, M)).toBe('新增「数据埋点」（含 1 项）');
  });
  it('每一处改动都有不同的理由（不再所有改动共用第一条检查意见）', () => {
    const before = PLAN();
    const after = JSON.parse(JSON.stringify(before)) as ArtNode;
    after.children![0].content = '月活 5,000'; after.children![2].props = { owner: '李雷' };
    const c = changeMap(before, after);
    const rs = changeReasons(after, c.map, M, ['整体偏粗']);
    expect(rs.size).toBe(2);
    expect(new Set(rs.values()).size).toBe(2);
  });
  it('why 字段从内容中摘除，记在版本摘要里', async () => {
    const n = normalizeNode({ title: 'r', children: [{ title: 'a', why: '补依据' }] });
    expect((n.children![0] as any).why).toBe('补依据');
    const s = stripWhys(n);
    let left = 0; walk(s.root, (x) => { if ((x as any).why) left++; });
    expect(left).toBe(0);
    expect(Object.values(s.whys)).toEqual(['补依据']);
  });
  it('引擎：模型返回的 why 进入 version.summary.whys，作品内容里没有 why', async () => {
    const root = PLAN(); const a = artOf(root);
    const t = root.children![0];
    const op = effectiveFreedom(M.stages, 1).ops[0];
    const p: Providers = { text: { id: 's', chat: async (req) => {
      const role = String(req.meta?.role ?? '');
      if (role === 'critic' || role === 'consistency') return '{"score": 8, "issues": []}';
      if (role === 'planner') return '1. 补充';
      return JSON.stringify({ id: t.id, title: '目标', content: '月活 5,000', why: '原来写的是待定，补上可衡量的数字' });
    } } };
    const r = await runStage({ artifact: a, manifest: M, stageIndex: 1, op, targetId: t.id, providers: p });
    expect(Object.values(r.version.summary?.whys ?? {})).toContain('原来写的是待定，补上可衡量的数字');
    let has = false; walk(r.root, (x) => { if ((x as any).why) has = true; });
    expect(has).toBe(false);
  });
});

describe('v1.8 多选', () => {
  it('选中 ≥2 处：主按钮 = 处理所选 N 处（runMulti），写明将修改哪些', () => {
    const root = PLAN(); const a = artOf(root);
    const ids = [root.children![0].id, root.children![2].id];
    const bm = barModel({ a, m: M, op: effectiveFreedom(M.stages, 1).ops[0], running: false, failed: false, selectedId: ids[1], multiIds: ids });
    expect(bm.primary.action).toBe('runMulti');
    expect(bm.primary.label).toContain('所选 2 处');
    expect(bm.target).toContain('「目标」');
    expect(bm.target).toContain('「风险」');
  });
  it('只选 1 处时仍是普通的单项修改；根节点不算入多选', () => {
    const root = PLAN(); const a = artOf(root);
    const bm = barModel({ a, m: M, op: effectiveFreedom(M.stages, 1).ops[0], running: false, failed: false, selectedId: root.children![0].id, multiIds: [root.id, root.children![0].id] });
    expect(bm.primary.action).toBe('run');
  });
});

describe('v1.8 首次引导', () => {
  it('3 条就地提示，覆盖先粗后细、点哪改哪/多选、改动理由', () => {
    expect(COACH_TIPS).toHaveLength(3);
    const all = COACH_TIPS.map((t) => t.body).join('');
    expect(all).toContain('Ctrl+单击');
    expect(all).toContain('为什么改');
  });
});
