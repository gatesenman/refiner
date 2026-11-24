import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEscClose } from '../esc';
import { EstimateText } from '../views/WorkExtras';
import { deriveKinds } from '../views/V17';
import { useStore } from '../store';
import { Icon } from '../icons/Icon';
import { barModel, stepInfo } from '../flow';
import { opLabel, roleLabel, SIMPLE_OP_DESC } from '../terms';
import { OP_DESC, headChanges, pendingReview } from '../../core';
import type { OpKind } from '../../core';

const PH: Partial<Record<OpKind, string>> = {
  generate: '补充要求（可选），例如“面向新手、控制在 5 个部分以内”',
  expand: '补充要求（可选），例如“增加落地案例”',
  restructure: '补充要求（可选），例如“按时间顺序排列”',
  detail: '补充要求（可选），例如“写清负责人和验收标准”',
  rewrite: '补充要求（可选），例如“更口语化”',
  patch: '要怎么改，例如：把预算改为 1.5 万',
};

/** 运行中的一行进度：AI 正在：检查（第 3/5 步，已用 8 秒） */
function RunLine() {
  const s = useStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const cur = s.run.log.filter((l) => l.status === 'running').pop();
  const doneN = new Set(s.run.log.filter((l) => l.status !== 'running').map((l) => l.stepId)).size;
  const total = Math.max(s.run.total ?? 0, doneN + (cur ? 1 : 0), 1);
  const idx = Math.min(total, doneN + 1);
  const secs = Math.round((now - (s.run.startedAt ?? now)) / 1000);
  const expert = s.settings.expert;
  const what = cur ? roleLabel(cur.role, cur.roleName, expert, cur.stepId) : '准备';
  const seen = s.run.log.filter((l, i, arr) => arr.findIndex((x) => x.stepId === l.stepId) === i && l.status !== 'skipped');
  return (
    <div className="ab-run">
      <Icon name="ri-loader-4-line" className="spin" />
      <b>AI 正在：{what}</b>
      {s.run.multi && <span className="chip multi-chip" title={`同时处理：${(s.run.multi.active ?? []).join('、')}`}>{(s.run.multi.par ?? 1) > 1 ? `并行 ${s.run.multi.par} 路 · 已完成 ${s.run.multi.done ?? 0}/${s.run.multi.n}` : `第 ${s.run.multi.i + 1}/${s.run.multi.n} 处：${s.run.multi.title.slice(0, 12)}`}</span>}
      <span className="muted">（第 {idx}/{total} 步，已用 {secs} 秒）</span>
      <span className="ab-roles">{seen.map((l) => <span key={l.stepId} className={l.status}>{roleLabel(l.role, l.roleName, expert, l.stepId).replace(/（第 \d+ 轮）/, '')}{l.status === 'done' && <Icon name="ri-check-line" />}</span>)}</span>
    </div>
  );
}

/** 固定在工作区底部的“下一步”操作栏：将修改什么 / 怎么改 / 唯一的主按钮。简单与专家模式共用 */
export function ActionBar({ onToggleLog, logOpen }: { onToggleLog: () => void; logOpen: boolean }) {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const expert = s.settings.expert;
  const info = stepInfo(a, m);
  const [op, setOp] = useState<OpKind>(info.ops[0]);
  const [instr, setInstr] = useState('');
  const [menu, setMenu] = useState(false);
  const [why, setWhy] = useState(false);
  const [ci, setCi] = useState(0);
  const [scope, setScope] = useState(false);
  useEscClose(menu, useCallback(() => setMenu(false), []));
  useEscClose(why, useCallback(() => setWhy(false), []));
  useEscClose(scope, useCallback(() => setScope(false), []));
  useEffect(() => {
    if (!scope) return;
    const h = () => setScope(false);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [scope]);
  useEffect(() => { setOp(info.ops[0]); setInstr(''); setMenu(false); setWhy(false); }, [info.stage.id, a.id]); // eslint-disable-line
  const running = s.run.running && s.run.artifactId === a.id;
  const failed = !running && s.run.artifactId === a.id && !!s.run.failure;
  const isText = m.output === 'text';
  const bm = barModel({ a, m, op, running, failed, expert, selectedId: isText ? undefined : s.selectedId, textSel: isText && !!s.textSel, multiIds: isText ? undefined : s.multiSel });
  const chg = useMemo(() => headChanges(a), [a]);
  const pend = pendingReview(a);
  const issues = pend?.version.summary?.issues ?? [];
  useEffect(() => { setCi(0); }, [pend?.version.id]);
  useEffect(() => {
    if (!menu) return;
    const h = () => setMenu(false);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [menu]);
  const runNow = (o: OpKind = op) => s.runOp({ op: o, instruction: instr.trim() || undefined, targetId: isText ? undefined : (s.selectedId && s.selectedId !== a.root.id ? s.selectedId : null) });
  const jump = (d: number) => {
    const els = [...document.querySelectorAll<HTMLElement>('.canvas .chg')];
    if (!els.length) return;
    const j = (ci + d + els.length) % els.length;
    setCi(j);
    els[j].scrollIntoView({ block: 'center', behavior: 'smooth' });
    els.forEach((e, k) => e.classList.toggle('chg-focus', k === j));
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (bm.mode === 'review' && (e.key === 'j' || e.key === 'k')) { e.preventDefault(); jump(e.key === 'j' ? 1 : -1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const doPrimary = () => {
    switch (bm.primary.action) {
      case 'run': return runNow();
      case 'runAll': return s.runOp({ op, instruction: instr.trim() || undefined, targetIds: (a.root.children ?? []).filter((c) => !c.locked).map((c) => c.id) });
      case 'runMulti': { const ids = [...s.multiSel]; s.clearMulti(); return s.runOp({ op, instruction: instr.trim() || undefined, targetIds: ids }); }
      case 'keepNext': return s.keepAndNext();
      case 'next': return info.done ? s.keepAndNext() : s.skipStep();
      case 'finish': return s.finishWork(true);
      case 'retry': s.dismissFailure(); return s.retryLast();
    }
  };
  const showInput = (bm.mode === 'ready' || bm.mode === 'done') && !info.frozen;
  const selName = !isText && s.selectedId && s.selectedId !== a.root.id;
  const again = (o: OpKind) => s.runOp({ op: o, instruction: instr.trim() || s.run.lastOp?.instruction, targetId: isText ? undefined : (selName ? s.selectedId : (pend?.version.targetId ?? null)) });
  const lastOp = (pend?.version.op as OpKind | undefined) ?? op;
  const canScope = !isText && (bm.mode === 'ready' || bm.mode === 'done') && !info.frozen && !info.isEmpty && !!a.root.children?.length;
  const prevV = pend && a.versions.find((v) => v.id === pend.version.parentId);
  return (
    <div className={`actionbar mode-${bm.mode}`}>
      {running ? (<>
        <RunLine />
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onToggleLog}><Icon name="ri-robot-2-line" />{logOpen ? '收起过程' : 'AI 过程'}</button>
        <button className="btn lg danger-solid ab-primary" onClick={s.cancelRun}><Icon name="ri-stop-fill" />停止<span className="kbd">Esc</span></button>
      </>) : (<>
        <div className="ab-left">
          {bm.mode === 'review' ? (
            <div className="ab-review">
              <Icon name="ri-sparkling-2-line" className="ok-ic" />
              <span className="ab-t">{bm.target}</span>
              {!!bm.changes && bm.changes > 1 && <span className="ab-nav"><button className="icon-btn" title="上一处（K）" aria-label="上一处（K）" onClick={() => jump(-1)}><Icon name="ri-arrow-left-s-line" /></button>{ci + 1}/{bm.changes}<button className="icon-btn" title="下一处（J）" aria-label="下一处（J）" onClick={() => jump(1)}><Icon name="ri-arrow-right-s-line" /></button></span>}
              {!!issues.length && <button className="btn ghost sm link-btn" onClick={(e) => { e.stopPropagation(); setWhy(!why); }}><Icon name="ri-chat-quote-line" />为什么这样改？</button>}
              {why && <div className="ab-pop" onClick={(e) => e.stopPropagation()}><b>AI 检查时发现：</b><ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul><div className="hint">所以做了这些修改。改动处带「新」「改」标记，悬停可看改前内容。</div></div>}
            </div>
          ) : (
            <div className="ab-target">
              {canScope ? (
                <span className="ab-scope">
                  <button className={`ab-t scope-btn ${selName ? 'set' : ''}`} title="选择要修改的范围（也可以直接在内容里点选）" onClick={(e) => { e.stopPropagation(); setScope(!scope); }}><Icon name="ri-focus-3-line" />{bm.target}<Icon name="ri-arrow-down-s-line" className="after" /></button>
                  {scope && (
                    <div className="menu up scope-menu" onClick={(e) => e.stopPropagation()}>
                      <div className="menu-h muted">这一步要修改：</div>
                      <div className={`menu-item ${!selName ? 'on' : ''}`} onClick={() => { setScope(false); s.setSelectedId(undefined); }}><Icon name={!selName ? 'ri-radio-button-line' : 'ri-checkbox-blank-circle-line'} />全部</div>
                      {(a.root.children ?? []).slice(0, 14).map((c) => (
                        <div key={c.id} className={`menu-item ${s.selectedId === c.id ? 'on' : ''}`} onClick={() => { setScope(false); s.setSelectedId(c.id); setTimeout(() => document.querySelector(`[data-node-id="${c.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30); }}>
                          <Icon name={s.selectedId === c.id ? 'ri-radio-button-line' : 'ri-checkbox-blank-circle-line'} />只改「{c.title.slice(0, 22)}」
                        </div>
                      ))}
                      <div className="menu-sep" />
                      <div className="menu-h muted">也可以在内容里直接点选任意一项</div>
                    </div>
                  )}
                </span>
              ) : <span className={`ab-t ${selName ? 'set' : ''}`}><Icon name={bm.mode === 'finished' ? 'ri-checkbox-circle-fill' : bm.mode === 'failed' ? 'ri-error-warning-line' : 'ri-focus-3-line'} />{bm.target}</span>}
              {s.multiSel.length >= 2 && <button className="icon-btn" title="清除多选" aria-label="清除多选" onClick={() => s.clearMulti()}><Icon name="ri-close-line" /></button>}
              {selName && s.multiSel.length < 2 && <button className="icon-btn" title="取消选中（改为全部）" aria-label="取消选中（改为全部）" onClick={() => s.setSelectedId(undefined)}><Icon name="ri-close-line" /></button>}
              {bm.hint && (!selName || s.multiSel.length >= 2) && <span className="hint ab-hint">{bm.hint}</span>}
            </div>
          )}
          {showInput && (
            <div className="ab-how">
              {info.ops.length > 1 && op !== 'generate' && (
                <select className="select ab-op" value={op} title={expert ? OP_DESC[op] : SIMPLE_OP_DESC[op]} onChange={(e) => setOp(e.target.value as OpKind)}>
                  {info.ops.map((o) => <option key={o} value={o}>{opLabel(o, expert)}</option>)}
                </select>
              )}
              <input className="input ab-instr" value={instr} placeholder={PH[op] ?? '补充要求（可选）'} onChange={(e) => setInstr(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (bm.primary.action === 'run' || bm.primary.action === 'runAll' || bm.primary.action === 'runMulti') && !bm.primary.disabled) doPrimary(); }} />
            </div>
          )}
        </div>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onToggleLog} title="AI 每一步做了什么"><Icon name="ri-robot-2-line" />{logOpen ? '收起过程' : 'AI 过程'}</button>
        {bm.mode !== 'finished' && (
          <div style={{ position: 'relative' }}>
            <button className="btn" onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>{bm.mode === 'review' || bm.mode === 'done' ? '再来一次' : '更多'}<Icon name="ri-arrow-up-s-line" className="after" /></button>
            {menu && (
              <div className="menu up" onClick={(e) => e.stopPropagation()}>
                {(bm.mode === 'review' || bm.mode === 'done') && <div className="menu-item" onClick={() => { setMenu(false); again(lastOp); }}><Icon name="ri-refresh-line" />再来一次{lastOp === 'generate' ? '（替换全部）' : `（${opLabel(lastOp, expert)}）`}</div>}
                {bm.mode === 'review' && prevV && m.output === 'tree' && <div className="menu-item" onClick={() => { setMenu(false); s.setCompare({ a: prevV.id, b: pend!.version.id }); }}><Icon name="ri-layout-column-line" />与上一版并排对比</div>}
                {bm.mode === 'review' && <div className="menu-item" onClick={() => { setMenu(false); s.keepAll(); }}><Icon name="ri-check-line" />只保留，留在这一步</div>}
                {bm.mode === 'review' && chg && <div className="menu-item" onClick={() => { setMenu(false); s.undoAll(); }}><Icon name="ri-arrow-go-back-line" />全部撤销</div>}
                {info.index === 0 && !info.isEmpty && bm.mode !== 'review' && lastOp !== 'generate' && <div className="menu-item" onClick={() => { setMenu(false); runNow('generate'); }}><Icon name="ri-restart-line" />重新生成全部</div>}
                {!info.isLast && <div className="menu-item" onClick={() => { setMenu(false); s.skipStep(); }}><Icon name="ri-skip-forward-line" />跳过这一步，进入下一步{info.next ? `：${info.next.name}` : ''}</div>}
                {m.output === 'tree' && !info.isEmpty && <><div className="menu-sep" /><div className="menu-h muted">以此为基础新建：</div>{deriveKinds(a.typeId).filter((k) => s.registry.get(k.templateId)).map((k) => <div key={k.templateId} className="menu-item" onClick={() => { setMenu(false); s.deriveFrom(k); }}><Icon name={k.icon} />{k.verb}</div>)}</>}
                {expert && info.ops.includes('generate') && <div className="menu-item" onClick={() => s.setCrossDesign(!s.crossDesign)}><Icon name={s.crossDesign ? 'ri-checkbox-line' : 'ri-checkbox-blank-line'} />多人设交叉设计（3 个方案）</div>}
                {bm.mode === 'failed' && <div className="menu-item" onClick={() => { setMenu(false); s.setView('settings'); }}><Icon name="ri-exchange-line" />换个模型</div>}
              </div>
            )}
          </div>
        )}
        {(bm.primary.action === 'run' || bm.primary.action === 'runAll') && !bm.primary.disabled && <EstimateText />}
        {bm.mode === 'finished'
          ? <button className="btn" onClick={() => s.finishWork(false)}><Icon name="ri-edit-line" />继续修改</button>
          : <button className="btn primary lg ab-primary" disabled={!!bm.primary.disabled} onClick={doPrimary}>
              {bm.primary.action === 'finish' || (bm.primary.action === 'keepNext' && info.isLast) ? <Icon name="ri-check-double-line" /> : null}
              {bm.primary.label}
              {bm.primary.action !== 'finish' && !(bm.primary.action === 'keepNext' && info.isLast) && <Icon name="ri-arrow-right-line" className="after" />}
            </button>}
      </>)}
    </div>
  );
}
