/** v1.8：首次使用引导（借鉴 Gamma “先看计划再生成”、Notion AI 的就地提示——不弹全屏教程，只在真正用到的位置提示 3 条） */
import { useState } from 'react';
import { Icon } from '../icons/Icon';

export const COACH_KEY = 'refiner.coach.v18';
export const COACH_TIPS: { icon: string; title: string; body: string }[] = [
  { icon: 'ri-focus-3-line', title: '先粗后细', body: '每一步只把内容推进一层：先铺整体框架，再逐项展开，最后核对定稿。越往后 AI 改得越少、越谨慎。' },
  { icon: 'ri-cursor-line', title: '点哪改哪', body: '单击选中一项，AI 只改这一项；Ctrl+单击可以多选几处一起改；双击或 F2 自己动手改，改过的地方 AI 不会再动。' },
  { icon: 'ri-chat-quote-line', title: '每处改动都有理由', body: 'AI 改完先停下等你审阅：带「新」「改」的地方下方写着为什么改，可以逐条保留或撤回，也可以一键全部保留。' },
];
export function coachSeen(): boolean { try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return true; } }

export function Coach({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const t = COACH_TIPS[i];
  const close = () => { try { localStorage.setItem(COACH_KEY, '1'); } catch { /* ignore */ } onDone(); };
  return (
    <div className="coach" role="dialog" aria-label="使用提示">
      <div className="coach-ic"><Icon name={t.icon} /></div>
      <div className="coach-b">
        <div className="coach-h"><b>{t.title}</b><span className="muted">{i + 1}/{COACH_TIPS.length}</span></div>
        <div className="coach-t">{t.body}</div>
      </div>
      <div className="coach-a">
        <button className="btn ghost sm" onClick={close}>不再提示</button>
        {i < COACH_TIPS.length - 1 ? <button className="btn sm primary" onClick={() => setI(i + 1)}>下一条<Icon name="ri-arrow-right-line" className="after" /></button>
          : <button className="btn sm primary" onClick={close}>知道了</button>}
      </div>
    </div>
  );
}

/** v1.9 检查器里的“粒度”：更粗 / 当前 / 更细（只作用于选中的一项） */
import { useStore } from '../store';
import { stepInfo, grainOps, COARSEN_INSTR, FINER_INSTR } from '../flow';
import type { ArtNode } from '../../core';
export function GrainRow({ n }: { n: ArtNode }) {
  const s = useStore();
  const a = s.currentArtifact!; const m = s.currentManifest!;
  const info = stepInfo(a, m);
  const g = grainOps(info.ops);
  const busy = s.run.running || info.frozen || n.locked;
  const go = (op: NonNullable<typeof g.finer>, instruction: string) => s.runOp({ op, instruction, targetId: n.id });
  const kids = n.children?.length ?? 0;
  return (
    <div className="grain-row" title="只调整这一项的粗细，其他部分不动">
      <span className="muted">粒度</span>
      <button className="btn sm" disabled={busy || !g.coarser || kids < 2} title={!g.coarser ? '这一步不允许改结构' : kids < 2 ? '子项太少，无需收拢' : '合并相近子项、去掉枝节'} onClick={() => go(g.coarser!, COARSEN_INSTR)}><Icon name="ri-contract-left-right-line" />更粗</button>
      <span className="grain-now">{kids ? `${kids} 个子项` : "无子项"}</span>
      <button className="btn sm" disabled={busy || !g.finer} title={!g.finer ? '这一步不再展开' : '再细一层：补子项与可执行细节'} onClick={() => go(g.finer!, FINER_INSTR)}>更细<Icon name="ri-expand-left-right-line" className="after" /></button>
    </div>
  );
}
