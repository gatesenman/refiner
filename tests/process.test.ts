import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  TypeRegistry, createMockText, createMockMedia, planProcess, checkMonotonicStrict, validateManifest, createArtifact, runStage,
  buildSchedule, enforceMonotone, matchTemplates, genericBlueprint, blueprintToTemplate, dumpManifest, parseManifest, effectiveFreedom, freedomScore,
} from '../src/core';
import type { Providers, TextProvider } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const templates = reg.list().map((e) => e.manifest);
const demo: Providers = { text: createMockText(0), media: createMockMedia() };

/** 随机生成一个从未见过的意图（随机汉字 + 随机英文词），保证不可能命中任何预置场景 */
function randomIntent(seed: number) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const han = Array.from({ length: 6 + Math.floor(rnd() * 20) }, () => String.fromCharCode(0x4e00 + Math.floor(rnd() * 0x5000))).join('');
  const en = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => Math.random().toString(36).slice(2, 7)).join(' ');
  return `${han} ${en}`;
}

async function assertUsable(intent: string) {
  const r = await planProcess({ intent, providers: demo, templates });
  const m = r.manifest;
  // 蓝图本身必须是合法的 manifest，且自由度逐维单调
  expect(validateManifest(JSON.parse(JSON.stringify(m))).errors).toEqual([]);
  expect(checkMonotonicStrict(m.stages)).toEqual([]);
  expect(m.stages.length).toBeGreaterThanOrEqual(2);
  expect(m.stages[0].freedom.ops).toContain('generate');
  const scores = m.stages.map((_s, i) => freedomScore(effectiveFreedom(m.stages, i)));
  for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
  // 第一个检查点能产出制品
  const a = createArtifact(m, intent);
  const run = await runStage({ artifact: { ...a, blueprint: m }, manifest: m, stageIndex: 0, op: 'generate', providers: demo });
  expect(run.root.children?.length ?? 0).toBeGreaterThan(0);
  return r;
}

describe('流程规划：任意意图 → 合法、单调的流程蓝图', () => {
  it('随机的、从未见过的意图（演示模式）得到合法单调蓝图与第一阶段制品', async () => {
    for (let k = 1; k <= 12; k++) await assertUsable(randomIntent(k * 7919));
  });

  it('多个互不相关的真实意图都能派生出各自的形态与检查点', async () => {
    const intents = ['策划一场三天的团队建设', '设计一个微信小程序的数据库', '写一首关于秋天的歌', '我们公司明年该不该进入东南亚市场', '一次带父母去云南的旅行', '研究：远程办公是否降低了创新'];
    const shapes = new Set<string>();
    for (const t of intents) {
      const r = await assertUsable(t);
      expect(r.source).not.toBe('fallback');
      shapes.add(`${r.manifest.renderer}|${r.manifest.stages.map((s) => s.name).join('>')}`);
    }
    expect(shapes.size).toBeGreaterThanOrEqual(4); // 不同意图得到不同的过程，而不是同一个模板
  });

  it('“三天”被推断为三个按天的一级结构，且带日期属性（形态由规划师推断，核心无场景逻辑）', async () => {
    const r = await planProcess({ intent: '策划一场三天的团队建设', providers: demo, templates });
    const titles = (r.manifest.demo?.root?.children ?? []).map((c) => c.title);
    expect(titles.filter((t) => /第 \d 天/.test(t)).length).toBe(3);
    expect(r.manifest.nodeSchema?.props?.map((p) => p.type)).toContain('date');
  });

  it('与已有模板高度相似时复用模板；用户也可指定模板', async () => {
    expect(matchTemplates('课程大纲', templates)[0]?.id).toBe('outline');
    const forced = await planProcess({ intent: '随便什么', providers: demo, templates, templateId: 'mindmap' });
    expect(forced.source).toBe('template');
    expect(forced.manifest.origin?.templateId).toBe('mindmap');
  });

  it('真实模型给出放宽的时间表 → 校验问题回流给修订者 → 修正后单调', async () => {
    const calls: string[] = [];
    const llm: TextProvider = {
      id: 'fake',
      async chat(req) {
        const role = String(req.meta?.role);
        calls.push(role);
        if (role === 'process-shape') return '{"name":"测试","levels":["a","b"],"renderer":"tree","props":[{"key":"due","label":"截止","type":"date"}]}';
        if (role === 'process-schedule') return JSON.stringify({ stages: [
          { name: '起', temperature: 0.9, scope: ['artifact'], ops: ['generate'], strictness: 'loose' },
          { name: '承', temperature: 1.2, scope: ['artifact', 'subtree'], ops: ['expand'], strictness: 'loose', maxNewNodes: 10 },
          { name: '合', temperature: 0.3, scope: ['node'], ops: ['patch'], strictness: 'strict', maxNewNodes: 20 },
        ] });
        if (role === 'process-reviser') {
          expect(String(req.messages[1].content)).toContain('放宽了【温度】');
          return JSON.stringify({ stages: [
            { name: '起', temperature: 0.9, scope: ['artifact'], ops: ['generate'], strictness: 'loose' },
            { name: '承', temperature: 0.7, scope: ['artifact', 'subtree'], ops: ['expand'], strictness: 'schema', maxNewNodes: 10 },
            { name: '合', temperature: 0.3, scope: ['node'], ops: ['patch'], strictness: 'strict', maxNewNodes: 2 },
          ] });
        }
        return '';
      },
    };
    const r = await planProcess({ intent: '任意', providers: { text: llm }, templates });
    expect(calls).toEqual(['process-shape', 'process-schedule', 'process-reviser']);
    expect(r.source).toBe('derived');
    expect(checkMonotonicStrict(r.manifest.stages)).toEqual([]);
    expect(r.manifest.stages.map((s) => s.name)).toEqual(['起', '承', '合']);
    expect(r.log.some((l) => l.stepId === 'revise-1')).toBe(true);
  });

  it('模型输出完全不可用（乱码 / 抛错）时也不会失败：回退或自动收紧，蓝图始终合法', async () => {
    const garbage: TextProvider = { id: 'g', async chat() { return '我不知道 ¯\\_(ツ)_/¯'; } };
    const r1 = await planProcess({ intent: '某件事', providers: { text: garbage }, templates });
    expect(checkMonotonicStrict(r1.manifest.stages)).toEqual([]);
    const thrower: TextProvider = { id: 't', async chat() { throw new Error('网络错误'); } };
    const r2 = await planProcess({ intent: '另一件事', providers: { text: thrower }, templates });
    expect(validateManifest(r2.manifest).errors).toEqual([]);
    const stubborn: TextProvider = { id: 's', async chat(req) {
      return req.meta?.role === 'process-shape' ? '{}' : JSON.stringify({ stages: [{ name: 'A', temperature: 0.2, ops: ['generate'] }, { name: 'B', temperature: 1.4, ops: ['generate'], scope: ['artifact'], strictness: 'loose' }] });
    } };
    const r3 = await planProcess({ intent: '固执的模型', providers: { text: stubborn }, templates });
    expect(checkMonotonicStrict(r3.manifest.stages)).toEqual([]);
    expect(r3.warnings.join()).toContain('自动收紧');
  });

  it('检查点只是自由度轴上的命名点：任意数量都能生成单调时间表；enforceMonotone 对任意序列成立', () => {
    for (let n = 1; n <= 6; n++) expect(checkMonotonicStrict(buildSchedule(Array.from({ length: n }, (_, i) => `c${i}`)))).toEqual([]);
    const messy = buildSchedule(['a', 'b', 'c', 'd']).reverse();
    expect(checkMonotonicStrict(messy).length).toBeGreaterThan(0);
    expect(checkMonotonicStrict(enforceMonotone(messy))).toEqual([]);
    expect(checkMonotonicStrict(genericBlueprint('x').stages)).toEqual([]);
  });

  it('任何一次运行的蓝图都可另存为模板，并能被插件解析器重新加载', async () => {
    const r = await planProcess({ intent: '设计一个微信小程序的数据库', providers: demo, templates });
    const t = blueprintToTemplate(r.manifest, '小程序数据库');
    const back = parseManifest(dumpManifest(t));
    expect(back.errors).toEqual([]);
    expect(back.manifest!.name).toBe('小程序数据库');
    expect(back.manifest!.intent).toBeUndefined();
  });
});
