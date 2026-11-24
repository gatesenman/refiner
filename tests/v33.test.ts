import { describe, it, expect } from 'vitest';
import { buildSchedule, effectiveFreedom, freedomTightened, freedomRuntimeNote, freedomScore } from '../src/core';
import type { StageDef } from '../src/core';

describe('v2.13 运行时有效自由度收紧', () => {
  it('后一阶段即使声明更高温度/更强算子，effectiveFreedom 也不会放宽', () => {
    const stages: StageDef[] = [
      { id: 's0', name: '铺开', description: '', freedom: { temperature: 0.4, scope: ['subtree'], ops: ['expand', 'detail'], strictness: 'schema', maxNewNodes: 8 } },
      { id: 's1', name: '放宽？', description: '', freedom: { temperature: 1.2, scope: ['artifact'], ops: ['generate', 'expand'], strictness: 'loose', maxNewNodes: 60 } },
    ];
    const eff = effectiveFreedom(stages, 1);
    expect(eff.temperature).toBeLessThanOrEqual(0.4);
    expect(eff.ops.includes('generate')).toBe(false);
    expect(eff.scope.includes('artifact')).toBe(false);
    expect(eff.strictness).toBe('schema');
    expect(eff.maxNewNodes).toBe(8);
    expect(freedomScore(eff)).toBeLessThanOrEqual(freedomScore(stages[0].freedom));
    const why = freedomTightened(stages, 1);
    expect(why.some((w) => /温度/.test(w))).toBe(true);
    expect(why.some((w) => /算子/.test(w))).toBe(true);
    expect(freedomRuntimeNote(stages, 1)).toMatch(/收紧/);
  });
  it('阶段自身已经是最严时，说明是按本阶段声明执行', () => {
    const stages = buildSchedule(['整体框架', '逐项展开', '核对定稿']);
    const last = stages.length - 1;
    expect(freedomTightened(stages, last).length).toBe(0);
    expect(freedomRuntimeNote(stages, last)).toMatch(/本阶段声明/);
  });
});
