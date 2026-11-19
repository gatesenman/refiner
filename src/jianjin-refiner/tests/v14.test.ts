import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  TypeRegistry, createMockText, createMockMedia, planProcess, createArtifact, runStage, commitVersion, RunFailedError, isJunkTree, isJunkText,
  humanizeError, validateTextConfig, createOpenAIText, splitDetail, DETAIL_SEP, isVagueIntent, shouldClarify, clarifyIntent, composeIntent, DEFAULT_CLARIFY,
  headChanges, undo, redo, revertChange, keepChange, markReviewed, findNode, mockRespond,
} from '../src/core';
import type { Artifact, Providers, TextProvider, TypeManifest } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const demo: Providers = { text: createMockText(0), media: createMockMedia() };
const JUNK = '抱歉我不太明白你的意思，哈哈 <<<not json>>>';

/** 让指定角色返回垃圾，其余走演示 */
function junkFor(roles: string[]): Providers {
  const t: TextProvider = { id: 'junk', async chat(req) { const m: any = req.meta ?? {}; return roles.includes(m.role) ? JUNK : mockRespond(m); } };
  return { text: t, media: createMockMedia() };
}

describe('P0-1 垃圾输出 = 运行失败，不提交版本', () => {
  it('判据：任意文本被 jsonrepair 修成字符串、拒答、空对象都算垃圾', () => {
    expect(isJunkTree('抱歉', JUNK)).toBe(true);
    expect(isJunkTree({}, '{}')).toBe(true);
    expect(isJunkTree({ title: '抱歉，我无法完成' }, '')).toBe(true);
    expect(isJunkTree({ title: '方案', children: [{ title: 'a' }] }, '')).toBe(false);
    expect(isJunkText('')).toBe(true);
    expect(isJunkText('Sorry, I cannot help')).toBe(true);
    expect(isJunkText('```yaml\na: 1\n```')).toBe(false);
  });
  it('生成者返回垃圾 → RunFailedError(kind=junk)，带原始回复；日志该步为“失败”', async () => {
    const a = createArtifact(outline, '测试主题');
    let err: any;
    try { await runStage({ artifact: a, manifest: outline, stageIndex: 0, op: 'generate', providers: junkFor(['generator']) }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RunFailedError);
    expect(err.kind).toBe('junk');
    expect(err.raw).toBe(JUNK);
    expect(err.message).toContain('已保留原样');
    const gen = err.log.find((l: any) => l.role === 'generator');
    expect(gen.status).toBe('error');
    expect(err.log.some((l: any) => l.summary === '所有约束均满足')).toBe(false); // 守卫不得在无草稿时报“满足”
  });
  it('只返回一个标题（没有展开）也算失败', async () => {
    const t: TextProvider = { id: 'x', async chat(req) { const m: any = req.meta ?? {}; return m.role === 'generator' ? '{"title":"只有标题"}' : mockRespond(m); } };
    await expect(runStage({ artifact: createArtifact(outline, 'x'), manifest: outline, stageIndex: 0, op: 'generate', providers: { text: t } })).rejects.toBeInstanceOf(RunFailedError);
  });
  it('修订者返回垃圾 → 沿用上一份草稿，运行仍成功', async () => {
    const r = await runStage({ artifact: createArtifact(outline, '测试主题'), manifest: outline, stageIndex: 0, op: 'generate', providers: junkFor(['reviser']) });
    expect(r.root.children!.length).toBeGreaterThan(0);
    expect(r.warnings.join()).toContain('沿用上一份草稿');
  });
});

describe('P0-2 错误人话化 + 本地校验', () => {
  const ctx = { baseUrl: 'https://api.example.com/v1', model: 'm1' };
  it('分类', () => {
    expect(humanizeError(Object.assign(new Error('HTTP 401：bad'), { status: 401 }), ctx).message).toContain('API Key 无效');
    expect(humanizeError(new Error('HTTP 404：nope'), ctx).message).toContain('「m1」在 api.example.com 上不存在');
    expect(humanizeError(new Error('HTTP 429：slow'), ctx).message).toContain('额度');
    expect(humanizeError(new TypeError('fetch failed'), { baseUrl: 'http://127.0.0.1:9/v1' }).message).toBe('无法连接到 127.0.0.1:9。请检查网络、代理，或地址是否正确。');
    expect(humanizeError(Object.assign(new Error('x'), { timeout: true }), ctx).message).toContain('超过 60 秒');
    expect(humanizeError(new TypeError('Failed to parse URL from sk-bad/chat/completions'), ctx).kind).toBe('url');
    expect(humanizeError(new Error('HTTP 502：x'), ctx).kind).toBe('server');
  });
  it('本地拦截：没填 Key（非本机）/ 地址不合法', () => {
    expect(validateTextConfig({ baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' })?.kind).toBe('nokey');
    expect(validateTextConfig({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen' })).toBeNull();
    expect(validateTextConfig({ baseUrl: 'sk-bad', apiKey: 'k', model: 'm' })?.message).toBe('地址需以 http:// 或 https:// 开头');
  });
  it('适配器：401 → 人话 + 详情；没填 Key 不发请求；网络失败 → 无法连接', async () => {
    const f401 = vi.fn(async () => new Response('{"error":{"message":"Invalid API key"}}', { status: 401 }));
    const p = createOpenAIText({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'm', stream: false }, f401 as any);
    const e1: any = await p.chat({ messages: [{ role: 'user', content: 'hi' }], temperature: 0 }).catch((e) => e);
    const s1 = splitDetail(e1.message);
    expect(s1.message).toContain('API Key 无效');
    expect(s1.detail).toContain('Invalid API key');
    const fNo = vi.fn();
    const e2: any = await createOpenAIText({ baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm' }, fNo as any).chat({ messages: [], temperature: 0 }).catch((e) => e);
    expect(fNo).not.toHaveBeenCalled();
    expect(e2.message).toContain('请先填写 API Key');
    const fNet = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const e3: any = await createOpenAIText({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'm' }, fNet as any).chat({ messages: [], temperature: 0 }).catch((e) => e);
    expect(splitDetail(e3.message).message).toContain('无法连接到 127.0.0.1:9');
    expect(e3.message).toContain(DETAIL_SEP);
  });
});

describe('P0-5 含糊意图先澄清', () => {
  it('判据', () => {
    expect(isVagueIntent('帮我弄一下')).toBe(true);
    expect(isVagueIntent('搞个东西')).toBe(true);
    expect(isVagueIntent('策划一场三天的团队建设')).toBe(false);
    expect(isVagueIntent('写一首关于秋天的歌')).toBe(false);
    expect(shouldClarify('设计一个微信小程序的数据库')).toBe(false);
  });
  it('演示：含糊 → 3 个带选项的问题；清楚的短意图 → 不问', async () => {
    const qs = await clarifyIntent({ intent: '帮我弄一下', providers: demo });
    expect(qs.length).toBe(3);
    expect(qs.every((q) => q.options.length >= 2)).toBe(true);
    expect(await clarifyIntent({ intent: '写首秋天的歌', providers: demo })).toEqual([]);
  });
  it('真实模型路径：模型给出问题 → 采用；模型出错 / 说清楚但实际含糊 → 通用问题', async () => {
    const good: TextProvider = { id: 'g', async chat() { return '{"questions":[{"q":"做给谁？","options":["家人","同事"]}]}'; } };
    expect((await clarifyIntent({ intent: '帮我弄一下', providers: { text: good } }))[0].q).toBe('做给谁？');
    const boom: TextProvider = { id: 'b', async chat() { throw new Error('HTTP 500'); } };
    expect(await clarifyIntent({ intent: '帮我弄一下', providers: { text: boom } })).toEqual(DEFAULT_CLARIFY);
    const lazy: TextProvider = { id: 'l', async chat() { return '{"questions":[]}'; } };
    expect(await clarifyIntent({ intent: '弄一下', providers: { text: lazy } })).toEqual(DEFAULT_CLARIFY);
  });
  it('回答拼进意图，跳过的不拼', () => {
    expect(composeIntent('帮我弄一下', DEFAULT_CLARIFY, { what: '活动或计划', depth: '可执行清单' })).toBe('帮我弄一下（你想做的是：活动或计划；要多细：可执行清单）');
    expect(composeIntent('帮我弄一下', DEFAULT_CLARIFY, {})).toBe('帮我弄一下');
  });
  it('澄清后的意图能规划出可用流程', async () => {
    const r = await planProcess({ intent: composeIntent('帮我弄一下', DEFAULT_CLARIFY, { what: '活动或计划' }), providers: demo, templates: [] });
    expect(r.manifest.stages.length).toBeGreaterThanOrEqual(2);
  });
});

describe('P0-6 改动高亮 + 撤销/重做 + 逐条审阅', () => {
  async function twoRuns() {
    let a: Artifact = createArtifact(outline, '测试主题');
    const g = await runStage({ artifact: a, manifest: outline, stageIndex: 0, op: 'generate', providers: demo });
    a = commitVersion(a, g.version);
    const target = a.root.children![0];
    const ef = outline.stages[1].freedom.ops.includes('expand') ? 1 : 0;
    const e = await runStage({ artifact: a, manifest: outline, stageIndex: ef, op: 'expand', targetId: target.id, providers: demo });
    a = commitVersion(markReviewed(a), e.version);
    return { a, target };
  }
  it('高亮：新增 / 修改按节点统计；全部保留后不再高亮', async () => {
    const { a } = await twoRuns();
    const c = headChanges(a)!;
    expect(c.added).toBeGreaterThan(0);
    expect([...c.map.values()].some((x) => x.kind === 'add')).toBe(true);
    expect(headChanges(markReviewed(a))).toBeUndefined();
  });
  it('撤销 = 回到父版本（不新建分支），重做 = 前进', async () => {
    const { a } = await twoRuns();
    const n = a.versions.length;
    const u = undo(a);
    expect(u.undone).toBe(a.head);
    expect(u.artifact.versions.length).toBe(n);
    expect(u.artifact.head).toBe(a.versions.find((v) => v.id === a.head)!.parentId);
    const r = redo(u.artifact, u.undone!);
    expect(r.head).toBe(a.head);
    expect(JSON.stringify(r.root)).toBe(JSON.stringify(a.root));
  });
  it('逐条撤回：新增节点被移除，其余改动仍在高亮；逐条保留后该处不再高亮', async () => {
    const { a } = await twoRuns();
    const c = headChanges(a)!;
    const added = [...c.map.entries()].filter(([, x]) => x.kind === 'add').map(([id]) => id);
    const b = revertChange(a, added[0]);
    expect(findNode(b.root, added[0])).toBeNull();
    const c2 = headChanges(b);
    if (added.length > 1) { expect(c2!.added).toBe(c.added - 1); const k = keepChange(b, added[1]); expect(headChanges(k)?.map.has(added[1]) ?? false).toBe(false); }
  });
});

describe('P0-7 演示样例', () => {
  it('首页 3 个示例在演示模式下返回写好的内容', async () => {
    for (const [intent, title] of [['策划一场三天的团队建设', '三天两晚团队建设方案'], ['设计一个微信小程序的数据库', '微信小程序商城 · 数据库设计'], ['写一首关于秋天的歌', '《落叶寄信》']]) {
      const r = await planProcess({ intent, providers: demo, templates: [] });
      const m: TypeManifest = r.manifest;
      const run = await runStage({ artifact: { ...createArtifact(m, intent), blueprint: m }, manifest: m, stageIndex: 0, op: 'generate', providers: demo });
      expect(run.root.title).toBe(title);
      expect(JSON.stringify(run.root)).not.toContain('要点1');
    }
  });
});

describe('展开时模型丢了 id 也不重复追加旧子项', () => {
  it('团建样例：第 2 天加雨天备选，只新增雨天项', async () => {
    let a: Artifact = createArtifact(outline, '策划一场三天的团队建设');
    const g = await runStage({ artifact: a, manifest: outline, stageIndex: 0, op: 'generate', providers: demo });
    a = commitVersion(a, g.version);
    const day2 = a.root.children!.find((c) => c.title.includes('第 2 天'))!;
    const before = day2.children!.length;
    const ef = outline.stages[1].freedom.ops.includes('expand') ? 1 : 0;
    const e = await runStage({ artifact: a, manifest: outline, stageIndex: ef, op: 'expand', targetId: day2.id, instruction: '加一个雨天备选方案', providers: demo });
    a = commitVersion(a, e.version);
    const kids = findNode(a.root, day2.id)!.children!;
    const titles = kids.map((k) => k.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(kids.length).toBeGreaterThan(before);
  });
});
