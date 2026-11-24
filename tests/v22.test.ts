import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, runStage, effectivePrefs, serializePrefs, parsePrefs, mergePrefs, prefBlock, addPref, surveyPrompt, parseSurvey, surveyBlock } from '../src/core';
import type { Providers, TypeManifest, Artifact, Pref } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = { ...outline, id: 'bp-x', stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']) };

describe('v2.2 偏好作用域与导入导出', () => {
  it('effectivePrefs：作品级在前，同句以作品为准', () => {
    const work: Pref[] = [{ id: 'w', text: '不要用英文缩写', on: false, from: 'user', at: 1, scope: 'work' }];
    const glob: Pref[] = [{ id: 'g', text: '不要用英文缩写', on: true, from: 'user', at: 0, scope: 'global' }, { id: 'g2', text: '标题不超过 16 字', on: true, from: 'revert', at: 0, scope: 'global' }];
    const e = effectivePrefs(work, glob);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ text: '不要用英文缩写', on: false });
    expect(e[1].text).toBe('标题不超过 16 字');
    const b = prefBlock(e);
    expect(b).toContain('标题不超过 16 字');
    expect(b).not.toContain('不要用英文缩写');
  });
  it('serialize / parse 往返；坏数据抛错', () => {
    const list = addPref(undefined, '保持口语', 'user', 'p1');
    const json = serializePrefs(list);
    const back = parsePrefs(json);
    expect(back[0].text).toBe('保持口语');
    expect(back[0].scope).toBe('work');
    expect(() => parsePrefs('{}')).toThrow(/偏好文件/);
    const merged = mergePrefs(list, parsePrefs(JSON.stringify({ version: 1, prefs: [{ text: '新的一条' }] })), 'work');
    expect(merged.map((p) => p.text)).toEqual(['新的一条', '保持口语']);
  });
  it('引擎把全局偏好注入提示词', async () => {
    const root = normalizeNode({ title: '空' });
    const a: Artifact = { ...createArtifact(M, '发布计划'), root, stageIndex: 0 };
    const seen: string[] = [];
    const p: Providers = { text: { id: 's', chat: async (req) => {
      seen.push(req.messages.map((x) => x.content).join('\n'));
      const role = String(req.meta?.role ?? '');
      if (role === 'survey') return '{"perspectives":[{"name":"执行者","notes":"先锁范围"},{"name":"审查者","notes":"查待定"},{"name":"使用者","notes":"能开干"}]}';
      if (role === 'critic' || role === 'consistency') return '{"score":8}';
      return JSON.stringify({ title: '发布计划', children: [{ title: 'A', content: '说明足够长了吧' }] });
    } } };
    await runStage({ artifact: a, manifest: M, stageIndex: 0, op: 'generate', providers: p, globalPrefs: [{ id: 'g', text: '不要虚构数字', on: true, from: 'user', at: 0, scope: 'global' }] });
    expect(seen.some((x) => x.includes('不要虚构数字'))).toBe(true);
  });
});

describe('v2.2 STORM 式多视角预写作', () => {
  it('surveyPrompt 要求三个过程角色并只要 JSON', () => {
    const p = surveyPrompt('策划一场团建');
    expect(p).toContain('执行者'); expect(p).toContain('审查者'); expect(p).toContain('使用者');
    expect(p).toContain('"perspectives"');
  });
  it('parseSurvey 从 JSON 抽出至少 2 个视角；不足则抛错', () => {
    const ps = parseSurvey('备注{"perspectives":[{"name":"执行者","notes":"先锁范围与验收"},{"name":"审查者","notes":"查待定与预算"}]}');
    expect(ps).toHaveLength(2);
    expect(surveyBlock({ perspectives: ps, at: 0 })).toContain('【多视角备忘】');
    expect(() => parseSurvey('{"perspectives":[]}')).toThrow();
  });
  it('第一次 generate（空树）会先跑 survey，并把备忘注入后续提示词', async () => {
    const a: Artifact = { ...createArtifact(M, '周末团建'), root: normalizeNode({ title: '周末团建' }), stageIndex: 0 };
    const roles: string[] = [];
    const seen: string[] = [];
    const p: Providers = { text: { id: 's', chat: async (req) => {
      roles.push(String(req.meta?.role ?? ''));
      seen.push(req.messages.map((x) => x.content).join('\n'));
      const role = String(req.meta?.role ?? '');
      if (role === 'survey') return '{"perspectives":[{"name":"执行者","notes":"先排预算和场地"},{"name":"审查者","notes":"安全预案不能缺"},{"name":"使用者","notes":"同事要看得懂议程"}]}';
      if (role === 'critic' || role === 'consistency') return '{"score":8}';
      return JSON.stringify({ title: '周末团建', children: [{ title: '议程', content: '第一天破冰，第二天复盘' }] });
    } } };
    const r = await runStage({ artifact: a, manifest: M, stageIndex: 0, op: 'generate', providers: p });
    expect(roles[0]).toBe('survey');
    expect(r.survey?.perspectives.map((x) => x.name)).toEqual(['执行者', '审查者', '使用者']);
    expect(seen.some((x) => x.includes('【多视角备忘】') && x.includes('先排预算和场地'))).toBe(true);
  });
  it('survey:false 或已有 children 时不跑预写作', async () => {
    const a: Artifact = { ...createArtifact(M, '已有'), root: normalizeNode({ title: '已有', children: [{ title: 'X' }] }), stageIndex: 0 };
    const roles: string[] = [];
    const p: Providers = { text: { id: 's', chat: async (req) => {
      roles.push(String(req.meta?.role ?? ''));
      if (String(req.meta?.role) === 'critic') return '{"score":8}';
      return JSON.stringify({ title: '已有', children: [{ title: 'X', content: '补了说明文字' }] });
    } } };
    const r = await runStage({ artifact: a, manifest: M, stageIndex: 0, op: 'generate', providers: p });
    expect(roles).not.toContain('survey');
    expect(r.survey).toBeUndefined();
    const a2: Artifact = { ...createArtifact(M, '空'), root: normalizeNode({ title: '空' }), stageIndex: 0 };
    const roles2: string[] = [];
    const p2: Providers = { text: { id: 's', chat: async (req) => { roles2.push(String(req.meta?.role ?? '')); if (String(req.meta?.role) === 'critic') return '{"score":8}'; return JSON.stringify({ title: '空', children: [{ title: 'Y', content: '说明文字足够' }] }); } } };
    await runStage({ artifact: a2, manifest: M, stageIndex: 0, op: 'generate', providers: p2, survey: false });
    expect(roles2).not.toContain('survey');
  });
});
