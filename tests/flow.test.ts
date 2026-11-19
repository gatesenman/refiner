import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, createMockText, createMockMedia, createArtifact, runStage, commitVersion, pendingReview, buildSchedule, reattachIds } from '../src/core';
import type { Artifact, Providers, TypeManifest } from '../src/core';
import { barModel, changeStage, keepAndAdvance, skipStage, stepInfo, canAutoRun, targetLabel } from '../src/renderer/flow';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
// 4 步蓝图（与规划师生成的时间表一致）：第 3 步不能作用于全部、第 4 步必须先选中
const m4: TypeManifest = { ...outline, stages: buildSchedule(['整体构想', '日程骨架', '细节安排', '执行清单']) };
const demo: Providers = { text: createMockText(0), media: createMockMedia() };

async function generated(m: TypeManifest = m4): Promise<Artifact> {
  const a = createArtifact(m, '策划一场三天的团队建设');
  const r = await runStage({ artifact: a, manifest: m, stageIndex: 0, op: 'generate', providers: demo });
  return commitVersion(a, r.version);
}

describe('v1.5 引导式流程：选中重置', () => {
  it('切换步骤总是清除选中，并退出完成状态', async () => {
    const a = { ...(await generated()), finishedAt: 1 };
    const r = changeStage(a, 2);
    expect(r.selectedId).toBeUndefined();
    expect(r.artifact.stageIndex).toBe(2);
    expect(r.artifact.finishedAt).toBeUndefined();
  });
  it('“全部保留，进入下一步”同样清除选中', async () => {
    const r = keepAndAdvance(await generated(), m4);
    expect(r.selectedId).toBeUndefined();
  });
});

describe('v1.5 审阅与下一步合并为一个主按钮', () => {
  it('有未审阅改动时：主按钮 = 全部保留，进入下一步：X；点一次 = 保留 + 进入下一步 + 自动运行', async () => {
    const a = await generated();
    expect(pendingReview(a)).toBeTruthy();
    const bm = barModel({ a, m: m4, op: 'generate', running: false, failed: false });
    expect(bm.mode).toBe('review');
    expect(bm.primary).toMatchObject({ label: '全部保留，进入下一步：日程骨架', action: 'keepNext' });
    const r = keepAndAdvance(a, m4);
    expect(pendingReview(r.artifact)).toBeUndefined(); // 已保留
    expect(r.artifact.stageIndex).toBe(1);
    expect(r.nextIndex).toBe(1);
    expect(r.autoRun).toBe(false); // v1.6：默认停在准备态，不自动运行
  });
  it('下一步要求先点选时不自动运行；最后一步变为“完成”并进入完成状态', async () => {
    expect(canAutoRun(m4, 2)).toBe(false);
    expect(canAutoRun(m4, 3)).toBe(false);
    const g = await generated();
    // 模拟“最后一步刚运行完、尚未审阅”
    const a = { ...g, stageIndex: 3, versions: g.versions.map((v) => (v.id === g.head ? { ...v, stageId: m4.stages[3].id } : v)) };
    const bm = barModel({ a, m: m4, op: 'patch', running: false, failed: false });
    expect(bm.primary.label).toBe('全部保留，完成');
    const r = keepAndAdvance(a, m4, 1234);
    expect(r.finished).toBe(true);
    expect(r.artifact.finishedAt).toBe(1234);
    expect(barModel({ a: r.artifact, m: m4, op: 'patch', running: false, failed: false }).mode).toBe('finished');
  });
});

describe('v1.5 操作栏总是写明会改哪里', () => {
  it('未选中 / 选中 / 需要先选 / 运行中 / 失败', async () => {
    const base = keepAndAdvance(await generated(), m4).artifact; // 第 2 步，尚未运行
    const none = barModel({ a: base, m: m4, op: 'expand', running: false, failed: false });
    expect(none.target).toBe('将修改：全部');
    expect(none.primary.label).toBe('往下展开全部');
    const day = base.root.children![1];
    const sel = barModel({ a: base, m: m4, op: 'expand', running: false, failed: false, selectedId: day.id });
    expect(sel.target).toBe(`将修改：${targetLabel(base, m4, day.id)}`);
    expect(sel.primary.label).toBe(`往下展开「${day.title}」`);
    const s3 = { ...base, stageIndex: 2 };
    const need = barModel({ a: s3, m: m4, op: 'detail', running: false, failed: false });
    // v1.7：只允许局部的步骤，主按钮是“{操作}全部”（逐个部分处理），不再是蓝色的“跳过”
    expect(need.target).toBe('将修改：全部');
    expect(need.primary.action).toBe('runAll');
    expect(need.primary.label).toMatch(/全部$/);
    expect(need.primary.label).not.toContain('跳过');
    expect(barModel({ a: base, m: m4, op: 'expand', running: true, failed: false }).target).toBe('正在修改：全部');
    expect(barModel({ a: base, m: m4, op: 'expand', running: false, failed: true }).primary.action).toBe('retry');
  });
  it('跳过这一步：记录为已跳过并进入下一步', async () => {
    const a = keepAndAdvance(await generated(), m4).artifact;
    const b = skipStage(a, m4);
    expect(b.stageIndex).toBe(2);
    expect(b.skipped).toEqual([m4.stages[1].id]);
    expect(stepInfo(b, m4).stage.name).toBe('细节安排');
  });
});

describe('模型丢掉 id 时按同名沿用原 id', () => {
  it('reattachIds：同层同名子项沿用原 id，新内容保持新 id', () => {
    const old = { id: 'r', title: 'R', children: [{ id: 'a', title: '甲', children: [{ id: 'a1', title: '甲一' }] }, { id: 'b', title: '乙' }] };
    const d = reattachIds(old, { id: 'r', title: 'R', children: [{ id: 'x', title: '甲', children: [{ id: 'y', title: '甲一' }, { id: 'z', title: '甲二' }] }, { id: 'w', title: '丙' }] });
    expect(d.children!.map((c) => c.id)).toEqual(['a', 'w']);
    expect(d.children![0].children!.map((c) => c.id)).toEqual(['a1', 'z']);
  });
});
