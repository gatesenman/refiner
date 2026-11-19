import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as mammoth from 'mammoth';
import {
  TypeRegistry, createArtifact, runStage, runStageMulti, commitManual, buildSchedule, effectiveFreedom, normalizeNode, findNode, walk,
  scopeDrift, normalizeReview, render, nodeMaturity, readiness, roughest, maturityMap, pickStartStage,
  parseAmount, fillNumbers, rollupAll, budgetFrom, fmtNum, unitOf, extractOpenQuestions, tableRowToNode, htmlToMarkdown, markdownToTree,
} from '../src/core';
import type { ArtNode, Providers, TypeManifest, ChatRequest, Artifact } from '../src/core';
import { barModel, keepAndAdvance, replanOpts, deriveAsks, handoff, handoffCsv, handoffIcs, readyGain } from '../src/renderer/flow';
import { extractFile, type ExtractLibs } from '../src/renderer/extract';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
/** 预算类：声明了金额 / 负责人 / 状态（与评审者造的模拟服务同构） */
const budgetM: TypeManifest = {
  ...outline, id: 'bp-budget', name: '预算表',
  nodeSchema: { ...(outline.nodeSchema ?? {}), props: [
    { key: 'amount', label: '金额(元)', type: 'number' }, { key: 'owner', label: '负责人', type: 'string' },
    { key: 'status', label: '状态', type: 'enum', options: ['待定', '已确认', '已完成'] }, { key: 'date', label: '日期', type: 'date' },
  ] },
  stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']),
};

const PLAN = (): ArtNode => normalizeNode({ title: '产品发布执行计划', content: '8 周交付 MVP', children: [
  { title: '目标与成功标准', content: '月活跃创作者 5,000，30 日留存不低于 35%', children: [{ title: '北极星指标', content: '月活跃创作者 5,000' }] },
  { title: '里程碑', children: [{ title: 'M1 需求冻结', content: 'PRD 评审通过' }, { title: 'M2 Beta', content: '邀请 50 名种子用户' }] },
  { title: '工作分解', content: '按模块拆分', children: [{ title: '账号与权限', content: '手机号登录' }, { title: '核心编辑器', content: '模板、协作' }] },
  { title: '风险与对策', children: [{ title: 'SDK 审核延期', content: '提前 3 周提交' }] },
] });
const toJSON = (n: ArtNode): any => ({ id: n.id, title: n.title, ...(n.content ? { content: n.content } : {}), ...(n.props ? { props: n.props } : {}), ...(n.children?.length ? { children: n.children.map(toJSON) } : {}) });
/** normalizeNode 只保留模型可写的字段；测试里需要的锁定 / 固定 / 种类在之后补上 */
const mark = (root: ArtNode, t: string, patch: Partial<ArtNode>) => { walk(root, (n) => { if (n.title === t) Object.assign(n, patch); }); return root; };
const artOf = (m: TypeManifest, root: ArtNode, stage = 1): Artifact => ({ ...commitManual(createArtifact(m, '产品发布'), root, '初稿', m.stages[0].id, { pin: false }), stageIndex: stage });

/** 脚本化 Provider：按角色返回；记录每次调用 */
function scripted(fn: (role: string, req: ChatRequest, n: number) => string) {
  const calls: { role: string; sys: string; user: string }[] = [];
  const p: Providers = { text: { id: 'script', chat: async (req) => { const role = String(req.meta?.role ?? ''); calls.push({ role, sys: req.messages[0].content, user: req.messages[req.messages.length - 1].content }); return fn(role, req, calls.length); } } };
  return { p, calls };
}

describe('v1.7 P0-1 范围漂移守卫', () => {
  it('修订者返回整份文档：只取其中的目标部分，目标外不受影响、根内容不会嵌进目标', async () => {
    const root = PLAN();
    const a = artOf(budgetM, root);
    const target = root.children![2];
    const op = effectiveFreedom(budgetM.stages, 1).ops.includes('expand') ? 'expand' : effectiveFreedom(budgetM.stages, 1).ops[0];
    const { p, calls } = scripted((role) => {
      if (role === 'planner') return '1. 补充';
      if (role === 'critic' || role === 'consistency') return '{"score": 6, "issues": ["工作分解缺少负责人"]}';
      if (role === 'generator') return JSON.stringify({ ...toJSON(target), children: [...toJSON(target).children, { title: '数据埋点', content: '关键漏斗 6 个事件' }] });
      // 修订者（模拟服务的真实行为）：返回整棵树，根为全文
      const whole = toJSON(root);
      whole.children[2].children.push({ title: '数据埋点', content: '关键漏斗 6 个事件，含转化' });
      return JSON.stringify(whole);
    });
    const r = await runStage({ artifact: a, manifest: budgetM, stageIndex: 1, op, targetId: target.id, providers: p });
    const t2 = findNode(r.root, target.id)!;
    expect(t2.title).toBe('工作分解');
    expect(t2.content).not.toContain('8 周交付');
    const inside: string[] = []; walk(t2, (n) => inside.push(n.title));
    expect(inside).not.toContain('目标与成功标准');
    expect(inside).not.toContain('北极星指标');
    expect(inside).toContain('数据埋点');
    expect(r.root.children!.length).toBe(4);
    expect(JSON.stringify(r.root.children![0])).toBe(JSON.stringify(root.children![0]));
    // 有目标时：修订者 / 生成者的提示只含目标子树 + 祖先摘要，不含其他部分的正文
    for (const c of calls.filter((x) => x.role === 'reviser' || x.role === 'generator')) {
      expect(c.user).not.toContain('月活跃创作者 5,000');
      expect(c.user).toContain('本次只处理以下目标部分');
    }
  });
  it('返回与目标无关的整份文档：判为越界并丢弃，沿用上一份合法草稿', async () => {
    const root = PLAN();
    const a = artOf(budgetM, root);
    const target = root.children![2];
    const op = effectiveFreedom(budgetM.stages, 1).ops[0];
    const { p } = scripted((role) => {
      if (role === 'critic' || role === 'consistency') return '{"score": 6, "issues": ["不够具体"]}';
      if (role === 'generator') return JSON.stringify({ ...toJSON(target), content: '按模块拆分，含验收标准' });
      if (role === 'reviser') { const w = toJSON(root); w.children.splice(2, 1); return JSON.stringify(w); }
      return 'ok';
    });
    const r = await runStage({ artifact: a, manifest: budgetM, stageIndex: 1, op, targetId: target.id, providers: p });
    expect(findNode(r.root, target.id)!.content).toBe('按模块拆分，含验收标准');
    expect(r.warnings.join()).toMatch(/超出了「工作分解」/);
    expect(r.version.summary?.drift).toBeGreaterThan(0);
  });
  it('scopeDrift 判据：正常的目标子树不误判', () => {
    const root = PLAN(); const t = root.children![2];
    expect(scopeDrift(root, t, { ...t, children: [...t.children!, { id: 'x', title: '新子项' }] }).drift).toBe(false);
    expect(scopeDrift(root, t, root).drift).toBe(true);
    expect(scopeDrift(root, t, root).salvage?.id).toBe(t.id);
  });
});

describe('v1.7 P1-2 修订变差时保留更好的一版', () => {
  it('8.5 → 7.5：退回修订前的草稿，并写明原因', async () => {
    const root = PLAN(); const a = artOf(budgetM, root);
    let critic = 0;
    const { p } = scripted((role) => {
      if (role === 'critic') { critic++; return JSON.stringify({ score: critic === 1 ? 7.5 : 5.5, issues: ['缺少依据'] }); }
      if (role === 'consistency') return '{"ok": true, "score": 8}';
      if (role === 'generator') return JSON.stringify({ ...toJSON(root), children: [...toJSON(root).children, { title: '好的新增', content: '生成者写的具体内容，足够长' }] });
      if (role === 'reviser') return JSON.stringify({ ...toJSON(root), children: [...toJSON(root).children, { title: '变差的修订', content: '修订者写的' }] });
      return '1. 计划';
    });
    const op = effectiveFreedom(budgetM.stages, 1).ops[0];
    const r = await runStage({ artifact: a, manifest: budgetM, stageIndex: 1, op, providers: p });
    const ts: string[] = []; walk(r.root, (n) => ts.push(n.title));
    expect(ts).toContain('好的新增');
    expect(ts).not.toContain('变差的修订');
    expect(r.version.summary?.kept).toMatch(/修订未改善（7.5 → 5.5）/);
    expect(r.version.summary?.scoreTo).toBe(7.5);
  });
});

describe('v1.7 P0-2 重新规划保留导入初稿', () => {
  it('replanOpts 沿用 seed / facts / source', () => {
    const seed = { name: 'a.docx', kind: 'content', tree: PLAN(), refs: [], useAsDraft: true };
    const o = replanOpts({ title: 'T', seed, facts: [{ id: 'f', q: '预算', a: '20 万', at: 0 }] }, 'plan');
    expect(o.seed).toBe(seed); expect(o.title).toBe('T'); expect(o.templateId).toBe('plan'); expect((o.facts as any)[0].a).toBe('20 万');
    expect(replanOpts({ title: 'T' })).toEqual({ title: 'T' });
  });
});

describe('v1.7 P0-3 第 2 步以后的主按钮不默认“跳过”', () => {
  it('要求先选中：主按钮置灰并提示；只允许局部：主按钮 = {操作}全部（逐个部分）', () => {
    const a = artOf(budgetM, PLAN(), 1);
    const strict: TypeManifest = { ...budgetM, stages: budgetM.stages.map((s, i) => (i === 1 ? { ...s, freedom: { ...s.freedom, requireTarget: true } } : s)) };
    const b1 = barModel({ a, m: strict, op: 'expand', running: false, failed: false });
    expect(b1.primary.disabled).toBe(true);
    expect(b1.primary.label).toBe('先点选要修改的部分');
    const local: TypeManifest = { ...budgetM, stages: budgetM.stages.map((s, i) => (i === 1 ? { ...s, freedom: { ...s.freedom, scope: ['subtree'] } } : s)) };
    const b2 = barModel({ a, m: local, op: 'expand', running: false, failed: false });
    expect(b2.primary.action).toBe('runAll');
    expect(b2.primary.label).toBe('往下展开全部');
    expect(b2.primary.label).not.toContain('跳过');
  });
});

describe('v1.7 P0-4 成熟度 / 就绪度 / 最粗的 3 处', () => {
  it('节点规则：无说明 / 太短 / 含“待定” = 粗；有说明缺属性 = 中；齐全 = 细，并给出原因', () => {
    const m = budgetM;
    expect(nodeMaturity({ id: 'a', title: '门窗' }, m).level).toBe('rough');
    const v = nodeMaturity({ id: 'a', title: '门窗', content: '品牌待定，需要再比较三家报价' , props: { amount: 1, owner: 'x', status: '待定', date: '2026-10-01' } }, m);
    expect(v.level).toBe('rough'); expect(v.reasons.join()).toContain('含“待定”');
    const mid = nodeMaturity({ id: 'a', title: '门窗', content: '断桥铝，客厅与卧室共 6 樘，含安装', props: { amount: 12000, status: '已确认' } }, m);
    expect(mid.level).toBe('medium'); expect(mid.reasons.join()).toMatch(/缺：负责人、日期/);
    expect(nodeMaturity({ id: 'a', title: '门窗', content: '断桥铝，客厅与卧室共 6 樘，含安装', props: { amount: 12000, owner: '王敏', status: '已确认', date: '2026-11-01' } }, m).level).toBe('detailed');
  });
  it('就绪度与“接着细化最粗的 3 处”：互不包含、跳过锁定、粗的优先', () => {
    const root = normalizeNode({ title: 'R', children: [
      { title: 'A', children: [{ title: 'A1' }, { title: 'A2', content: '待定' }] },
      { title: 'B', children: [{ title: 'B1', content: '具体的说明文字已经写清楚了', props: { amount: 1, owner: 'a', status: '已确认', date: '2026-01-01' } }] },
      { title: 'C' },
      { title: 'D', content: '还很短' },
      { title: 'E', children: [{ title: 'E1', content: '说明已经足够具体可以执行了', props: { amount: 2 } }] },
    ] });
    mark(root, 'C', { locked: true });
    const r = readiness(root, budgetM);
    expect(r.items).toBe(6);
    expect(r.percent).toBeGreaterThan(0); expect(r.percent).toBeLessThan(50);
    const pick = roughest(root, budgetM, 3);
    const ids = pick.map((x) => x.title);
    expect(ids).toEqual(expect.arrayContaining(['A', 'D']));
    expect(ids).not.toContain('C');
    expect(ids).not.toContain('B');
    expect(ids.filter((x) => x.startsWith('A')).length).toBe(1);
    expect(maturityMap(root, budgetM).get(root.children![1].id)!.level).toBe('detailed');
  });
  it('每步价值小结：就绪度 a% → b%', () => {
    const before = normalizeNode({ title: 'R', children: [{ title: 'A' }] });
    let a = artOf(budgetM, before);
    const after = { ...a.root, children: [{ ...a.root.children![0], content: '这一项已经写得很具体了，有负责人', props: { amount: 1, owner: 'x', status: '已确认', date: '2026-01-01' } }] };
    a = commitManual(a, after, '改', budgetM.stages[1].id, { pin: false });
    expect(readyGain(a, budgetM, a.versions.find((v) => v.id === a.head)!.parentId)).toBe('就绪度 0% → 100%');
  });
});

describe('v1.7 多目标运行（接着细化最粗的 3 处 / 只允许局部时的“全部”）', () => {
  it('依次处理每个目标，合成一个版本，目标外不变', async () => {
    const root = PLAN(); const a = artOf(budgetM, root);
    const ts = [root.children![1], root.children![2], root.children![3]];
    const { p } = scripted((role, req) => {
      if (role === 'critic' || role === 'consistency') return '{"score": 9}';
      if (role === 'generator' || role === 'reviser') { const t = req.meta!.target as ArtNode; return JSON.stringify({ ...toJSON(t), children: [...(toJSON(t).children ?? []), { title: `${t.title}·补充`, content: '补充的具体内容' }] }); }
      return '计划';
    });
    const op = effectiveFreedom(budgetM.stages, 1).ops[0];
    const seen: string[] = [];
    const r = await runStageMulti({ artifact: a, manifest: budgetM, stageIndex: 1, op, providers: p }, ts.map((x) => x.id), (_i, t) => seen.push(t));
    expect([...new Set(seen)]).toEqual(['里程碑', '工作分解', '风险与对策']);
    for (const t of ts) expect(findNode(r.root, t.id)!.children!.some((c) => c.title === `${t.title}·补充`)).toBe(true);
    expect(JSON.stringify(r.root.children![0])).toBe(JSON.stringify(root.children![0]));
    expect(r.version.label).toMatch(/3 处/);
    expect(r.version.parentId).toBe(a.head);
  });
});

describe('v1.7 P0-7 数字字段与汇总', () => {
  const amt = budgetM.nodeSchema!.props![0];
  it('从说明中抽取：等号后的结果、另计求和、万元、按单位过滤', () => {
    expect(unitOf(amt)).toBe('元');
    expect(parseAmount('约 4,500 元；承重墙不动', '元')).toBe(4500);
    expect(parseAmount('单价 120 元/㎡ × 45㎡ = 5,400 元', '元')).toBe(5400);
    expect(parseAmount('人工约 7,500 元，主材另计约 18,000 元', '元')).toBe(25500);
    expect(parseAmount('总预算约 21 万元', '元')).toBe(210000);
    expect(parseAmount('3 人研发、8 周', '元')).toBeUndefined();
    expect(parseAmount('人工 5 人天', '天')).toBe(5);
    expect(fmtNum(210000, '元')).toBe('21 万元'); expect(fmtNum(4500, '元')).toBe('4,500 元'); expect(fmtNum(12500, '元')).toBe('1.3 万元');
  });
  it('fillNumbers 填空字段并标“推断”，不覆盖已有值与手动固定；字符串数字转数字', () => {
    const root = normalizeNode({ title: 'R', children: [
      { title: '水电', content: '约 9,800 元' }, { title: '门窗', content: '约 12,000 元', props: { amount: 11000 } },
      { title: '手改', content: '约 100 元' }, { title: '字符串', props: { amount: '4,200' } },
    ] });
    mark(root, '手改', { pinned: ['props.amount'] });
    const r = fillNumbers(root, budgetM).root;
    expect(r.children![0].props!.amount).toBe(9800); expect(r.children![0].inferred).toEqual(['amount']);
    expect(r.children![1].props!.amount).toBe(11000);
    expect(r.children![2].props?.amount).toBeUndefined();
    expect(r.children![3].props!.amount).toBe(4200);
  });
  it('合计 / 小计 / 超预算：父节点自身值视为预算；总预算可来自固定事实', () => {
    const root = normalizeNode({ title: '装修', props: { amount: 20000 }, children: [
      { title: '水电', props: { amount: 5000 }, children: [{ title: '强电', props: { amount: 4000 } }, { title: '弱电', props: { amount: 2000 } }] },
      { title: '木作', children: [{ title: '吊顶', props: { amount: 6400 } }] },
      { title: '软装' },
    ] });
    const map = rollupAll(root, 'amount');
    expect(map.get(root.children![0].id)).toMatchObject({ sum: 6000, own: 5000, over: 1000 });
    expect(map.get(root.id)!.sum).toBe(12400);
    expect(map.get(root.id)!.over).toBeUndefined();
    expect(map.get(root.children![2].id)!.count).toBe(0);
    expect(budgetFrom({ id: 'r', title: 'r' }, 'amount', '元', [{ q: '总预算范围？', a: '10–20 万' }])).toBe(200000);
  });
  it('运行后引擎自动整理数字字段（模型只写在说明里时）', async () => {
    const a = artOf(budgetM, normalizeNode({ title: '装修', children: [{ title: '拆改' }] }), 0);
    const { p } = scripted((role) => role === 'generator' || role === 'reviser' ? JSON.stringify({ title: '装修', children: [{ title: '拆改', children: [{ title: '墙体拆改', content: '约 4,500 元；需物业报备' }] }] }) : '{"score": 9}');
    const r = await runStage({ artifact: a, manifest: budgetM, stageIndex: 0, op: 'generate', providers: p });
    const n = r.root.children![0].children![0];
    expect(n.props!.amount).toBe(4500); expect(n.inferred).toContain('amount');
  });
});

describe('v1.7 P0-5 导入理解：Word 表格 → 条目，“待定/TODO/？”→ 待澄清问题，不再报 100% 具体', () => {
  const docx = join(__dirname, 'fixtures', '产品计划-草稿.docx');
  it('HTML 表格转 Markdown 表格，再成为条目；列名映射到属性', () => {
    const md = htmlToMarkdown('<p>标题</p><h2>清单</h2><table><tr><td><p>事项</p></td><td><p>负责人</p></td><td><p>金额</p></td></tr><tr><td>门窗</td><td>王敏</td><td>12,000</td></tr></table>');
    expect(md).toContain('| 事项 | 负责人 | 金额 |');
    const t = markdownToTree(md, 'x', budgetM.nodeSchema);
    const item = t.children![0].children![0];
    expect(item.title).toBe('门窗'); expect(item.props).toMatchObject({ owner: '王敏', amount: 12000 });
    expect(tableRowToNode(['事项', '负责人', '时间'], ['模板市场', '?', '10/20']).content).toBe('负责人：?；时间：10/20');
  });
  it.skipIf(!existsSync(docx))('评审者的乱草稿：识别表格、抽出待澄清问题、就绪度如实偏低', async () => {
    const libs = { mammoth: mammoth as any } as ExtractLibs;
    const r = await extractFile('产品计划-草稿.docx', new Uint8Array(readFileSync(docx)), libs);
    const { tree, questions } = extractOpenQuestions(r.tree!);
    expect(tree.title).toBe('产品计划（草稿v3 最终版？？）');
    const table = tree.children!.find((c) => c.title === '事项清单')!;
    expect(table.children!.map((c) => c.title)).toEqual(['模板市场', '协作']);
    expect(questions.length).toBeGreaterThanOrEqual(5);
    const qs = questions.map((q) => q.title).join('|');
    expect(qs).toContain('跟李想确认预算');
    expect(qs).toContain('「模板市场」的负责人还没定');
    expect(questions.every((q) => q.kind === 'open-question')).toBe(true);
    const rd = readiness(tree, budgetM);
    expect(rd.percent).toBeLessThan(40);
    expect(rd.open).toBe(questions.length);
    const pick = pickStartStage(tree, budgetM);
    expect(pick.reason).not.toContain('100%');
    expect(pick.reason).toMatch(/就绪 \d+%/);
  });
});

describe('v1.7 P1-1 步骤间追问 / P1-3 固定事实', () => {
  it('评审给了 questions 就用；否则从“缺少/未明确/依据”类问题里挑；已回答过的不再问', () => {
    expect(normalizeReview('{"score":6,"issues":[],"questions":[{"q":"总预算？","options":["10 万","20 万"]}]}').questions).toEqual([{ q: '总预算？', options: ['10 万', '20 万'] }]);
    expect(deriveAsks({ questions: [{ q: '总预算？' }] })).toEqual([{ q: '总预算？' }]);
    const asks = deriveAsks({ issues: ['部分金额缺少依据（单价×数量）', '结构不够清晰', '付款节点未明确'] });
    expect(asks.map((x) => x.q)).toEqual(['部分金额缺少依据（单价×数量）——能补充一下吗？', '付款节点未明确——能补充一下吗？']);
    expect(deriveAsks({ questions: [{ q: '总预算？' }] }, [{ id: 'f', q: '总预算？', a: '', at: 0 }])).toEqual([]);
  });
  it('固定事实注入每一步的系统消息；未回答（先不管）的不注入', async () => {
    const a = { ...artOf(budgetM, PLAN(), 1), facts: [{ id: 'f1', q: '总预算范围？', a: '10–20 万', at: 0 }, { id: 'f2', q: '城市？', a: '', at: 0 }] };
    const { p, calls } = scripted((role) => (role === 'critic' || role === 'consistency' ? '{"score":9}' : role === 'planner' ? '计划' : JSON.stringify(toJSON(PLAN()))));
    await runStage({ artifact: a, manifest: budgetM, stageIndex: 1, op: effectiveFreedom(budgetM.stages, 1).ops[0], providers: p });
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) { expect(c.sys).toContain('【固定事实】'); expect(c.sys).toContain('总预算范围：10–20 万'); expect(c.sys).not.toContain('城市'); }
  });
  it('模板支持 {{#unless}}', () => {
    expect(render('{{#unless x}}无{{/unless}}{{#if x}}有{{/if}}', { x: '' })).toBe('无');
    expect(render('{{#unless x}}无{{/unless}}{{#if x}}有{{/if}}', { x: 'y' })).toBe('有');
  });
});

describe('v1.7 P1-7 交接清单', () => {
  it('待定项、缺负责人 / 日期、下一步行动；导出 CSV 与 ICS', () => {
    const root = normalizeNode({ title: '计划', children: [
      { title: '设计', children: [{ title: '视觉稿', content: '外包两周', props: { owner: '陈晨', date: '2026-11-03', status: '已确认' } }, { title: '插画', content: '数量待定', props: { status: '待定' } }] },
      { title: '上线', children: [{ title: '提交审核', content: '提前 3 周', props: { owner: '王敏', date: '11/20', status: '已完成' } }] },
      { title: '待澄清的问题', children: [{ title: '预算多少？' }] },
    ] });
    mark(root, '预算多少？', { kind: 'open-question' });
    const a = { ...artOf(budgetM, root), title: '计划' };
    const h = handoff(a, budgetM);
    expect(h.open.map((x) => x.title)).toEqual(expect.arrayContaining(['插画', '预算多少？']));
    expect(h.missing.find((x) => x.label === '负责人')!.items.map((i) => i.title)).toEqual(['插画']);
    expect(h.actions.map((x) => x.title)).toEqual(['视觉稿', '插画']);
    const csv = handoffCsv(a, budgetM);
    expect(csv).toContain('"视觉稿","设计","陈晨","2026-11-03"');
    expect(csv).toContain('"预算多少？","待澄清的问题"');
    const ics = handoffIcs(a, budgetM, new Date('2026-10-14T00:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261103');
    expect(ics.match(/BEGIN:VEVENT/g)!.length).toBe(1);
  });
});

describe('v1.7 回归：keepAndAdvance 后第 2 步主按钮', () => {
  it('第 2 步未选中时主按钮是“{操作}全部”', () => {
    const a = artOf(budgetM, PLAN(), 0);
    const r = keepAndAdvance({ ...a, versions: a.versions.map((v) => (v.id === a.head ? { ...v, op: 'generate' as const } : v)) }, budgetM);
    const b = barModel({ a: r.artifact, m: budgetM, op: effectiveFreedom(budgetM.stages, 1).ops[0], running: false, failed: false });
    expect(b.primary.label).toMatch(/全部$/);
    expect(['run', 'runAll']).toContain(b.primary.action);
  });
});
