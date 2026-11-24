import { describe, it, expect } from 'vitest';
import { recoveryNotices, hasPendingCheckpoint, normalizeNode, createArtifact, commitManual, buildSchedule, TypeRegistry } from '../src/core';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const M = { ...reg.get('outline')!, stages: buildSchedule(['整体框架', '逐项展开']) };

describe('v2.11 恢复与部分完成的中文说明', () => {
  it('加载警告变成 warn 通知', () => {
    const n = recoveryNotices({ loadWarnings: ['「a.json」已从未写完的临时文件恢复'] });
    expect(n[0].kind).toBe('warn');
    expect(n[0].text).toContain('临时文件');
  });
  it('未提交检查点给出可应用的说明', () => {
    const root = normalizeNode({ title: '计划', children: [{ title: 'A' }] });
    const a = commitManual(createArtifact(M, '计划'), root, '初稿', M.stages[0].id, { pin: false });
    const next = normalizeNode({ title: '计划', children: [{ title: 'A·细化' }] });
    const pending = { ...a, runJournal: { artifactId: a.id, stageIndex: 1, op: 'expand', startedAt: 1, done: [{ id: 'x', title: 'A' }], root: next } };
    expect(hasPendingCheckpoint(pending)).toBe(true);
    const n = recoveryNotices({ artifact: pending });
    expect(n.some((x) => x.action === 'apply-journal' && /中断/.test(x.text))).toBe(true);
  });
  it('部分完成的运行有一句清楚的说明', () => {
    const n = recoveryNotices({ lastPartial: true, lastWarnings: ['已停止：已保留 2 处改动，未处理 3 处'] });
    expect(n.some((x) => x.kind === 'info' && /已保留 2 处/.test(x.text))).toBe(true);
  });
});
