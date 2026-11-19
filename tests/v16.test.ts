import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  TypeRegistry, createArtifact, runStage, commitVersion, createMockText, createMockMedia, buildSchedule,
  moveNode, indentNode, outdentNode, insertSiblingAfter, reorderSibling, dropPosFor, findParent,
  estimateTokens, priceFor, costOf, checkBudget, addUsage, DEFAULT_PRICES, estimateRun,
  markdownToTree, opmlToTree, dataToTree, rowsToTree, xmindJsonToTree, pickStartStage, refContext, treeDepth,
  alignParts, wordDiff, propsText, normalizeNode,
} from '../src/core';
import type { ArtNode, Providers, TypeManifest, ChatRequest } from '../src/core';
import { keepAndAdvance, partialTree, runEstimate, budgetBlock } from '../src/renderer/flow';
import { extractFile, type ExtractLibs } from '../src/renderer/extract';
import { toMarkdown, toOPML } from '../src/renderer/exporters';
import { sealSettings, openSettings, ENC_PREFIX, type Cipher } from '../src/main/secrets';
import { createBackup, listBackups, restoreBackup, dailyBackupIfDue } from '../src/main/backup';
import { makePdf, makeXlsx, makeXmind, makeDocx } from './fixtures/make';
import { dump as yamlDump } from 'js-yaml';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const m4: TypeManifest = { ...outline, stages: buildSchedule(['整体构想', '日程骨架', '细节安排', '执行清单']) };
const demo: Providers = { text: createMockText(0), media: createMockMedia() };
(pdfjs as any).GlobalWorkerOptions.workerSrc = join(__dirname, '..', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const libs: ExtractLibs = { mammoth: mammoth as any, pdf: pdfjs as any, XLSX: XLSX as any, JSZip: JSZip as any };

const T = (): ArtNode => normalizeNode({ title: '根', children: [
  { title: 'A', children: [{ title: 'A1' }, { title: 'A2' }] },
  { title: 'B', children: [{ title: 'B1' }] },
  { title: 'C' },
] });
const titles = (n: ArtNode): any => (n.children?.length ? { [n.title]: n.children.map(titles) } : n.title);
const byT = (r: ArtNode, t: string) => { let x: ArtNode | null = null; const v = (n: ArtNode) => { if (n.title === t) x = n; n.children?.forEach(v); }; v(r); return x! as ArtNode; };

describe('v1.6 结构编辑：拖拽 / 缩进 / 新建同级', () => {
  it('同级排序、移到别的部分下（成为子项）、放到别的节点前后', () => {
    const r = T();
    const a2 = byT(r, 'A2'), c = byT(r, 'C'), b = byT(r, 'B'), a = byT(r, 'A');
    expect(titles(moveNode(r, c.id, a.id, 'before')!)).toEqual({ 根: ['C', { A: ['A1', 'A2'] }, { B: ['B1'] }] });
    expect(titles(moveNode(r, a2.id, b.id, 'inside')!)).toEqual({ 根: [{ A: ['A1'] }, { B: ['B1', 'A2'] }, 'C'] });
    expect(titles(moveNode(r, a2.id, c.id, 'after')!)).toEqual({ 根: [{ A: ['A1'] }, { B: ['B1'] }, 'C', 'A2'] });
    expect(titles(r)).toEqual({ 根: [{ A: ['A1', 'A2'] }, { B: ['B1'] }, 'C'] }); // 纯函数，不改原树
  });
  it('不能拖进自己的子孙、不能移动根', () => {
    const r = T();
    expect(moveNode(r, byT(r, 'A').id, byT(r, 'A1').id, 'inside')).toBeNull();
    expect(moveNode(r, r.id, byT(r, 'A').id, 'inside')).toBeNull();
    expect(moveNode(r, byT(r, 'A').id, byT(r, 'A').id, 'after')).toBeNull();
  });
  it('Tab 缩进到上一个同级下、Shift+Tab 提升到父级之后；第一个子项不能缩进', () => {
    const r = T();
    const ind = indentNode(r, byT(r, 'B').id)!;
    expect(titles(ind)).toEqual({ 根: [{ A: ['A1', 'A2', { B: ['B1'] }] }, 'C'] });
    expect(indentNode(r, byT(r, 'A').id)).toBeNull();
    const out = outdentNode(r, byT(r, 'A2').id)!;
    expect(titles(out)).toEqual({ 根: [{ A: ['A1'] }, 'A2', { B: ['B1'] }, 'C'] });
    expect(outdentNode(r, byT(r, 'A').id)).toBeNull();
  });
  it('Enter 新建同级（在当前之后）、表格行排序、落点判定', () => {
    const r = T();
    const x = insertSiblingAfter(r, byT(r, 'A1').id, '新')!;
    expect(findParent(x.root, x.id)!.title).toBe('A');
    expect(findParent(x.root, x.id)!.children!.map((c) => c.title)).toEqual(['A1', '新', 'A2']);
    expect(titles(reorderSibling(r, byT(r, 'C').id, 0)!)).toEqual({ 根: ['C', { A: ['A1', 'A2'] }, { B: ['B1'] }] });
    expect([dropPosFor(0.1), dropPosFor(0.5), dropPosFor(0.9), dropPosFor(0.4, false)]).toEqual(['before', 'inside', 'after', 'before']);
  });
});

describe('v1.6 下一步不自动运行', () => {
  it('默认停在准备态；打开设置后才自动运行', async () => {
    const a0 = createArtifact(m4, '策划一场三天的团队建设');
    const a = commitVersion(a0, (await runStage({ artifact: a0, manifest: m4, stageIndex: 0, op: 'generate', providers: demo })).version);
    expect(keepAndAdvance(a, m4).autoRun).toBe(false);
    expect(keepAndAdvance(a, m4, Date.now(), false).autoRun).toBe(false);
    expect(keepAndAdvance(a, m4, Date.now(), true).autoRun).toBe(true);
    expect(keepAndAdvance(a, m4).artifact.stageIndex).toBe(1);
  });
});

describe('v1.6 费用', () => {
  it('估算 tokens：中文按字、英文约 4 字符', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
  it('价目：精确 / 前缀匹配 / 未知为 null；按百万 tokens 计价', () => {
    expect(priceFor('deepseek-chat')).toEqual(DEFAULT_PRICES['deepseek-chat']);
    expect(priceFor('qwen-plus-latest')).toEqual(DEFAULT_PRICES['qwen-plus']);
    expect(priceFor('my-local-model')).toBeNull();
    expect(costOf({ input: 1_000_000, output: 500_000 }, 'deepseek-chat')).toBeCloseTo(2 + 4);
    expect(costOf({ input: 1000, output: 1000 }, 'x', { x: { input: 10, output: 20 } })).toBeCloseTo(0.03);
    expect(costOf({ input: 1, output: 1 }, 'unknown')).toBeNull();
  });
  it('累计与预算：单次 / 作品上限，未设价不拦截', () => {
    let t = addUsage(undefined, { input: 100, output: 50 }, 0.01);
    t = addUsage(t, { input: 10, output: 5 }, null);
    expect(t).toEqual({ input: 110, output: 55, cost: 0.01, runs: 2 });
    expect(checkBudget({ perRun: 0.05 }, 0.1, 0)).toMatch(/超过单次预算/);
    expect(checkBudget({ perWork: 1 }, 0.3, 0.8)).toMatch(/超过作品预算/);
    expect(checkBudget({ perRun: 0.05 }, 0.01, 0)).toBeNull();
    expect(checkBudget({ perRun: 0.05 }, null, 0)).toBeNull();
    expect(checkBudget(undefined, 100, 100)).toBeNull();
  });
  it('运行前预估随内容和参考资料增长；超出预算时给出拦截说明', async () => {
    const a0 = createArtifact(m4, '策划一场三天的团队建设');
    const a = commitVersion(a0, (await runStage({ artifact: a0, manifest: m4, stageIndex: 0, op: 'generate', providers: demo })).version);
    const e1 = runEstimate(a, m4, 1, { model: 'deepseek-chat', demo: false });
    const e2 = runEstimate({ ...a, refs: [{ id: 'r', name: 'x', kind: 'text', text: '字'.repeat(5000), addedAt: 0 }] }, m4, 1, { model: 'deepseek-chat', demo: false });
    expect(e2.usage.input).toBeGreaterThan(e1.usage.input);
    expect(e1.cost).toBeGreaterThan(0);
    expect(runEstimate(a, m4, 1, { model: 'deepseek-chat', demo: true }).cost).toBe(0);
    expect(budgetBlock(a, e1, { perRun: 0.000001 })).toMatch(/预计本次费用/);
    expect(budgetBlock({ ...a, usage: { input: 0, output: 0, cost: 5, runs: 3 } }, e1, { perWork: 5 })).toMatch(/已花费 ¥5.00/);
    expect(estimateRun({ calls: 2, contextChars: 'abcd' }).input).toBeGreaterThan(0);
  });
});

describe('v1.6 导入：文本 / 结构（与导出往返）', () => {
  it('Markdown 标题 + 列表 → 树；兼容本应用 Markdown 导出（属性行往返）', () => {
    const t = markdownToTree('# 年会方案\n\n## 第一天\n- 签到\n- 开幕\n  - 致辞\n## 第二天\n- 团建', 'x');
    expect(t.title).toBe('年会方案');
    expect(titles(t)).toEqual({ 年会方案: [{ 第一天: ['签到', { 开幕: ['致辞'] }] }, { 第二天: ['团建'] }] });
    const tm = reg.list().map((e) => e.manifest).find((m) => (m.nodeSchema?.props ?? []).some((p) => p.type === 'enum'))!;
    const p0 = tm.nodeSchema!.props!.find((p) => p.type === 'enum')!;
    const root = normalizeNode({ title: '计划', children: [{ title: '部分一', content: '说明一', props: { [p0.key]: p0.options![0] }, children: [{ title: '子项', content: '细节' }] }] });
    const back = markdownToTree(toMarkdown(root, tm), 'x', tm.nodeSchema);
    expect(back.title).toBe('计划');
    expect(back.children![0].title).toBe('部分一');
    expect(back.children![0].content).toBe('说明一');
    expect(back.children![0].props?.[p0.key]).toBe(p0.options![0]);
    expect(back.children![0].children![0].title).toBe('子项');
  });
  it('OPML / JSON / YAML 与导出往返', () => {
    const r = T();
    r.children![0].content = '备注 <&> "引号"';
    expect(titles(opmlToTree(toOPML(r)))).toEqual(titles(r));
    expect(opmlToTree(toOPML(r)).children![0].content).toBe('备注 <&> "引号"');
    const json = JSON.stringify({ type: 'outline', seed: 's', root: r });
    expect(titles(dataToTree(json))).toEqual(titles(r));
    expect(titles(dataToTree(yamlDump(r)))).toEqual(titles(r));
    // 任意 YAML 配置也能成为结构
    const y = dataToTree('server:\n  port: 8080\n  hosts:\n    - a\n    - b\n', 'cfg');
    expect(y.children![0].title).toBe('server');
    expect(y.children![0].children!.map((c) => c.title)).toEqual(['port', 'hosts']);
  });
  it('表格：兼容 CSV 导出（层级/标题/说明）；普通表格按首列分组', () => {
    const t = rowsToTree([['层级', '分组', '标题', '说明'], [1, '', 'A', 'a'], [2, 'A', 'A1', ''], [1, '', 'B', '']], 'T');
    expect(titles(t)).toEqual({ T: [{ A: ['A1'] }, 'B'] });
    const g = rowsToTree([['天', '时间', '活动'], ['第一天', '9:00', '签到'], ['', '10:00', '开幕'], ['第二天', '9:00', '徒步'], ['第二天', '14:00', '复盘']], 'G');
    expect(g.children!.map((c) => c.title)).toEqual(['第一天', '第二天']);
    expect(g.children![0].children!.length).toBe(2);
  });
  it('真实文件：docx（本应用导出）→ 保留标题层级', async () => {
    const root = normalizeNode({ title: '团建方案', children: [{ title: '第一天', content: '抵达与破冰', children: [{ title: '签到' }] }, { title: '第二天', children: [{ title: '徒步' }] }] });
    const r = await extractFile('团建方案.docx', makeDocx(root, outline), libs);
    expect(r.kind).toBe('content');
    expect(r.text).toContain('抵达与破冰');
    expect(r.tree!.children!.map((c) => c.title)).toEqual(['第一天', '第二天']);
    expect(treeDepth(r.tree!)).toBeGreaterThanOrEqual(2);
  });
  it('真实文件：pdf → 文字（作为参考 + 按段落成树）', async () => {
    const r = await extractFile('plan.pdf', makePdf(['Team offsite plan', '', 'Day 1: arrival and kickoff', 'Day 2: hiking']), libs);
    expect(r.text).toContain('Day 1: arrival and kickoff');
    expect(r.text).toContain('Day 2: hiking');
    expect(r.tree!.children!.length).toBeGreaterThan(0);
  });
  it('真实文件：xlsx / csv → 表格行成树', async () => {
    const r = await extractFile('日程.xlsx', makeXlsx([['天', '时间', '活动'], ['第一天', '9:00', '签到'], ['第一天', '10:00', '开幕'], ['第二天', '9:00', '徒步'], ['第二天', '14:00', '复盘']]), libs);
    expect(r.text).toContain('签到');
    expect(r.tree!.children!.map((c) => c.title)).toEqual(['第一天', '第二天']);
    const c = await extractFile('a.csv', new TextEncoder().encode('\ufeff标题,说明\r\n"甲,乙",说明一\r\n丙,说明二\r\n'), libs);
    expect(c.tree!.children!.map((x) => x.title)).toEqual(['甲,乙', '丙']);
  });
  it('真实文件：xmind（content.json）→ 结构；不支持的格式给出可读错误', async () => {
    const r = await extractFile('脑图.xmind', await makeXmind({ title: '产品规划', children: [{ title: '目标', note: '季度目标' }, { title: '功能', children: [{ title: '导入' }, { title: '导出' }] }] }), libs);
    expect(r.kind).toBe('structure');
    expect(titles(r.tree!)).toEqual({ 产品规划: ['目标', { 功能: ['导入', '导出'] }] });
    expect(r.tree!.children![0].content).toBe('季度目标');
    expect(xmindJsonToTree({ rootTopic: { title: 'x' } }).title).toBe('x');
    await expect(extractFile('a.pages', new Uint8Array(), libs)).rejects.toThrow(/暂不支持/);
  });
  it('规划师选起始步骤：几个部分 → 第 2 步；层次深且大多有说明 → 更靠后；永远不会直接跳到“完成”之后', () => {
    const shallow = normalizeNode({ title: 'x', children: [{ title: 'a' }, { title: 'b' }] });
    const deep = normalizeNode({ title: 'x', children: Array.from({ length: 6 }, (_, i) => ({ title: `p${i}`, content: '这是一段比较具体的说明文字，超过十二个字', children: Array.from({ length: 5 }, (_, j) => ({ title: `c${j}`, content: '具体安排：时间、地点、负责人都已写清楚', children: [{ title: 'x', content: '更细的执行要点说明文字' }] })) })) });
    const s1 = pickStartStage(shallow, m4), s2 = pickStartStage(deep, m4);
    expect(s1.index).toBe(1);
    expect(s2.index).toBeGreaterThan(s1.index);
    expect(s2.index).toBeLessThanOrEqual(m4.stages.length - 1);
    expect(pickStartStage(normalizeNode({ title: 'x' }), m4).index).toBe(0);
    expect(s2.reason).toMatch(/接着做/);
  });
});

describe('v1.6 参考资料', () => {
  it('按预算截断并标出；停用的不发送', () => {
    const refs = [
      { id: 'a', name: '规范', kind: 'text' as const, text: '甲'.repeat(80), addedAt: 0 },
      { id: 'b', name: '纪要', kind: 'file' as const, text: '乙'.repeat(80), addedAt: 0 },
      { id: 'c', name: '停用', kind: 'text' as const, text: '丙'.repeat(80), addedAt: 0, off: true },
    ];
    const c = refContext(refs, 100);
    expect(c.used).toBe(100);
    expect(c.total).toBe(160);
    expect(c.truncated).toEqual([{ id: 'b', kept: 20, total: 80 }]);
    expect(c.text).toContain('### 规范');
    expect(c.text).toContain('（已截断）');
    expect(c.text).not.toContain('丙');
  });
  it('参考资料进入每一步的提示词（系统消息）', async () => {
    const seen: ChatRequest[] = [];
    const base = createMockText(0);
    const spy: Providers = { text: { id: 'spy', chat: (r, d, s) => { seen.push(r); return base.chat(r, d, s); } }, media: createMockMedia() };
    const a0 = createArtifact(m4, '策划一场三天的团队建设');
    await runStage({ artifact: a0, manifest: m4, stageIndex: 0, op: 'generate', providers: spy, references: '### 规范\n预算上限 1 万元' });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((r) => r.messages[0].content.includes('预算上限 1 万元'))).toBe(true);
  });
});

describe('v1.6 并排对比', () => {
  it('按 id / 标题对齐部分；新增 / 删除 / 改动；属性用字段名显示；字级差异', () => {
    const a = normalizeNode({ title: 'r', children: [{ title: '第一天', content: '上午签到' }, { title: '第二天' }, { title: '旧部分' }] });
    const b = normalizeNode({ title: 'r', children: [{ title: '第一天', content: '上午九点签到' }, { title: '第二天' }, { title: '新部分' }] });
    const rows = alignParts(a, b);
    expect(rows.map((r) => r.status)).toEqual(['mod', 'same', 'add', 'del']);
    const segs = wordDiff('上午签到', '上午九点签到');
    expect(segs.filter((s) => s.add).map((s) => s.t).join('')).toBe('九点');
    expect(segs.filter((s) => !s.add && !s.del).map((s) => s.t).join('')).toBe('上午签到');
    expect(wordDiff('hello big world', 'hello small world').filter((s) => s.add)[0].t).toContain('small');
    const tm = reg.list().map((e) => e.manifest).find((m) => (m.nodeSchema?.props ?? []).length)!;
    const p0 = tm.nodeSchema!.props![0];
    const txt = propsText({ id: 'x', title: 't', props: { [p0.key]: 'v' } }, tm.nodeSchema);
    expect(txt).toBe(`${p0.label}：v`);
    expect(txt).not.toMatch(/[{}]/);
  });
});

describe('v1.6 流式部分结果', () => {
  it('半截 JSON 也能显示已生成的部分', () => {
    const full = JSON.stringify({ title: '方案', children: [{ title: '第一部分', children: [{ title: '子项' }] }, { title: '第二部分' }] });
    const half = full.slice(0, full.indexOf('第二部分') + 2);
    const t = partialTree('```json\n' + half)!;
    expect(t.children![0].title).toBe('第一部分');
    expect(t.children!.length).toBe(2);
    expect(partialTree('')).toBeNull();
    expect(partialTree('{"title": "x"')).toBeNull();
  });
});

describe('v1.6 API Key 加密与迁移', () => {
  const fake: Cipher = { available: () => true, encrypt: (s) => Buffer.from('X' + s), decrypt: (b) => { const s = b.toString(); if (!s.startsWith('X')) throw new Error('bad'); return s.slice(1); } };
  it('写盘加密所有 apiKey 字段；读回解密', () => {
    const s = { text: { apiKey: 'sk-123', model: 'm' }, image: { apiKey: '' }, video: { apiKey: 'v-9' } };
    const sealed = sealSettings(s, fake);
    expect(sealed.text.apiKey.startsWith(ENC_PREFIX)).toBe(true);
    expect(sealed.text.apiKey).not.toContain('sk-123');
    expect(sealed.image.apiKey).toBe('');
    expect(sealed.text.model).toBe('m');
    const back = openSettings(sealed, fake);
    expect(back.settings).toEqual(s);
    expect(back.plaintextFound).toBe(false);
    expect(sealSettings(sealed, fake)).toEqual(sealed); // 幂等
  });
  it('旧版明文 Key：读到后标记迁移；加密不可用时保持明文；损坏密文不崩溃', () => {
    const r = openSettings({ text: { apiKey: 'sk-old' } }, fake);
    expect(r.plaintextFound).toBe(true);
    expect(r.settings.text.apiKey).toBe('sk-old');
    expect(sealSettings(r.settings, fake).text.apiKey.startsWith(ENC_PREFIX)).toBe(true);
    const off: Cipher = { ...fake, available: () => false };
    expect(sealSettings({ text: { apiKey: 'sk' } }, off).text.apiKey).toBe('sk');
    const bad = openSettings({ text: { apiKey: ENC_PREFIX + 'zzzz' } }, fake);
    expect(bad.failed).toBe(1);
    expect(bad.settings.text.apiKey).toBe('');
  });
});

describe('v1.6 自动备份与恢复', () => {
  const setup = () => {
    const d = mkdtempSync(join(tmpdir(), 'refiner-bk-'));
    mkdirSync(join(d, 'projects'));
    writeFileSync(join(d, 'projects', 'p1.json'), '{"v":1}');
    writeFileSync(join(d, 'settings.json'), '{}');
    return d;
  };
  it('备份、保留最近 N 份、恢复（恢复前自动再备份一份）', async () => {
    const d = setup();
    const b1 = await createBackup(d, 'manual', 3, Date.UTC(2026, 9, 1));
    writeFileSync(join(d, 'projects', 'p1.json'), '{"v":2}');
    writeFileSync(join(d, 'projects', 'p2.json'), '{"v":2}');
    for (let i = 2; i <= 4; i++) await createBackup(d, 'manual', 3, Date.UTC(2026, 9, i));
    const list = await listBackups(d);
    expect(list.length).toBe(3);
    expect(list.find((x) => x.id === b1.id)).toBeUndefined(); // 最旧的被清理
    const keep = list[list.length - 1];
    writeFileSync(join(d, 'projects', 'p1.json'), '{"v":3}');
    const r = await restoreBackup(d, keep.id, 3);
    expect(r.safety.reason).toBe('before-restore');
    expect(readFileSync(join(d, 'projects', 'p1.json'), 'utf8')).toBe('{"v":2}');
    // 恢复前的那份里是 v3
    expect(readFileSync(join(d, 'backups', r.safety.id, 'projects', 'p1.json'), 'utf8')).toBe('{"v":3}');
    await expect(restoreBackup(d, 'nope')).rejects.toThrow(/不存在/);
  });
  it('每日备份：24 小时内只做一次；没有作品时不备份', async () => {
    const d = setup();
    const t = Date.UTC(2026, 9, 10, 8);
    expect(await dailyBackupIfDue(d, 10, t)).not.toBeNull();
    expect(await dailyBackupIfDue(d, 10, t + 3600e3)).toBeNull();
    expect(await dailyBackupIfDue(d, 10, t + 25 * 3600e3)).not.toBeNull();
    const e = mkdtempSync(join(tmpdir(), 'refiner-bk-'));
    expect(await dailyBackupIfDue(e, 10, t)).toBeNull();
    expect(existsSync(join(e, 'backups'))).toBe(false);
  });
});
