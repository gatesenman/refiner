import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  TypeRegistry, createArtifact, runStage, runFork, createMockText, createMockMedia, commitVersion, commitManual, unpin,
  effectiveFreedom, checkMonotonicStrict, checkMonotonicScore, freedomScore, findNode, guard, registerOp, listOps,
  getCheck, registerRenderers, DEFAULT_PERSONAS, normalizeReview,
} from '../src/core';
import type { ArtNode, Providers, StageDef, TextProvider, TypeManifest, MediaProvider } from '../src/core';

registerRenderers(['tree', 'mindmap', 'table', 'board', 'timeline', 'code', 'gallery', 'doc']);
const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => ({ text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const, file: f })));
const demo: Providers = { text: createMockText(0), media: createMockMedia() };

async function gen(typeId: string, providers: Providers = demo) {
  const m = reg.get(typeId)!;
  let a = createArtifact(m, '测试主题');
  const r = await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers });
  a = commitVersion(a, r.version);
  return { m, a, r };
}

/** 包一层文本 Provider：可以篡改某个角色的输出（模拟不守规矩的模型） */
function tamper(fn: (meta: any, text: string) => string): TextProvider {
  const base = createMockText(0);
  return { id: 'tamper', async chat(req, d, s) { const t = await base.chat(req, d, s); return fn(req.meta ?? {}, t); } };
}

describe('① 自由度：逐维约束而非标量分', () => {
  const st = (id: string, f: any): StageDef => ({ id, name: id, freedom: f });
  it('只放宽一维、用其他维抵消分数，标量检查发现不了，逐维检查能发现', () => {
    const stages = [
      st('a', { temperature: 0.5, scope: ['artifact'], ops: ['generate', 'expand', 'detail'], strictness: 'loose' }),
      st('b', { temperature: 0.9, scope: ['node'], ops: ['patch'], strictness: 'strict' }),
    ];
    expect(freedomScore(stages[1].freedom)).toBeLessThan(freedomScore(stages[0].freedom));
    expect(checkMonotonicScore(stages)).toEqual([]);
    expect(checkMonotonicStrict(stages).join()).toContain('温度');
  });
  it('effectiveFreedom 逐维取严：温度取小、锁定属性继承、强算子被剔除、新增上限取小', () => {
    const stages = [
      st('a', { temperature: 1, scope: ['artifact'], ops: ['generate'], strictness: 'loose' }),
      st('b', { temperature: 0.6, scope: ['artifact', 'subtree'], ops: ['expand', 'detail'], strictness: 'schema', lockedProps: ['pov'], maxNewNodes: 3 }),
      st('c', { temperature: 0.9, scope: ['artifact', 'node'], ops: ['generate', 'patch'], strictness: 'loose', maxNewNodes: 10 }),
    ];
    const e = effectiveFreedom(stages, 2);
    expect(e.temperature).toBe(0.6);
    expect(e.lockedProps).toEqual(['pov']);
    expect(e.ops).toEqual(['patch']);
    expect(e.scope).toEqual(['artifact', 'node']);
    expect(e.strictness).toBe('schema');
    expect(e.maxNewNodes).toBe(3);
  });
  it('所有内置类型逐维单调', () => {
    for (const x of reg.list()) expect(checkMonotonicStrict(x.manifest.stages), x.manifest.id).toEqual([]);
  });
  it('引擎使用有效自由度：被收紧掉的算子在运行时被拒绝', async () => {
    const m: TypeManifest = { ...reg.get('outline')!, id: 'loose-late' };
    m.stages = [m.stages[0], m.stages[1], { ...m.stages[2], freedom: { ...m.stages[2].freedom, ops: ['patch', 'generate'] } }];
    let a = createArtifact(m, 'x');
    a = commitVersion(a, (await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: demo })).version);
    await expect(runStage({ artifact: a, manifest: m, stageIndex: 2, op: 'generate', providers: demo })).rejects.toThrow(/不允许/);
  });
});

describe('② 锁的传播', () => {
  it('上级被锁时，运行前直接拒绝', async () => {
    const { m, a } = await gen('outline');
    const parent = a.root.children![0];
    const root: ArtNode = JSON.parse(JSON.stringify(a.root));
    root.children![0].locked = true;
    root.children![0].children = [{ id: 'kid', title: '子项' }];
    await expect(runStage({ artifact: { ...a, root }, manifest: m, stageIndex: 1, op: 'expand', targetId: 'kid', providers: demo })).rejects.toThrow(new RegExp(`上级「${parent.title}」已锁定`));
  });
  it('被删除的锁定节点按原位置恢复', () => {
    const m = reg.get('outline')!;
    const old: ArtNode = { id: 'r', title: 'R', children: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', locked: true }, { id: 'c', title: 'C' }] };
    const g = guard(old, { id: 'r', title: 'R', children: [{ id: 'a', title: 'A' }, { id: 'c', title: 'C' }] }, m, 1);
    expect(g.root.children!.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('③ 用户编辑 → 约束（固定）', () => {
  it('手动修改的字段被固定，AI 再次细化时被守卫还原', async () => {
    const { m, a } = await gen('outline');
    const t = a.root.children![0];
    const edited: ArtNode = JSON.parse(JSON.stringify(a.root));
    edited.children![0].title = '我亲手改的标题';
    const b = commitManual(a, edited);
    expect(findNode(b.root, t.id)!.pinned).toEqual(['title']);
    const evil = tamper((meta, text) => (meta.output === 'artifact' && meta.op === 'detail' ? text.replace('我亲手改的标题', 'AI 改回去的标题') : text));
    const r = await runStage({ artifact: b, manifest: m, stageIndex: 1, op: 'detail', providers: { text: evil } });
    expect(findNode(r.root, t.id)!.title).toBe('我亲手改的标题');
    expect(findNode(r.root, t.id)!.pinned).toEqual(['title']);
    expect(r.warnings.join()).toContain('已固定');
  });
  it('显式选中该节点做“改写”视为放开固定；unpin 可取消', async () => {
    const { m, a } = await gen('outline');
    const t = a.root.children![0];
    const edited: ArtNode = JSON.parse(JSON.stringify(a.root));
    edited.children![0].content = '手写说明';
    const b = commitManual(a, edited);
    const r = await runStage({ artifact: b, manifest: m, stageIndex: 2, op: 'rewrite', targetId: t.id, providers: demo });
    expect(findNode(r.root, t.id)!.content).not.toBe('手写说明');
    expect(findNode(unpin(b.root, t.id), t.id)!.pinned).toBeUndefined();
  });
});

describe('④ 守卫回流 + 严格模式还原', () => {
  it('生成者违规 → 守卫预检回流 → 修订者即使评分达标也被强制运行', async () => {
    const m = reg.get('novel-chapter')!;
    let a = createArtifact(m, '雨夜');
    a = commitVersion(a, (await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: demo })).version);
    const root: ArtNode = JSON.parse(JSON.stringify(a.root));
    const scene = root.children![0];
    scene.props = { ...(scene.props ?? {}), pov: '老周' };
    a = { ...a, root };
    const evil = tamper((meta, text) => {
      if (meta.role === 'generator') return text.replace(/"pov":\s*"[^"]*"/g, '"pov": "小李"');
      if (meta.role === 'critic') return '{"score": 9, "issues": []}';
      return text;
    });
    const steps = { steps: [{ id: 'generator', role: 'generator' }, { id: 'critic', role: 'critic', needs: ['generator'] }, { id: 'reviser', role: 'reviser', needs: ['critic'], when: 'critic.score < 8' }] };
    const m2: TypeManifest = { ...m, stages: m.stages.map((s, i) => (i === 2 ? { ...s, pipeline: steps } : s)) };
    const r = await runStage({ artifact: a, manifest: m2, stageIndex: 2, op: 'detail', targetId: scene.id, providers: { text: evil } });
    expect(r.log.some((l) => l.stepId === 'guard-check' && l.summary!.includes('回流'))).toBe(true);
    expect(r.log.find((l) => l.stepId === 'reviser')!.status).toBe('done');
    expect(findNode(r.root, scene.id)!.props!.pov).toBe('老周');
  });
  it('严格模式下目标外的变化被还原（而非仅警告）', () => {
    const m = reg.get('tasks')!;
    const old: ArtNode = { id: 'r', title: 'R', children: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] };
    const changed: ArtNode = { id: 'r', title: 'R 被改', children: [{ id: 'a', title: 'A2' }, { id: 'b', title: 'B 被改' }] };
    const g = guard(old, changed, m, 2, 'a');
    expect(g.root.title).toBe('R');
    expect(findNode(g.root, 'b')!.title).toBe('B');
    expect(findNode(g.root, 'a')!.title).toBe('A2');
  });
});

describe('⑤ 媒体与核心解耦', () => {
  it('engine.ts 中没有任何“图片/视频”字面量', () => {
    const src = readFileSync(join(__dirname, '..', 'src/core/engine.ts'), 'utf8');
    expect(src).not.toMatch(/video|videographer|imager|'image'|图片|图像|视频/);
  });
  it('新模态（如语音 tts）只需 manifest.media 声明 + 能力表注册，零核心改动', async () => {
    const yaml = `id: podcast\nname: 播客\nmedia: { capability: tts, promptField: script, outputField: audio }\nnodeSchema: { props: [ { key: script, label: 台词, type: text } ] }\npipeline:\n  steps:\n    - { id: generator, role: generator }\n    - { id: voice, role: media, name: 配音, needs: [generator] }\ndemo:\n  root: { title: 节目, children: [ { title: 开场, props: { script: 大家好 } }, { title: 结尾, props: { script: 再见 } } ] }`;
    const r0 = new TypeRegistry(); r0.loadAll([{ text: yaml, source: 'user', file: 'p.yaml' }]);
    expect(r0.problems).toEqual([]);
    const m = r0.get('podcast')!;
    const calls: string[] = [];
    const tts: MediaProvider = { id: 'fake-tts', async run(req) { calls.push(req.prompt); return { status: 'succeeded', urls: ['data:audio/mp3;base64,AAAA'] }; } };
    const a = createArtifact(m, '节目');
    const r = await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: { text: createMockText(0), media: { tts } } });
    expect(calls).toEqual(['大家好', '再见']);
    expect(r.root.children![0].props!.audio).toMatch(/^data:audio/);
  });
});

describe('⑥ 评审—修订循环', () => {
  it('循环在达标时停止并记录原因', async () => {
    const { r } = await gen('outline');
    const loop = r.log.find((l) => l.stepId === 'reviser-loop')!;
    expect(loop.summary).toMatch(/达标/);
  });
  it('分数不提升时停止；无法解析的评审被标为“评分无效”而不是默认分', async () => {
    const flat = tamper((meta, text) => (meta.role === 'critic' ? '{"score": 6, "issues": ["太空泛"]}' : text));
    const { r } = await gen('outline', { text: flat });
    expect(r.log.find((l) => l.stepId === 'reviser-loop')!.summary).toMatch(/无明显提升/);
    expect(normalizeReview('完全不是 JSON').note).toMatch(/评分无效/);
    const junk = tamper((meta, text) => (meta.role === 'critic' ? '我觉得还行吧' : text));
    const { r: r2 } = await gen('outline', { text: junk });
    expect(r2.log.find((l) => l.stepId === 'critic')!.summary).toMatch(/评分无效/);
    expect(r2.log.find((l) => l.stepId === 'reviser')!.status).toBe('skipped');
  });
});

describe('⑦ 多人设交叉设计', () => {
  it('每个人设一份方案，交叉评分，作为兄弟分支返回', async () => {
    const m = reg.get('outline')!;
    const a = createArtifact(m, '新员工培训');
    const outs = await runFork({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: demo, personas: DEFAULT_PERSONAS });
    expect(outs.length).toBe(3);
    expect(new Set(outs.map((o) => o.version.parentId)).size).toBe(1);
    expect(new Set(outs.map((o) => o.root.children!.map((c) => c.title).join())).size).toBe(3);
    for (const o of outs) expect(o.log.some((l) => l.stepId === 'cross-review' && !l.roleName.endsWith(o.version.fork!.persona + ' → ' + o.version.fork!.persona))).toBe(true);
    const scores = outs.map((o) => o.version.fork!.score ?? -1);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });
});

describe('⑧ 回退阶段 = 显式放宽', () => {
  it('在“调整”之后回到“细化”运行，版本标记为放宽', async () => {
    const { m, a } = await gen('tasks');
    const t = a.root.children![0].children![0];
    const r1 = await runStage({ artifact: a, manifest: m, stageIndex: 2, op: 'patch', targetId: t.id, instruction: '状态改为进行中', providers: demo });
    const b = commitVersion(a, r1.version);
    const r2 = await runStage({ artifact: b, manifest: m, stageIndex: 1, op: 'detail', providers: demo });
    expect(r2.version.loosened).toBe(true);
    expect(r2.version.label).not.toMatch(/[\u2190-\u21FF]/); // 放宽以图标徽标展示，不在文字里用箭头符号
  });
});

describe('⑨ 注册表与元类型闭环', () => {
  it('新算子只需注册（权重 + 合并语义）即可在插件中使用', async () => {
    registerOp({ id: 'summarize', label: '摘要', desc: '把选中部分压缩为一句话', weight: 0.3, merge: 'keep-children' });
    expect(listOps()).toContain('summarize');
    const r0 = new TypeRegistry();
    r0.loadAll([{ text: `id: sum\nname: 摘要类型\nstages:\n  - { id: generate, name: 生成, freedom: { temperature: 1, scope: [artifact], ops: [generate], strictness: loose } }\n  - { id: s, name: 压缩, freedom: { temperature: 0.2, scope: [node], ops: [summarize], strictness: strict, requireTarget: true } }`, source: 'user', file: 's.yaml' }]);
    expect(r0.problems).toEqual([]);
  });
  it('type-manifest 检查能指出 AI 生成的类型定义中的错误与自由度放宽', () => {
    const c = getCheck('type-manifest')!;
    expect(c.fn({ text: 'id: x\nname: X\nrenderer: nope' }, reg.get('meta.type')!).join()).toContain('renderer');
    const loosen = `id: y\nname: Y\nstages:\n  - { id: a, name: A, freedom: { temperature: 0.3, scope: [artifact], ops: [generate], strictness: loose } }\n  - { id: b, name: B, freedom: { temperature: 0.9, scope: [node], ops: [patch], strictness: strict } }`;
    expect(c.fn({ text: loosen }, reg.get('meta.type')!).join()).toContain('温度');
    expect(reg.get('meta.type')!.checks).toContain('type-manifest');
    expect(c.fn({ text: reg.get('meta.type')!.demo!.text! }, reg.get('meta.type')!)).toEqual([]);
  });
});
