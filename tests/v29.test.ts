import { describe, it, expect } from 'vitest';
import { normalizeNode, mergeTrees, mergeSummary } from '../src/core';

const tree = (o: any) => normalizeNode(o);

describe('v2.9 上游三方合并', () => {
  it('只改上游的部分被吸收，只改下游的部分保留，两边都改则保留己方并标记冲突', () => {
    const base = tree({ title: '计划', children: [
      { id: 'a', title: 'A', content: '旧A' },
      { id: 'b', title: 'B', content: '旧B' },
      { id: 'c', title: 'C', content: '旧C' },
    ] });
    const ours = tree({ title: '计划', children: [
      { id: 'a', title: 'A', content: '我改了A' },
      { id: 'b', title: 'B', content: '旧B' },
      { id: 'c', title: 'C', content: '我改了C' },
    ] });
    const theirs = tree({ title: '计划', children: [
      { id: 'a', title: 'A', content: '上游改了A' },
      { id: 'b', title: 'B', content: '上游改了B' },
      { id: 'c', title: 'C', content: '旧C' },
      { id: 'd', title: 'D', content: '上游新增' },
    ] });
    const r = mergeTrees(base, ours, theirs);
    const kids = Object.fromEntries(r.root.children!.map((c) => [c.id, c]));
    expect(kids.a.content).toBe('我改了A');
    expect(kids.a.conflict?.theirsContent).toBe('上游改了A');
    expect(kids.b.content).toBe('上游改了B');
    expect(kids.b.conflict).toBeUndefined();
    expect(kids.c.content).toBe('我改了C');
    expect(kids.c.conflict).toBeUndefined();
    expect(r.root.children!.some((c) => c.title === 'D')).toBe(true);
    expect(r.conflicts).toHaveLength(1);
    expect(r.takenTheirs).toBeGreaterThanOrEqual(1);
    expect(mergeSummary(r)).toMatch(/冲突|吸收|新增/);
  });

  it('下游删掉的上游旧节点不会被恢复', () => {
    const base = tree({ title: '计划', children: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] });
    const ours = tree({ title: '计划', children: [{ id: 'a', title: 'A' }] });
    const theirs = tree({ title: '计划', children: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] });
    const r = mergeTrees(base, ours, theirs);
    expect(r.root.children!.map((c) => c.title)).toEqual(['A']);
  });
});
