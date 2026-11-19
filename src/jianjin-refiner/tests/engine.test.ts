import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { createServer } from 'http';
import { join } from 'path';
import {
  TypeRegistry, createArtifact, runStage, createMockText, createMockMedia, commitVersion, rollback, freedomScore,
  checkMonotonic, registerRenderers, evalWhen, orderSteps, parseManifest, findNode, versionTreeRows, createOpenAIText, guard, DEFAULT_STAGES,
} from '../src/core';
import type { Providers, TypeManifest, ArtNode } from '../src/core';

registerRenderers(['tree', 'mindmap', 'table', 'board', 'timeline', 'code', 'gallery', 'doc']);
const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => ({ text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const, file: f })));
const demo: Providers = { text: createMockText(0), media: createMockMedia() };

describe('插件注册表', () => {
  it('所有内置插件均能解析且无错误', () => {
    expect(reg.problems).toEqual([]);
    expect(reg.list().length).toBeGreaterThanOrEqual(13);
  });
  it('每个内置类型的阶段自由度单调递减', () => {
    for (const e of reg.list()) expect(checkMonotonic(e.manifest.stages), e.manifest.id).toEqual([]);
  });
  it('extends 继承父类型并只覆盖差异', () => {
    const w = reg.get('weekly-report')!;
    expect(w.renderer).toBe('tree');
    expect(w.views).toEqual(['mindmap', 'doc']);
    expect(w.prompts?.domain).toContain('周报');
  });
  it('非法插件给出可读错误', () => {
    const r = parseManifest('id: x\nname: X\nrenderer: nope');
    expect(r.manifest).toBeNull();
    expect(r.errors.join()).toContain('renderer');
  });
  it('反向自由度会被警告', () => {
    const r = parseManifest(`id: bad\nname: 坏\nstages:\n  - { id: a, name: A, freedom: { temperature: 0.1, scope: [node], ops: [patch], strictness: strict } }\n  - { id: b, name: B, freedom: { temperature: 1.2, scope: [artifact], ops: [generate], strictness: loose } }`);
    expect(r.warnings.some((w) => w.includes('自由度'))).toBe(true);
  });
});

describe('自由度与条件', () => {
  it('默认三阶段严格递减', () => {
    const s = DEFAULT_STAGES.map((x) => freedomScore(x.freedom));
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
  });
  it('when 表达式', () => {
    expect(evalWhen('critic.score < 8', { critic: { score: 6 } })).toBe(true);
    expect(evalWhen('critic.score < 8', { critic: { score: 9 } })).toBe(false);
    expect(evalWhen('critic.score < 8', {})).toBe(false);
    expect(evalWhen('a.score < 8 || b.ok == false', { a: { score: 9 }, b: { ok: false } })).toBe(true);
  });
  it('流水线拓扑排序与循环检测', () => {
    const o = orderSteps([{ id: 'c', role: 'x', needs: ['b'] }, { id: 'b', role: 'x', needs: ['a'] }, { id: 'a', role: 'x' }]);
    expect(o.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(() => orderSteps([{ id: 'a', role: 'x', needs: ['b'] }, { id: 'b', role: 'x', needs: ['a'] }])).toThrow();
  });
});

async function gen(typeId: string, seed = '测试主题') {
  const m = reg.get(typeId)!;
  let a = createArtifact(m, seed);
  const r = await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: demo });
  a = commitVersion(a, r.version);
  return { m, a, r };
}

describe('引擎：生成 → 细化 → 调整', () => {
  it('所有类型都能在演示模式下完成生成', async () => {
    for (const e of reg.list()) {
      const { a, r } = await gen(e.manifest.id);
      if (e.manifest.output === 'text') expect(a.root.content!.length).toBeGreaterThan(10);
      else expect(a.root.children!.length).toBeGreaterThan(0);
      expect(r.log.some((l) => l.status === 'done')).toBe(true);
    }
  });
  it('评审低分触发修订者（条件边）', async () => {
    const { r } = await gen('outline');
    const reviser = r.log.find((l) => l.stepId === 'reviser')!;
    expect(reviser.status).toBe('done');
  });
  it('关闭的智能体被跳过', async () => {
    const m = reg.get('outline')!;
    const a = createArtifact(m, 'x');
    const r = await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: demo, disabledSteps: ['critic', 'planner'] });
    expect(r.log.find((l) => l.stepId === 'critic')!.status).toBe('skipped');
    expect(r.log.find((l) => l.stepId === 'reviser')!.status).toBe('skipped');
  });
  it('细化只影响选中子树，其他节点不变', async () => {
    const { m, a } = await gen('outline');
    const target = a.root.children![1];
    const other = JSON.stringify(a.root.children![0]);
    const r = await runStage({ artifact: a, manifest: m, stageIndex: 1, op: 'expand', targetId: target.id, providers: demo });
    expect(findNode(r.root, target.id)!.children!.length).toBe(target.children!.length + 3);
    expect(JSON.stringify(r.root.children![0])).toBe(other);
  });
  it('调整阶段要求选中目标；不允许的算子被拒绝', async () => {
    const { m, a } = await gen('tasks');
    await expect(runStage({ artifact: a, manifest: m, stageIndex: 2, op: 'patch', providers: demo })).rejects.toThrow(/选中/);
    await expect(runStage({ artifact: a, manifest: m, stageIndex: 2, op: 'generate', providers: demo })).rejects.toThrow(/不允许/);
  });
  it('调整：按指令修改枚举属性，最小改动', async () => {
    const { m, a } = await gen('tasks');
    const t = a.root.children![1].children![1];
    const r = await runStage({ artifact: a, manifest: m, stageIndex: 2, op: 'patch', targetId: t.id, instruction: '状态改为已完成', providers: demo });
    expect(findNode(r.root, t.id)!.props!.status).toBe('已完成');
    expect(findNode(r.root, t.id)!.title).toBe(t.title);
  });
  it('锁定节点被守卫恢复', () => {
    const m = reg.get('outline')!;
    const old: ArtNode = { id: 'r', title: 'R', children: [{ id: 'a', title: 'A', locked: true }, { id: 'b', title: 'B' }] };
    const changed: ArtNode = { id: 'r', title: 'R', children: [{ id: 'b', title: 'B2' }] };
    const g = guard(old, changed, m, 1);
    expect(findNode(g.root, 'a')!.title).toBe('A');
    expect(g.warnings.join()).toContain('锁定');
  });
  it('锁定属性（小说视角人物）不能被修改', async () => {
    const m = reg.get('novel-chapter')! as TypeManifest;
    const old: ArtNode = { id: 'r', title: 'R', children: [{ id: 'a', title: 'A', props: { pov: '老周' } }] };
    const changed: ArtNode = { id: 'r', title: 'R', children: [{ id: 'a', title: 'A', props: { pov: '小李' } }] };
    expect(findNode(guard(old, changed, m, 2).root, 'a')!.props!.pov).toBe('老周');
  });
  it('文本型调整：只替换选区，未选中部分逐字不变', async () => {
    const { m, a } = await gen('yaml', 'CI');
    const text = a.root.content!;
    const from = text.indexOf('name: CI');
    const sel = { from, to: from + 'name: CI'.length, text: 'name: CI' };
    const r = await runStage({ artifact: a, manifest: m, stageIndex: 2, op: 'patch', selection: sel, instruction: '大写', providers: demo });
    expect(r.root.content).toBe(text.slice(0, from) + 'NAME: CI' + text.slice(sel.to));
  });
  it('图片类型调用图像 Provider，填充 url', async () => {
    const { a } = await gen('image');
    expect(String(a.root.children![0].props!.url)).toMatch(/^data:image/);
  });
  it('视频类型在未配置视频服务时不伪造视频', async () => {
    const { m, a } = await gen('video');
    const r = await runStage({ artifact: a, manifest: m, stageIndex: 3, op: 'patch', providers: demo });
    expect(r.root.props!.videoStatus).toBe('unconfigured');
    expect(r.root.props!.video).toBeUndefined();
  });
  it('多智能体自定义角色（API 安全审查）参与流水线', async () => {
    const { r } = await gen('api-design');
    expect(r.log.find((l) => l.stepId === 'security')!.status).toBe('done');
  });
  it('版本树：回滚后再操作形成分支', async () => {
    const { m, a } = await gen('outline');
    const v1 = a.head;
    const r1 = await runStage({ artifact: a, manifest: m, stageIndex: 1, op: 'detail', providers: demo });
    let b = commitVersion(a, r1.version);
    b = rollback(b, v1);
    const r2 = await runStage({ artifact: b, manifest: m, stageIndex: 1, op: 'expand', providers: demo });
    b = commitVersion(b, r2.version);
    const kids = b.versions.filter((v) => v.parentId === v1);
    expect(kids.length).toBe(2);
    expect(versionTreeRows(b).length).toBe(b.versions.length);
  });
});

describe('OpenAI 兼容适配器（本地模拟服务器）', () => {
  it('流式 SSE 与非流式 JSON 都能正确解析，并真正跑通引擎', async () => {
    const seen: any[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body);
        seen.push({ auth: req.headers.authorization, url: req.url, ...j });
        const sys = j.messages[0].content as string;
        const answer = sys.includes('评审') || sys.includes('一致性')
          ? '{"score": 9, "ok": true, "issues": []}'
          : '<think>内部推理</think>```json\n{"title":"根","children":[{"title":"甲"},{"title":"乙","children":[{"title":"乙-1"}]}]}\n```';
        if (j.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          for (let i = 0; i < answer.length; i += 7) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(i, i + 7) } }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    try {
      for (const stream of [true, false]) {
        const text = createOpenAIText({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-test', model: 'fake', stream });
        const m = reg.get('outline')!;
        const a = createArtifact(m, '测试');
        let deltas = 0;
        const r = await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: { text }, onDelta: () => deltas++ });
        expect(r.root.children!.map((c) => c.title)).toEqual(['甲', '乙']);
        expect(deltas).toBeGreaterThan(0);
      }
      expect(seen[0].auth).toBe('Bearer sk-test');
      expect(seen[0].url).toBe('/v1/chat/completions');
      expect(seen[0].model).toBe('fake');
      expect(typeof seen[0].temperature).toBe('number');
    } finally {
      server.close();
    }
  });
});

describe('稳健解析', () => {
  it('能修复小模型常见的坏 JSON', async () => {
    const { extractJSON } = await import('../src/core');
    expect(extractJSON('好的：\n```json\n{"title": "A", "children": [{"title": "B",},]}\n```').children[0].title).toBe('B');
    expect(extractJSON('{"title": "说"你好"", "content": "x"').title).toContain('你好');
  });
});

describe('选区合并', () => {
  it('模型返回整份文档时，只采纳选区所在行', async () => {
    const { spliceSelection } = await import('../src/core');
    const old = 'a: 1\nb: 2\nc: 3\nd: 4\ne: 5\nf: 6\ng: 7\n';
    const from = old.indexOf('c: 3');
    const sel = { from, to: from + 4, text: 'c: 3' };
    const whole = 'a: 1\nb: 2\nc: 30\nd: 4\ne: 5\nf: 6\ng: 7\n# extra junk that the model added somewhere else\n';
    const r1 = spliceSelection(old, sel, whole);
    expect(r1.text.split('\n').slice(0, 7)).toEqual(['a: 1', 'b: 2', 'c: 30', 'd: 4', 'e: 5', 'f: 6', 'g: 7']);
    const r2 = spliceSelection(old, sel, 'c: 33');
    expect(r2.text).toBe(old.replace('c: 3', 'c: 33'));
  });
});

describe('选区合并：上下文复述', () => {
  it('只复述上下文则保持原样；夹带修改则只采纳新行', async () => {
    const { spliceSelection } = await import('../src/core');
    const old = 'x:\n  image: a:1\n  port: 80\ny:\n  image: b:2\n  port: 90\nz: 1\nw: 2\n';
    const from = old.indexOf('  image: a:1');
    const sel = { from, to: from + '  image: a:1'.length, text: '  image: a:1' };
    expect(spliceSelection(old, sel, 'y:\n  image: b:2\n  port: 90').text).toBe(old);
    expect(spliceSelection(old, sel, 'y:\n  image: a:1.2.3\n  port: 90').text).toBe(old.replace('image: a:1', 'image: a:1.2.3'));
  });
});
