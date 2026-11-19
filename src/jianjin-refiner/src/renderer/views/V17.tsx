import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons/Icon';
import { readiness, roughest, roughCount, effectiveFreedom, LEVEL_LABEL } from '../../core';
import type { OpKind } from '../../core';
import { handoff, handoffCsv, handoffIcs, stepInfo } from '../flow';

/** 细化用的操作：优先“细化”，其次“展开”，再其次本步第一个非生成操作 */
export function refineOp(ops: OpKind[]): OpKind | undefined {
  return (['detail', 'expand', 'rewrite', 'patch', 'restructure'] as OpKind[]).find((o) => ops.includes(o)) ?? ops.find((o) => o !== 'generate');
}

/** 作品标题旁的就绪度：自由度在内容上的总读数 */
export function ReadyChip() {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const r = useMemo(() => readiness(a.root, m), [a.root, m]);
  if (m.output !== 'tree' || !r.items) return null;
  const miss = Object.entries(r.missing).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${v} 项缺${k}`).join('、');
  const tip = `就绪度 ${r.percent}%：${r.items} 项中 ${r.detailed} 项已具体、${r.medium} 项基本清楚、${r.rough} 项还比较粗${r.open ? `；${r.open} 个待澄清问题` : ''}${r.vague ? `；${r.vague} 项含“待定/？”` : ''}${miss ? `；${miss}` : ''}。\n粗 = 还有自由度（没想清楚），细 = 已收敛（可以执行）。最后一步的目标是 90% 以上。`;
  const lv = r.percent >= 85 ? 'detailed' : r.percent >= 45 ? 'medium' : 'rough';
  return (
    <span className={`ready-chip ${lv}`} title={tip} data-ready={r.percent}>
      <span className="rbar"><i style={{ width: `${r.percent}%` }} /></span>就绪 {r.percent}%
    </span>
  );
}

/** 每步完成后：“还有 7 处比较粗 · 接着细化最粗的 3 处 →”（一键多选并以本步操作运行） */
export function RoughStrip() {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const info = stepInfo(a, m);
  const running = s.run.running && s.run.artifactId === a.id;
  const list = useMemo(() => (m.output === 'tree' ? roughest(a.root, m, 3) : []), [a.root, m]);
  const count = useMemo(() => (m.output === 'tree' ? roughCount(a.root, m) : 0), [a.root, m]);
  const ef = effectiveFreedom(m.stages, info.index);
  const op = refineOp(ef.ops);
  if (m.output !== 'tree' || running || info.isEmpty || info.frozen || !list.length || a.asks?.length || a.finishedAt) return null;
  const canRun = !!op && (ef.scope.includes('subtree') || ef.scope.includes('node'));
  const go = () => { s.setHlIds([]); s.runOp({ op: op!, targetIds: list.map((x) => x.id) }); };
  return (
    <div className="rough-strip" onMouseEnter={() => s.setHlIds(list.map((x) => x.id))} onMouseLeave={() => s.setHlIds([])}>
      <span className="mat mat-rough" />
      <span><b>还有 {count} 处比较粗</b><span className="muted">（粗 = 还没想清楚的地方）</span></span>
      <span className="rs-list">
        {list.map((x) => (
          <span key={x.id} className={`rs-item mat-${x.level}`} title={`${LEVEL_LABEL[x.level]}：${x.why}`} onClick={() => { s.setSelectedId(x.id); document.querySelector(`[data-node-id="${x.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}>{x.title.slice(0, 14)}</span>
        ))}
      </span>
      <span className="spacer" />
      {canRun
        ? <button className="btn sm accent-outline" onClick={go} title={`以本步的「${op}」操作，依次细化这 ${list.length} 处（合成一个版本，可一键撤销）`}>接着细化最粗的 {list.length} 处<Icon name="ri-arrow-right-line" className="after" /></button>
        : <span className="hint">下一步可以逐项细化</span>}
    </div>
  );
}

/** 步骤间追问：评审发现缺少只有你知道的事实 → 先问再做；回答成为固定事实 */
export function AskCard() {
  const s = useStore();
  const a = s.currentArtifact!;
  const [txt, setTxt] = useState<Record<string, string>>({});
  const running = s.run.running && s.run.artifactId === a.id;
  // v1.9：窗口矮时默认收成一行，不挤占内容区（点“回答”展开）
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerHeight >= 760);
  if (!a.asks?.length || running) return null;
  if (!open) return (
    <div className="ask-card ask-mini" role="group" aria-label="AI 想先确认的事">
      <Icon name="ri-question-answer-line" /><b>AI 想先确认 {a.asks.length} 件事</b><span className="ask-first">{a.asks[0].q}</span>
      <span className="spacer" /><button className="btn sm primary" onClick={() => setOpen(true)}>回答</button><button className="btn sm ghost" onClick={s.dismissAsks}>先不管</button>
    </div>
  );
  return (
    <div className="ask-card" role="group" aria-label="AI 想先确认的事">
      <div className="ask-h"><Icon name="ri-question-answer-line" /><b>AI 想先确认 {a.asks.length} 件事</b><span className="muted">回答会作为固定事实，后面每一步都会遵守，不再猜</span><span className="spacer" /><button className="btn sm ghost" title="收起" onClick={() => setOpen(false)}><Icon name="ri-arrow-down-s-line" /></button><button className="btn sm ghost" onClick={s.dismissAsks}>先不管</button></div>
      {a.asks.map((q) => (
        <div key={q.id} className="ask-q">
          <div className="ask-t">{q.q}{q.from && <span className="muted">（第「{q.from}」步检查时发现）</span>}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {(q.options ?? []).map((o) => <button key={o} className="btn sm opt" onClick={() => s.answerAsk(q.id, o)}>{o}</button>)}
            <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder={q.options?.length ? '或者自己填…' : '在这里回答，Enter 确定'} value={txt[q.id] ?? ''} onChange={(e) => setTxt({ ...txt, [q.id]: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && txt[q.id]?.trim()) s.answerAsk(q.id, txt[q.id]); }} />
            <button className="btn sm" disabled={!txt[q.id]?.trim()} onClick={() => s.answerAsk(q.id, txt[q.id])}>确定</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 派生来源：头部“来自：X”；上游改了时提示更新 */
export function SourceLink() {
  const s = useStore();
  const a = s.currentArtifact!;
  if (!a.source) return null;
  return <span className="src-link" title="这个作品是以它为基础新建的，点击回到它" onClick={s.openSource}><Icon name="ri-git-merge-line" />来自：{a.source.title.slice(0, 16)}</span>;
}
export function SourceBanner() {
  const s = useStore();
  const a = s.currentArtifact!;
  if (!a.source) return null;
  const up = s.projects.find((p) => p.id === a.source!.projectId)?.artifacts.find((x) => x.id === a.source!.artifactId);
  if (!up || up.head === a.source.versionId || up.head === a.source.dismissed) return null;
  const n = up.versions.length - Math.max(0, up.versions.findIndex((v) => v.id === a.source!.versionId)) - 1;
  return (
    <div className="banner info">
      <Icon name="ri-refresh-line" />
      <span style={{ flex: 1 }}>上游「{up.title}」在你新建这个作品之后有更新{n > 0 ? `（${n} 次修改）` : ''}。要用它的最新内容作为参考吗？已经生成的内容不会被自动改动。</span>
      <button className="btn sm" onClick={s.refreshFromSource}>更新参考资料</button>
      <button className="btn sm ghost" onClick={s.openSource}>去看看</button>
      <button className="icon-btn" title="忽略这次更新" onClick={s.dismissSource}><Icon name="ri-close-line" /></button>
    </div>
  );
}

export const DERIVE_KINDS = [
  { label: '功能清单', verb: '拆成功能清单', templateId: 'features', icon: 'ri-list-check-3' },
  { label: '任务', verb: '排成可分配的任务', templateId: 'tasks', icon: 'ri-task-line' },
  { label: '执行计划', verb: '做成带里程碑的执行计划', templateId: 'plan', icon: 'ri-calendar-check-line' },
];
export function deriveKinds(typeId: string) { return DERIVE_KINDS.filter((k) => k.templateId !== typeId); }

/** 完成卡的交接清单 */
export function Handoff() {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const h = useMemo(() => handoff(a, m), [a, m]);
  const r = useMemo(() => readiness(a.root, m), [a.root, m]);
  const [open, setOpen] = useState(true);
  if (m.output !== 'tree') return null;
  const go = (id: string) => { s.finishWork(false); setTimeout(() => { s.setSelectedId(id); document.querySelector(`[data-node-id="${id}"]`)?.scrollIntoView({ block: 'center' }); }, 60); };
  const save = async (kind: 'csv' | 'ics') => {
    const p = await window.api.saveFile(`${a.title.slice(0, 40)}-待办.${kind}`, kind === 'csv' ? handoffCsv(a, m) : handoffIcs(a, m));
    if (p) s.toast(`已导出到 ${p}`, 'success', { label: '打开文件夹', fn: () => window.api.showInFolder(p) });
  };
  const dated = h.actions.filter((x) => x.date).length;
  return (
    <div className="handoff">
      <div className="ho-h" onClick={() => setOpen(!open)}><Icon name="ri-clipboard-line" /><b>交接清单</b><span className="muted">就绪 {r.percent}% · {h.open.length} 项待定 · {h.missing.map((x) => `${x.items.length} 项缺${x.label}`).join(' · ') || '属性齐全'} · {h.actions.length} 个待办</span><span className="spacer" /><Icon name={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /></div>
      {open && (
        <div className="ho-body">
          <div className="ho-col">
            <div className="ho-t">还没定的（{h.open.length}）</div>
            {h.open.slice(0, 6).map((x) => <div key={x.id} className="ho-i link" onClick={() => go(x.id)}><span className="mat mat-rough" />{x.title.slice(0, 26)}<span className="muted">· {x.why}</span></div>)}
            {h.open.length > 6 && <div className="muted">…还有 {h.open.length - 6} 项</div>}
            {!h.open.length && <div className="muted">没有了</div>}
          </div>
          <div className="ho-col">
            <div className="ho-t">缺字段</div>
            {h.missing.map((x) => <div key={x.label} className="ho-i"><b>缺{x.label}</b> {x.items.length} 项：<span className="muted">{x.items.slice(0, 3).map((i) => i.title.slice(0, 10)).join('、')}{x.items.length > 3 ? '…' : ''}</span></div>)}
            {!h.missing.length && <div className="muted">负责人、日期都填好了</div>}
          </div>
          <div className="ho-col">
            <div className="ho-t">下一步行动（{h.actions.length}）</div>
            {h.actions.slice(0, 4).map((x) => <div key={x.id} className="ho-i">{x.title.slice(0, 22)}<span className="muted">{x.owner ? ` · ${x.owner}` : ''}{x.date ? ` · ${x.date}` : ''}</span></div>)}
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="btn sm" onClick={() => save('csv')}><Icon name="ri-file-excel-2-line" />导出为待办（CSV）</button>
              <button className="btn sm" disabled={!dated} title={dated ? `${dated} 项带日期` : '没有带日期的项'} onClick={() => save('ics')}><Icon name="ri-calendar-line" />导出到日历（ICS）</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** “以此为基础新建…” */
export function DeriveRow() {
  const s = useStore();
  const a = s.currentArtifact!;
  const ks = deriveKinds(a.typeId).filter((k) => s.registry.get(k.templateId));
  if (!ks.length) return null;
  return (
    <div className="derive-row">
      <span className="muted">以此为基础新建：</span>
      {ks.map((k) => <button key={k.templateId} className="btn sm" onClick={() => s.deriveFrom(k)}><Icon name={k.icon} />{k.verb.replace(/^(拆成|排成|做成)/, '$1')}</button>)}
      <span className="hint">全文会作为参考资料，新作品会记下“来自：{a.title.slice(0, 12)}”</span>
    </div>
  );
}
