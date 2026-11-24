import { useRef, useState } from 'react';
import { effectiveFreedom, freedomScore, freedomRuntimeNote } from '../../core';
import type { StageDef } from '../../core';
import { Icon } from '../icons/Icon';

/**
 * 自由度轨道：产品的主轴。横轴 = 自由度（左 100 → 右 0），工作由左向右推进。
 * 检查点只是轴上的命名点；当前位置可拖动：向右 = 收紧（直接进入），向左 = 放宽（需确认，版本树标记）。
 * 版本按其所在检查点的有效自由度落在轴上，展示“工作走到了哪里”。
 */
export function FreedomTrack({ stages, current, versions = [], onPick, compact }: {
  stages: StageDef[]; current?: number; versions?: { stageIndex: number; head?: boolean }[]; onPick?: (i: number) => void; compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const scores = stages.map((_s, i) => freedomScore(effectiveFreedom(stages, i)));
  const x = (score: number) => `${(100 - score) * 0.92 + 4}%`;
  const nearest = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = 100 - (((clientX - r.left) / r.width) * 100 - 4) / 0.92;
    let best = 0;
    scores.forEach((sc, i) => { if (Math.abs(sc - f) < Math.abs(scores[best] - f)) best = i; });
    return { best, f: Math.max(0, Math.min(100, f)) };
  };
  const pos = drag != null ? drag : current != null ? scores[current] : null;
  const counts: Record<number, number> = {};
  return (
    <div className={`ftrack ${compact ? 'compact' : ''}`}>
      <div className="ftrack-ends"><span>自由度高 · 发散</span><span>收敛 · 自由度低</span></div>
      <div ref={ref} className={`ftrack-rail ${onPick ? 'draggable' : ''}`}
        onPointerDown={(e) => { if (!onPick) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(nearest(e.clientX).f); }}
        onPointerMove={(e) => { if (drag != null) setDrag(nearest(e.clientX).f); }}
        onPointerUp={(e) => { if (drag == null) return; const { best } = nearest(e.clientX); setDrag(null); if (best !== current) onPick?.(best); }}>
        <div className="ftrack-bar" />
        {current != null && <div className="ftrack-done" style={{ width: x(scores[current]) }} />}
        {versions.map((v, k) => {
          const c = (counts[v.stageIndex] = (counts[v.stageIndex] ?? 0) + 1);
          return <span key={k} className={`ftrack-ver ${v.head ? 'head' : ''}`} style={{ left: `calc(${x(scores[v.stageIndex] ?? 0)} + ${((c - 1) % 6) * 5 - 12}px)`, top: -6 - Math.floor((c - 1) / 6) * 5 }} title="版本" />;
        })}
        {stages.map((st, i) => (
          <div key={st.id} className={`ftrack-cp ${i === current ? 'on' : ''} ${current != null && i < current ? 'past' : ''}`} style={{ left: x(scores[i]) }} onClick={(e) => { e.stopPropagation(); }} title={`${st.name}：自由度 ${scores[i]}。${freedomRuntimeNote(stages, i)}`}>
            <span className="dot" />
            <span className="nm">{st.name}</span>
            <span className="sc">{scores[i]}</span>
          </div>
        ))}
        {pos != null && <div className={`ftrack-handle ${drag != null ? 'drag' : ''}`} style={{ left: x(pos) }}><Icon name="ri-focus-3-line" /></div>}
      </div>
      {!compact && current != null && <div className="ftrack-note muted" style={{ fontSize: 12, marginTop: 6 }}>{freedomRuntimeNote(stages, current)}</div>}
    </div>
  );
}
