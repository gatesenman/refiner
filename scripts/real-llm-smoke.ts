/**
 * 真实模型冒烟测试：用 OpenAI 兼容适配器（流式 SSE）连接本机 Ollama，跑通完整多智能体流水线。
 * 用法：BASE=http://127.0.0.1:11434/v1 MODEL=qwen-local npx vite-node scripts/real-llm-smoke.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, createArtifact, runStage, commitVersion, createOpenAIText, toOutlineText, findNode } from '../src/core';

const base = process.env.BASE ?? 'http://127.0.0.1:11434/v1';
const model = process.env.MODEL ?? 'qwen-local';
const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).map((f) => ({ text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const, file: f })));
const text = createOpenAIText({ baseUrl: base, apiKey: '', model, stream: true, maxTokens: 1200 });
const out: string[] = [`# 真实模型冒烟测试\n\n- 接口：${base}（OpenAI 兼容，流式 SSE）\n- 模型：${model}\n- 时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`];
const log = (s: string) => { console.log(s); out.push(s); };

async function main() {
  // 1) 大纲：完整 5 角色流水线
  const m = reg.get('outline')!;
  let a = createArtifact(m, '给新员工的 Git 入门培训');
  let deltas = 0;
  const t0 = Date.now();
  const r1 = await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: { text }, onDelta: () => deltas++ });
  a = commitVersion(a, r1.version);
  log(`\n## 1. 大纲 · 生成（${((Date.now() - t0) / 1000).toFixed(0)}s，流式增量 ${deltas} 次）`);
  for (const l of r1.log) log(`- ${l.roleName}：${l.status} ${l.summary ?? ''}`);
  log('\n```\n' + toOutlineText(a.root) + '\n```');

  // 2) 细化：只扩展第一个章节
  const target = a.root.children?.[0] ?? a.root;
  const other = JSON.stringify((a.root.children ?? []).slice(1));
  const t1 = Date.now();
  const r2 = await runStage({ artifact: a, manifest: m, stageIndex: 1, op: 'expand', targetId: target.id, providers: { text }, disabledSteps: ['planner'] });
  a = commitVersion(a, r2.version);
  log(`\n## 2. 细化 · 扩展「${target.title}」（${((Date.now() - t1) / 1000).toFixed(0)}s）`);
  for (const l of r2.log) log(`- ${l.roleName}：${l.status} ${l.summary ?? ''}`);
  log(`- 目标子项数：${target.children?.length ?? 0} → ${findNode(a.root, target.id)?.children?.length ?? 0}`);
  log(`- 目标以外的章节保持不变：${JSON.stringify((a.root.children ?? []).slice(1)) === other ? '✓ 是' : '✗ 否'}`);

  // 3) YAML：生成 + 选区调整
  const y = reg.get('yaml')!;
  let ya = createArtifact(y, 'docker-compose：nginx + postgres');
  const r3 = await runStage({ artifact: ya, manifest: y, stageIndex: 0, op: 'generate', providers: { text }, disabledSteps: ['critic'] });
  ya = commitVersion(ya, r3.version);
  log(`\n## 3. YAML · 生成\n\n\`\`\`yaml\n${ya.root.content}\n\`\`\``);
  const content = ya.root.content ?? '';
  const line = content.split('\n').find((l) => /image:/.test(l)) ?? content.split('\n')[0];
  const from = content.indexOf(line);
  const r4 = await runStage({ artifact: ya, manifest: y, stageIndex: 2, op: 'patch', selection: { from, to: from + line.length, text: line }, instruction: '把镜像升级为 1.25 版本', providers: { text } });
  const before = content.slice(0, from), after = content.slice(from + line.length);
  const nc = r4.root.content ?? '';
  log(`\n## 4. YAML · 调整选区「${line.trim()}」`);
  log(`- 新选区内容：\`${nc.slice(before.length, nc.length - after.length).trim()}\``);
  if (r4.warnings.length) log(`- 约束守卫：${r4.warnings.join('；')}`);
  log(`- 选区外逐字不变：${nc.startsWith(before) && nc.endsWith(after) ? '✓ 是' : '✗ 否'}`);
  writeFileSync(join(__dirname, '..', 'docs', '真实模型测试记录.md'), out.join('\n'));
  log('\nDONE');
}
main().catch((e) => { log('FAILED: ' + (e?.stack ?? e)); writeFileSync(join(__dirname, '..', 'docs', '真实模型测试记录.md'), out.join('\n')); process.exit(1); });
