import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { RENDERERS } from '../renderers';
import { EXPORTER_LABEL, runExport, exportKinds } from '../exporters';
import { versionTreeRows, OP_LABEL, fmtTokens, fmtCost, resolveRoles, headChanges, pendingReview, sampleFor, changeReasons } from '../../core';
import { ActionBar } from '../components/ActionBar';
import { ChangeList } from '../components/Compare';
import { RefsPanel, LivePreview, UsageChip } from './WorkExtras';
import { ReadyChip, RoughStrip, AskCard, SourceLink, SourceBanner, Handoff, DeriveRow } from './V17';
import { DraftSide, ConfirmCard, SurveyCard } from '../components/DraftSide';
import { changeMap } from '../../core';
import { useEscClose } from '../esc';
import { Coach, coachSeen } from './V18';
import { Inspector } from '../components/RightPanel';
import { stepInfo, finishStats, barModel } from '../flow';
import { opLabel, roleLabel } from '../terms';
import { Icon, logIcon } from '../icons/Icon';
import { FreedomTrack } from '../components/FreedomTrack';
import type { AgentLogEntry, Version } from '../../core';

export function useExport() {
  const s = useStore();
  return async (k: string) => {
    const a = s.currentArtifact!, m = s.currentManifest!;
    try {
      const p = await runExport(k, a, m, s.settings.theme === 'dark');
      if (k === 'copy') s.toast('已复制为 Markdown，可直接粘贴到文档或聊天里', 'success');
      else if (p) s.toast(`已导出到 ${p}`, 'success', { label: '打开文件夹', fn: () => window.api.showInFolder(p) });
    } catch (e: any) { s.toast(String(e?.message ?? e), 'error'); }
  };
}

function ExportMenu({ up, label }: { up?: boolean; label?: string }) {
  const s = useStore();
  const [lo, setLo] = useState(false);
  const open = label ? lo : s.exportOpen, setOpen = label ? setLo : s.setExportOpen;
  const a = s.currentArtifact!, m = s.currentManifest!;
  const kinds = exportKinds(m);
  const doExport = useExport();
  const hasAI = a.versions.some((v) => v.op !== 'init' && v.op !== 'manual' && v.op !== 'rollback');
  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [open]);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><Icon name="ri-share-forward-line" />{label ?? (up ? '其他格式' : '导出')}<Icon name={up ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} className="after" /></button>
      {open && (
        <div className={`menu ${up ? 'up' : ''}`}>
          {kinds.map((k) => (
            <div key={k} className="menu-item" onClick={() => doExport(k)}>{EXPORTER_LABEL[k] ?? k}{k === 'copy' && <span className="muted" style={{ marginLeft: 'auto', paddingLeft: 12 }}>Ctrl+Shift+C</span>}</div>
          ))}
          <div className="menu-sep" />
          <div className={`menu-item ${hasAI ? '' : 'disabled'}`} title="保存的是步骤，不包含当前内容" onClick={() => hasAI && s.setSaveTpl({ m, name: a.title })}><Icon name="ri-bookmark-line" />存为模板（下次一键复用这些步骤）</div>
        </div>
      )}
    </div>
  );
}

function LogRow({ e, live, roleIcon, expert }: { e: AgentLogEntry; live?: string; roleIcon?: string; expert: boolean }) {
  const [open, setOpen] = useState(false);
  const dur = e.endedAt ? ((e.endedAt - e.startedAt) / 1000).toFixed(1) + 's' : '…';
  const out = expert ? (e.status === 'running' ? live : e.output) : undefined;
  return (
    <div className="log-item" onClick={() => setOpen(!open)} style={{ cursor: out ? 'pointer' : 'default' }}>
      <Icon name={logIcon(e.role, e.stepId, roleIcon)} size={15} />
      <b style={{ fontWeight: 500 }}>{roleLabel(e.role, e.roleName, expert, e.stepId)}</b>
      <span className={`st ${e.status}`}>{({ running: '进行中', done: '完成', skipped: '跳过', error: '失败' } as Record<string, string>)[e.status]}</span>
      <span style={{ color: e.status === 'error' ? 'var(--err)' : 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: open ? 'normal' : 'nowrap' }}>
        {e.status === 'running' ? (expert ? <span className="mono" style={{ fontSize: 11.5 }}>{(live ?? '').slice(-140).replace(/\n/g, ' ') || '思考中…'}</span> : '正在进行…') : expert ? e.summary : simpleSummary(e)}
      </span>
      <span className="muted" style={{ textAlign: 'right', fontSize: 11.5 }}>{dur}{out && <Icon name={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />}</span>
      {open && out && <div className="log-out mono" onClick={(ev) => ev.stopPropagation()}>{out}</div>}
    </div>
  );
}

/** 简单模式：每步一句话结果，不显示原始输出 */
function simpleSummary(e: AgentLogEntry): string {
  const t = e.summary ?? '';
  if (e.status === 'skipped') return t.startsWith('条件不满足') ? '不需要（检查已通过）' : t === '已关闭' ? '已关闭' : '跳过';
  if (e.stepId?.endsWith('-loop')) return t.replace('评审—修订循环结束：', '自动修改结束：').replace(/，共修订 (\d+) 轮/, '，共修改 $1 轮');
  if (e.stepId?.startsWith('guard')) return t === '所有约束均满足' ? '已保护你手改和锁定的内容' : t.replace(/约束/g, '规则');
  if (/^产出 \d+ 个节点/.test(t)) return t.replace('产出', '写出').replace('个节点', '处内容');
  if (/^评分/.test(t)) return t.replace('评分', '检查得分').replace(/〔.*〕/, '');
  return t.replace(/〔.*〕/, '');
}

function AgentLog() {
  const s = useStore();
  const expert = s.settings.expert;
  const a = s.currentArtifact!;
  const isCurrentRun = s.run.artifactId === a.id && (s.run.running || s.run.log.length > 0);
  const head = a.versions.find((v) => v.id === a.head);
  const log = isCurrentRun ? s.run.log : head?.log ?? [];
  const roles = s.currentManifest ? resolveRoles(s.currentManifest) : {};
  if (!log.length) return <div className="empty">{expert ? <>还没有智能体运行记录。<br />在右侧选择阶段与操作后点击「运行」，这里会实时显示规划 → 生成 → 评审 → 修订 → 一致性检查 → 约束守卫的全过程。</> : <>还没有开始。点下方的蓝色按钮，这里会显示 AI 每一步做了什么。</>}</div>;
  return (
    <div>
      {!isCurrentRun && head && <div className="hint" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>当前版本「{head.label}」的{expert ? '运行记录' : '过程'}</div>}
      {log.map((e) => <LogRow key={e.id} e={e} live={s.run.live[e.stepId]} roleIcon={roles[e.role]?.icon} expert={expert} />)}
    </div>
  );
}

function Versions() {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const rows = useMemo(() => versionTreeRows(a), [a]);
  const [selId, setSelId] = useState<string>(a.head);
  useEffect(() => setSelId(a.head), [a.head]);
  const sel = a.versions.find((v) => v.id === selId) ?? a.versions[a.versions.length - 1];
  const parent = a.versions.find((v) => v.id === sel?.parentId);
  const [picked, setPicked] = useState<string[]>([]);
  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const stageName = (v: Version) => m.stages.find((x) => x.id === v.stageId)?.name ?? v.stageId;
  const compareOk = !!sel && sel.id !== a.head && m.output === 'tree';
  const parentOk = !!sel && !!parent && m.output === 'tree';
  return (
    <div className="versions">
      <div className="vlist">
        {[...rows].reverse().map(({ v, depth, isHead, onPath }) => (
          <div key={v.id} className={`vrow ${v.id === selId ? 'sel' : ''} ${isHead ? 'head' : ''} ${onPath ? 'path' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setSelId(v.id)}>
            {m.output === 'tree' && <input type="checkbox" className="vpick" title="勾选两个版本并排对比" checked={picked.includes(v.id)} onClick={(e) => e.stopPropagation()} onChange={() => pick(v.id)} />}
            <span className="vdot" />
            {v.loosened && <span className="chip" style={{ fontSize: 10, padding: '0 5px' }} title={s.settings.expert ? '从更高自由度阶段分叉，约束已放宽' : '回到前面的步骤重新来的结果'}><Icon name="ri-arrow-go-back-line" /> {s.settings.expert ? '放宽' : '回退'}</span>}
            {v.fork && <Icon name="ri-git-branch-line" className="muted" title={`交叉设计方案：${v.fork.persona ?? ''}`} />}
            <span className="vl" title={v.instruction ?? ''}>{v.label}</span>
            {v.fork?.score != null && <span className="badge" style={{ fontSize: 10, padding: '0 5px' }} title="交叉评审得分">{v.fork.score}分</span>}
            {isHead && <span className="badge accent" style={{ fontSize: 10, padding: '0 5px' }}>当前</span>}
            <span className="muted" style={{ fontSize: 11 }}>{new Date(v.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {sel && (
          <div className="row" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
            <b>{sel.label}</b>
            <span className="chip">{stageName(sel)}</span>
            {sel.op !== 'init' && sel.op !== 'manual' && sel.op !== 'rollback' && <span className="chip">{s.settings.expert ? OP_LABEL[sel.op as keyof typeof OP_LABEL] : opLabel(sel.op, false)}</span>}
            {sel.instruction && <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>“{sel.instruction}”</span>}
            <span className="spacer" />
            {sel.usage && (sel.usage.input + sel.usage.output > 0) && <span className="muted" style={{ fontSize: 11.5 }} title={sel.usage.estimated ? '按字数估算' : '服务商返回的用量'}>{sel.usage.estimated ? '约 ' : ''}{fmtTokens(sel.usage.input + sel.usage.output)} tokens{sel.usage.cost != null ? ` · ${fmtCost(sel.usage.cost)}` : ''}</span>}
            {picked.length === 2 && <button className="btn sm primary" onClick={() => s.setCompare({ a: picked[0], b: picked[1] })}><Icon name="ri-layout-column-line" />并排对比所选 2 版</button>}
            {parentOk && picked.length !== 2 && <button className="btn sm" disabled={s.run.running} onClick={() => s.setCompare({ a: parent!.id, b: sel.id })}><Icon name="ri-layout-column-line" />与上一版对比</button>}
            <button className="btn sm" disabled={sel.id === a.head || s.run.running} onClick={() => s.rollback(sel.id)}><Icon name="ri-history-line" />回到这个版本</button>
            <button className="btn sm" disabled={!compareOk || s.run.running} title="与当前版本并排对比，可逐部分采用" onClick={() => s.setCompare({ a: a.head, b: sel.id })}><Icon name="ri-layout-column-line" />与当前对比</button>
          </div>
        )}
        <div className="diff" style={{ flex: 1 }}>
          {sel && <ChangeList before={parent?.root} after={sel.root} m={m} />}
        </div>
      </div>
    </div>
  );
}

/** 唯一的步骤指示：已完成可点击回到该步；跳过显示“—”；颜色从暖（AI 放得开）到冷（AI 很克制） */
function StepBar() {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const info = stepInfo(a, m);
  const n = m.stages.length;
  return (
    <div className="stepbar-wrap">
      <div className="stepbar">
        {m.stages.map((st, i) => {
          const done = a.versions.some((v) => v.stageId === st.id && v.op !== 'init' && v.op !== 'manual' && v.op !== 'rollback');
          const skipped = !done && (a.skipped ?? []).includes(st.id);
          const on = i === a.stageIndex;
          const hue = n > 1 ? i / (n - 1) : 0;
          const canGo = !on && !s.run.running && (done || skipped || i < a.stageIndex);
          return (
            <div key={st.id} className={`sb-step ${on ? 'on' : ''} ${done && !on ? 'done' : ''} ${skipped && !on ? 'skipped' : ''} ${canGo ? 'go' : ''}`} style={{ ['--h' as any]: hue }}
              onClick={() => canGo && s.setStage(i)} title={canGo ? `回到这一步：${st.name}` : st.description}>
              <span className="sb-n">{done && !on ? <Icon name="ri-check-line" /> : skipped && !on ? '—' : i + 1}</span>
              <span className="sb-name">{st.name}{skipped && !on && <span className="muted">（已跳过）</span>}</span>
              {i < n - 1 && <i className="sb-line" />}
            </div>
          );
        })}
        <span className="sb-count">{a.stageIndex + 1}/{n}</span>
      </div>
      <div className="sb-guide">这一步：{info.stage.description || (info.index === 0 ? '从你的想法出发，铺开整体' : '在上一步的基础上继续细化')}{info.index > 0 && !info.frozen ? '。不选就改全部；点选某一项，AI 只改那一部分。' : '。'}</div>
    </div>
  );
}

/** 画布顶部提示：失败（红，可恢复）/ 演示（首次显示，可关闭） */
function Banners() {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const [raw, setRaw] = useState(false);
  const f = s.run.artifactId === a.id && !s.run.running ? s.run.failure : undefined;
  const sample = s.settings.demoMode && m.output === 'tree' ? sampleFor(a.seed) : undefined;
  return (
    <div className="banners">
      {f && (
        <div className="banner err">
          <Icon name="ri-error-warning-fill" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{f.message}</div>
            {raw && (f.raw || f.detail) && <pre className="mono banner-raw">{f.raw ?? f.detail}</pre>}
          </div>
          <button className="btn sm" onClick={() => s.setView('settings')}><Icon name="ri-exchange-line" />换个模型</button>
          {(f.raw || f.detail) && <button className="btn sm ghost" onClick={() => setRaw(!raw)}>{raw ? '收起' : f.raw ? '查看原始回复' : '详情'}</button>}
          <button className="icon-btn" title="关闭" onClick={s.dismissFailure}><Icon name="ri-close-line" /></button>
        </div>
      )}
      <SourceBanner />
      {s.settings.demoMode && !s.settings.demoNoticeSeen && (
        <div className="banner demo">
          <Icon name="ri-flask-line" />
          <span style={{ flex: 1 }}>{sample ? '演示样例：这是预先写好的示例内容，用来展示怎样一步步推进。配置模型后会生成真实内容。' : '演示模式：这是示例内容，不代表 AI 真实水平。配置模型后会生成真实内容。'}</span>
          <button className="btn sm ghost" onClick={() => s.setView('settings')}>配置模型</button>
          <button className="icon-btn" title="知道了，不再显示" onClick={() => s.saveSettings({ ...s.settings, demoNoticeSeen: true })}><Icon name="ri-close-line" /></button>
        </div>
      )}
    </div>
  );
}

/** 完成卡：工作区内的状态卡（可关闭回到内容） */
function FinishCard() {
  const s = useStore();
  const a = s.currentArtifact!, m = s.currentManifest!;
  const st = finishStats(a);
  const doExport = useExport();
  useEffect(() => { document.querySelector('.canvas')?.scrollTo({ top: 0 }); }, []);
  return (
    <div className="finish-card">
      <div className="fc-h"><Icon name="ri-checkbox-circle-fill" size={22} /><b>全部 {m.stages.length} 步已完成</b><span className="spacer" /><button className="icon-btn" title="关闭，回到内容" onClick={() => s.finishWork(false)}><Icon name="ri-close-line" /></button></div>
      <div className="fc-s">{a.title} · {st.parts} 个部分、{st.items} 项 · 用时 {st.minutes} 分钟 · {st.versions} 个版本</div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn primary lg" onClick={() => doExport('docx')}><Icon name="ri-file-word-line" />导出为 Word</button>
        <button className="btn lg" onClick={() => doExport('copy')}><Icon name="ri-clipboard-line" />复制到剪贴板</button>
        <ExportMenu label="其他格式" />
      </div>
      <Handoff />
      <DeriveRow />
      <div className="fc-next">接下来：
        <span className="link" onClick={() => s.finishWork(false)}>继续修改某一部分</span> ·
        <span className="link" onClick={() => s.setSaveTpl({ m, name: a.title })}>存为模板（下次同类事情一键复用）</span> ·
        <span className="link" onClick={() => s.setView('home')}>新建</span>
      </div>
    </div>
  );
}

/** 视图切换：带文字的下拉 */
function ViewSelect({ views, rid }: { views: string[]; rid: string }) {
  const s = useStore();
  const a = s.currentArtifact!;
  return (
    <label className="view-sel" title="切换视图">
      <span className="muted">视图</span>
      <select className="select" value={rid} onChange={(e) => s.setRendererBy({ ...s.rendererBy, [a.id]: e.target.value })}>
        {views.map((v) => <option key={v} value={v}>{RENDERERS[v].name}</option>)}
      </select>
    </label>
  );
}

export function ArtifactView() {
  const s = useStore();
  const a = s.currentArtifact!;
  const m = s.currentManifest;
  const expert = s.settings.expert;
  const [dock, setDock] = useState<'log' | 'versions' | 'refs' | null>(expert ? 'log' : null);
  const closeDock = useCallback(() => setDock(null), []);
  const [coach, setCoach] = useState(() => !coachSeen());
  useEscClose(!!dock, closeDock, 1);
  const chg = useMemo(() => (a ? headChanges(a) : undefined), [a]);
  const pend = a ? pendingReview(a) : undefined;
  const reasons = useMemo(() => (chg && a ? changeReasons(a.root, chg.map, m, chg.version.summary?.issues, chg.version.summary?.whys) : undefined), [chg, a, m]);
  const running = s.run.running && s.run.artifactId === a?.id;
  const cfm = s.run.confirm;
  // 运行完成：自动滚动到第一处改动
  useEffect(() => {
    if (running || !pend) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.canvas .chg');
      if (el) el.scrollIntoView({ block: 'center' });
      else document.querySelector('.canvas')?.scrollTo({ top: 0 });
    }, 60);
    return () => clearTimeout(t);
  }, [pend?.version.id, running]); // eslint-disable-line
  if (!m) return <div className="empty">此制品引用的模板「{a.typeId}」不存在（可能已被删除）。可在模板编辑器中重新安装。</div>;
  const views = [m.renderer, ...(m.views ?? [])].filter((v, i, arr) => arr.indexOf(v) === i && RENDERERS[v]);
  const rid = s.rendererBy[a.id] && views.includes(s.rendererBy[a.id]) ? s.rendererBy[a.id] : m.renderer;
  const R = RENDERERS[rid] ?? RENDERERS.tree;
  const bm = barModel({ a, m, op: 'generate', running, failed: false });
  const finished = bm.mode === 'finished';
  const selNode = !!s.selectedId && s.selectedId !== a.root.id && m.output !== 'text';
  return (
    <>
      <div className="toolbar">
        <span className="tb-proj muted">{s.currentProject?.name}<Icon name="ri-arrow-right-s-line" /></span>
        <input key={a.id} className="title-input" defaultValue={a.title} title="点击改名" onBlur={(e) => e.target.value && e.target.value !== a.title && s.renameArtifact(e.target.value)} />
        <ReadyChip />
        <SourceLink />
        {expert && <span className="chip" title={`意图：${a.seed}`}>{a.blueprint ? <Icon name="ri-route-line" /> : <Icon name="ri-bookmark-line" />}{m.name}</span>}
        <span className="spacer" />
        <button className="icon-btn" title="撤销（Ctrl+Z）" disabled={s.run.running} onClick={() => s.undo()}><Icon name="ri-arrow-go-back-line" /></button>
        <button className="icon-btn" title="重做（Ctrl+Shift+Z）" disabled={s.run.running} onClick={() => s.redo()}><Icon name="ri-arrow-go-forward-line" /></button>
        <button className={`btn sm ghost ${dock === 'versions' ? 'on' : ''}`} title="所有版本，可回到任一版本" onClick={() => setDock(dock === 'versions' ? null : 'versions')}><Icon name="ri-history-line" />历史<span className="muted">{a.versions.length}</span></button>
        <UsageChip />
        <button className={`btn sm ghost ${dock === 'refs' ? 'on' : ''}`} title="参考资料：每一步都会参考" onClick={() => setDock(dock === 'refs' ? null : 'refs')}><Icon name="ri-book-2-line" />资料{a.refs?.length ? <span className="muted">{a.refs.length}</span> : null}</button>
        {views.length > 1 && <ViewSelect views={views} rid={rid} />}
        <ExportMenu />
      </div>
      {expert ? (
        <div className="ftrack-wrap">
          <FreedomTrack compact stages={m.stages} current={a.stageIndex} onPick={(i) => s.setStage(i)}
            versions={a.versions.map((v) => ({ stageIndex: Math.max(0, m.stages.findIndex((x) => x.id === v.stageId)), head: v.id === a.head }))} />
        </div>
      ) : <StepBar />}
      <Banners />
      <div className="split-v">
        <div className="work-main">
        <div className="canvas-wrap">
          <div className={`canvas ${running ? 'is-running' : ''} ${running && s.run.lastOp?.op !== 'generate' && selNode ? 'has-target' : ''}`} style={R.fill ? { overflow: 'hidden' } : undefined}>
            {finished && <FinishCard />}
            {coach && !running && !finished && !!a.root.children?.length && <Coach onDone={() => setCoach(false)} />}
            {running && m.output === 'tree' && <LivePreview replace={!a.root.children?.length} />}
            {!(running && m.output === 'tree' && !a.root.children?.length) && <R.C art={a} m={m} root={cfm?.preview ?? a.root} sel={s.selectedId} multi={s.multiSel.length >= 2 ? s.multiSel : undefined}
              onSelect={(id, add) => { if (add && id && id !== a.root.id) s.toggleMulti(id); else { s.clearMulti(); s.setSelectedId(id); } }} onChange={(root, label) => s.manualEdit(root, label)}
              changes={running && !cfm ? undefined : (cfm ? changeMap(cfm.base, cfm.preview).map : chg?.map)}
              review={chg && !cfm ? { whyOf: (id) => reasons?.get(id), onKeep: s.keepOne, onRevert: s.revertOne } : undefined} />}
          </div>
          {!expert && selNode && !running && !cfm && !chg && (
            <div className="inspector-float">
              <Inspector floating />
            </div>
          )}
        </div>
        <DraftSide />
        </div>
        {dock && (
          <div className="dock">
            <div className="tabs">
              <div className={`tab ${dock === 'log' ? 'on' : ''}`} onClick={() => setDock('log')}><Icon name="ri-robot-2-line" /> {expert ? '智能体日志' : 'AI 过程'}</div>
              <div className={`tab ${dock === 'versions' ? 'on' : ''}`} onClick={() => setDock('versions')}><Icon name="ri-git-branch-line" /> {expert ? '版本树' : '历史'} <span className="muted">{a.versions.length}</span></div>
              <div className={`tab ${dock === 'refs' ? 'on' : ''}`} onClick={() => setDock('refs')}><Icon name="ri-book-2-line" /> 参考资料 <span className="muted">{a.refs?.length ?? 0}</span></div>
              <span className="spacer" />
              <button className="icon-btn" style={{ alignSelf: 'center' }} onClick={() => setDock(null)} title="收起"><Icon name="ri-arrow-down-s-line" /></button>
            </div>
            <div className="dock-body">{dock === 'log' ? <AgentLog /> : dock === 'refs' ? <RefsPanel /> : <Versions />}</div>
          </div>
        )}
        <ConfirmCard />
        <SurveyCard />
        <AskCard />
        <RoughStrip />
        <ActionBar logOpen={dock === 'log'} onToggleLog={() => setDock(dock === 'log' ? null : 'log')} />
      </div>
    </>
  );
}
