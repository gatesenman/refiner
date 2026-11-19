import { GrainRow } from '../views/V18';
import { maturityMap, LEVEL_LABEL } from '../../core';
import { Icon } from '../icons/Icon';
import { useState } from 'react';
import { useStore } from '../store';
import {
  freedomFacets, effectiveFreedom, OP_DESC, SCOPE_LABEL, STRICT_LABEL, findNode, updateNode, removeNode, stagePipeline, resolveRoles,
} from '../../core';
import { opLabel, whenText } from '../terms';
import { splitDetail } from '../../core';

export function FreedomRing({ score, size = 70 }: { score: number; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const color = score >= 60 ? 'var(--f-hi)' : score >= 35 ? 'var(--f-mid)' : 'var(--f-lo)';
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fontSize={size / 4} fontWeight={700} fill="var(--text)">{score}</text>
      <text x="50%" y="70%" textAnchor="middle" fontSize={9.5} fill="var(--text3)">自由度</text>
    </svg>
  );
}


export function ErrBox({ msg, detail }: { msg: string; detail?: string }) {
  const [open, setOpen] = useState(false);
  const d = detail ?? splitDetail(msg).detail;
  return (
    <div className="errbox" style={{ marginTop: 8 }}>
      <div>{splitDetail(msg).message}</div>
      {d && <div style={{ marginTop: 4 }}><span className="link" onClick={() => setOpen(!open)}>{open ? '收起详情' : '详情'}</span>{open && <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 11 }}>{d}</pre>}</div>}
    </div>
  );
}

function StagePanel() {
  const s = useStore();
  const a = s.currentArtifact!;
  const m = s.currentManifest!;
  const stage = m.stages[a.stageIndex] ?? m.stages[0];
  const ef = effectiveFreedom(m.stages, Math.min(a.stageIndex, m.stages.length - 1));
  const f = freedomFacets(ef);
  const running = s.run.running;
  const roles = resolveRoles(m);
  const pipe = stagePipeline(m, a.stageIndex);
  const key = `${m.id}:${stage.id}`;
  const disabled = s.disabledSteps[key] ?? [];
  const failure = s.run.artifactId === a.id && !running ? s.run.failure : undefined;
  const liveOk = s.run.artifactId === a.id && (s.run.lastOp?.stageIndex ?? -1) === a.stageIndex;
  return (
    <>
      <div className="sec">
        <div className="sec-h"><span>检查点「{stage.name}」的自由度</span></div>
        <div className="hint" style={{ marginBottom: 8 }}>{stage.description} · 可用算子：{ef.ops.map((o) => OP_DESC[o] ? opLabel(o, true) : o).join(' / ')}</div>
        <div className="gauge">
          <FreedomRing score={f.score} />
          <div>
            {([['温度', f.temperature, ef.temperature.toFixed(1)], ['作用域', f.scope, ef.scope.map((x) => SCOPE_LABEL[x]).join('/')], ['算子', f.ops, String(ef.ops.length)], ['约束', 1 - f.constraint, STRICT_LABEL[ef.strictness]]] as [string, number, string][]).map(([k, v, t]) => (
              <div key={k} className="facet" title={t}><span>{k}</span><div className="fbar"><i style={{ width: `${Math.round(v * 100)}%`, background: k === '约束' ? 'var(--f-lo)' : undefined }} /></div><span className="muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span></div>
            ))}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 4, marginTop: 8 }}>
          <span className="chip">{STRICT_LABEL[ef.strictness]}</span>
          {ef.maxNewNodes != null && <span className="chip">新增 ≤ {ef.maxNewNodes}</span>}
          {ef.requireTarget && <span className="chip">须选中目标</span>}
          {ef.lockedProps?.map((p) => <span key={p} className="chip"><Icon name="ri-lock-line" /> {m.nodeSchema?.props?.find((x) => x.key === p)?.label ?? p}</span>)}
          {ef.frozen && <span className="chip">内容冻结</span>}
        </div>
        {failure && failure.kind === 'error' && <ErrBox msg={failure.message} detail={failure.detail} />}
      </div>

      <div className="sec">
        <div className="sec-h"><span>多智能体流水线（本阶段）</span><span className="muted">{pipe.steps.length - disabled.length}/{pipe.steps.length} 启用</span></div>
        {pipe.steps.map((st, i) => {
          const r = roles[st.role];
          const off = disabled.includes(st.id) || st.enabled === false;
          const live = liveOk ? s.run.log.filter((l) => l.stepId === st.id).pop() : undefined;
          return (
            <div key={st.id}>
              {i > 0 && <div className="arrow"><Icon name="ri-arrow-down-line" /></div>}
              <div className={`agent ${off ? 'off' : ''}`} title={r?.description}>
                <span className="ico"><Icon name={r?.icon} fallback="ri-robot-2-line" /></span>
                <span className="nm">{st.name ?? r?.name ?? st.role}{st.when && <span className="chip" style={{ marginLeft: 6, fontSize: 10.5 }} title={whenText(st.when)}>若 {st.when}</span>}{st.loop && <span className="chip" style={{ marginLeft: 4, fontSize: 10.5 }} title={`回到 ${st.loop.with} 复评，直到 ${st.loop.until ?? '达标'}；无提升或到达上限即停`}><Icon name="ri-repeat-line" /> ≤{st.loop.maxRounds ?? 2}轮</span>}</span>
                {live && <span className={`st ${live.status}`} style={{ fontSize: 10.5, padding: '0 5px', borderRadius: 4 }}>{({ running: '运行', done: live.score != null ? live.score + '分' : '完成', skipped: '跳过', error: '错误' } as Record<string, string>)[live.status]}</span>}
                <button className={`switch ${off ? '' : 'on'}`} disabled={running} onClick={() => s.toggleStep(key, st.id)} title={off ? '启用' : '关闭'} />
              </div>
            </div>
          );
        })}
        <div className="arrow"><Icon name="ri-arrow-down-line" /></div>
        <div className="agent"><span className="ico"><Icon name="ri-shield-check-line" /></span><span className="nm">约束守卫 <span className="muted" style={{ fontSize: 11 }}>（程序化，始终启用）</span></span></div>
      </div>
    </>
  );
}

export function Inspector({ floating }: { floating?: boolean } = {}) {
  const s = useStore();
  const a = s.currentArtifact!;
  const m = s.currentManifest!;
  if (m.output === 'text') return null;
  const n = s.selectedId ? findNode(a.root, s.selectedId) : null;
  if (!n) return floating ? null : (
    <div className="sec"><div className="sec-h"><span>选中部分</span></div><div className="hint">点选内容里的任意一项，可以在这里编辑它；底部操作栏会改为只修改这一项。双击可重命名。</div></div>
  );
  const set = (patch: Record<string, unknown>, label = '编辑属性') => s.manualEdit(updateNode(a.root, n.id, patch), label);
  return (
    <div className="sec inspector">
      <div className="sec-h"><span title={n.title}>{floating ? `${s.multiSel.length >= 2 ? `已选 ${s.multiSel.length} 处 · 当前` : '选中'}：「${n.title.slice(0, 14)}${n.title.length > 14 ? '…' : ''}」` : '选中部分'}</span><span className="row" style={{ gap: 2 }}>
        {n.pinned?.length ? <button className="icon-btn" title={`取消固定（手动编辑过：${n.pinned.join(', ')}）`} onClick={() => s.unpinNode(n.id)}><Icon name="ri-pushpin-2-fill" /></button> : null}
        <button className="icon-btn" title={n.locked ? '解锁' : '锁定'} onClick={() => set({ locked: !n.locked }, n.locked ? '解锁' : '锁定')}><Icon name={n.locked ? 'ri-lock-unlock-line' : 'ri-lock-line'} /></button>
        {n.id !== a.root.id && <button className="icon-btn" title="删除" onClick={() => { s.manualEdit(removeNode(a.root, n.id), '删除节点'); s.setSelectedId(undefined); s.toast('已删除，按 Ctrl+Z 可撤销', 'info', { label: '撤销', fn: () => s.undo() }); }}><Icon name="ri-delete-bin-6-line" /></button>}
        {floating && <button className="icon-btn" title="取消选中" onClick={() => s.setSelectedId(undefined)}><Icon name="ri-close-line" /></button>}
      </span></div>
      {n.id !== a.root.id && (() => { const mm = maturityMap(a.root, m).get(n.id); return mm ? <div className={`mat-line mat-${mm.level}`}><span className={`mat mat-${mm.level}`} />{LEVEL_LABEL[mm.level]}{mm.reasons.length ? `：${mm.reasons.join('；')}` : '：说明具体、属性齐全'}</div> : null; })()}
      {n.id !== a.root.id && <GrainRow n={n} />}
      {n.pinned?.length ? <div className="hint" style={{ marginBottom: 8 }}><Icon name="ri-pushpin-2-fill" className="mark pin" /> 已保护（你改过的）：{n.pinned.map((x) => x === 'title' ? '标题' : x === 'content' ? '内容' : m.nodeSchema?.props?.find((p) => 'props.' + p.key === x)?.label ?? x).join('、')}——之后 AI 不会改动。点右上角图钉可取消保护。</div> : null}
      <div className="field"><label>标题</label><input key={n.id + 't'} className="input" defaultValue={n.title} onBlur={(e) => e.target.value !== n.title && set({ title: e.target.value }, '编辑标题')} /></div>
      <div className="field"><label>内容 / 说明</label><textarea key={n.id + 'c' + (n.content ?? '').length} className="textarea" rows={3} defaultValue={n.content ?? ''} onBlur={(e) => e.target.value !== (n.content ?? '') && set({ content: e.target.value }, '编辑内容')} /></div>
      {(m.nodeSchema?.props ?? []).filter((p) => p.type !== 'url').map((p) => {
        const v = n.props?.[p.key];
        const setP = (val: unknown) => { const props = { ...(n.props ?? {}) }; if (val === undefined || val === '') delete props[p.key]; else props[p.key] = val; const inf = n.inferred?.filter((k) => k !== p.key); set({ props, inferred: inf?.length ? inf : undefined }); };
        const inf = n.inferred?.includes(p.key);
        return (
          <div className="field" key={p.key}>
            <label>{p.label}{inf && <span className="inf" title="从说明文字里推断的，改一下就变成你确认的值">推断</span>}{s.settings.expert && <span className="muted mono" style={{ fontSize: 10.5 }}> {p.key}</span>}</label>
            {p.type === 'enum' ? (
              <select className="select" value={v == null ? '' : String(v)} onChange={(e) => setP(e.target.value)}>
                <option value="">—</option>{p.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : p.type === 'text' ? (
              <textarea key={n.id + p.key + String(v ?? '').length} className="textarea" rows={2} defaultValue={v == null ? '' : String(v)} onBlur={(e) => e.target.value !== String(v ?? '') && setP(e.target.value)} />
            ) : (
              <input key={n.id + p.key + String(v ?? '')} className="input" type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'} defaultValue={v == null ? '' : String(v)}
                onBlur={(e) => { const nv = p.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value; if (String(nv ?? '') !== String(v ?? '')) setP(nv); }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RightPanel() {
  return (
    <aside className="right">
      <div className="right-scroll">
        <StagePanel />
        <Inspector />
      </div>
    </aside>
  );
}
