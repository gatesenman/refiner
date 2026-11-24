import { useState } from 'react';
import { useStore } from '../store';
import { Icon, logIcon } from '../icons/Icon';
import { FreedomTrack } from '../components/FreedomTrack';
import { RENDERERS } from '../renderers';
import { replanOpts } from '../flow';
import { readiness, pickStartStage,
  checkMonotonicStrict, enforceMonotone, effectiveFreedom, freedomScore, listOps, resolveRoles, stagePipeline,
  OP_LABEL, SCOPE_LABEL, STRICT_LABEL,
} from '../../core';
import { whenText } from '../terms';
import type { FreedomSpec, OpKind, Scope, StageDef, Strictness, TypeManifest } from '../../core';

const ORIGIN: Record<string, string> = { derived: '为你定制', template: '来自模板', fallback: '通用流程' };

const newStage = (a: StageDef[], name: string): StageDef => { const last = a[a.length - 1].freedom; return { id: `cp${Date.now() % 100000}`, name, description: '更精细的收尾', freedom: { temperature: Math.max(0.1, Math.round((last.temperature - 0.1) * 100) / 100), scope: ['node'], ops: ['patch'], strictness: 'strict', maxNewNodes: Math.min(last.maxNewNodes ?? 2, 2), requireTarget: true }, pipeline: { steps: [{ id: 'generator', role: 'generator' }, { id: 'consistency', role: 'consistency', needs: ['generator'] }] } }; };

/** 流程蓝图：流程规划师从意图派生出的“过程”，开始前可以修改 */
export function BlueprintView() {
  const s = useStore();
  const p = s.plan;
  const [title, setTitle] = useState('');
  const [pid, setPid] = useState(s.projects[0]?.id ?? '__new');
  const [openLog, setOpenLog] = useState<string | null>(null);
  const expert = s.settings.expert;
  const [adv, setAdv] = useState(false);
  if (!p) return <div className="empty">还没有流程。回到「开始」描述你想做的事。</div>;
  const m = p.draft;
  const setStages = (fn: (st: StageDef[]) => StageDef[]) => s.updateDraft((d) => ({ ...d, stages: fn(d.stages) }));
  const setF = (i: number, patch: Partial<FreedomSpec>) => setStages((st) => st.map((x, j) => (j === i ? { ...x, freedom: { ...x.freedom, ...patch } } : x)));
  const warns = m ? checkMonotonicStrict(m.stages) : [];
  const seedStart = m && p.seed?.useAsDraft && p.seed.tree ? pickStartStage(p.seed.tree, m) : null;
  const start = (autoRun: boolean) => {
    let projectId = pid;
    if (pid === '__new') projectId = s.newProject('新项目').id;
    else projectId = s.ensureDefaultProject(pid);
    s.startFromBlueprint({ title: title.trim() || undefined, projectId, autoRun });
  };
  return (
    <div className={`bp ${expert ? "expert" : ""}`}>
      <div className="bp-main">
        <div className="row" style={{ marginBottom: 6 }}>
          <Icon name={m?.icon ?? 'ri-route-line'} size={22} />
          {m ? <input className="title-input" style={{ fontSize: 18, fontWeight: 600, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none', flex: 1 }} value={m.name} onChange={(e) => s.updateDraft((d) => ({ ...d, name: e.target.value }))} />
            : <b style={{ fontSize: 18 }}>正在规划流程…</b>}
          {expert && m?.origin && <span className={`badge ${m.origin.kind === 'derived' && !p.result?.degraded ? 'accent' : ''}`}>{p.result?.degraded ? '通用流程' : ORIGIN[m.origin.kind]}{m.origin.templateName ? `：${m.origin.templateName}` : ''}</span>}
          {!expert && m?.origin?.kind === 'template' && <span className="badge">来自模板：{m.origin.templateName}</span>}
        </div>
        <div className="hint" style={{ marginBottom: 12 }}><Icon name="ri-chat-quote-line" /> {expert ? '意图' : '你的想法'}：{p.intent}</div>
        {p.seed && <SeedCard />}
        {p.running && !m && <div className="bp-card"><Icon name="ri-loader-4-line" className="spin" /> 正在想该分几步完成…</div>}
        {p.error && <div className="errbox" style={{ marginBottom: 12 }}>{p.error}</div>}
        {p.result?.degraded && (
          <div className="banner warn" style={{ marginBottom: 12 }}>
            <Icon name="ri-error-warning-line" /><span style={{ flex: 1 }}>{p.result.degraded}</span>
            <button className="btn sm" onClick={() => s.setView('settings')}>换模型</button>
            <button className="btn sm" onClick={() => s.planIntent(p.intent, replanOpts(p))}><Icon name="ri-refresh-line" />重新规划</button>
          </div>
        )}
        {!!p.result?.candidates.filter((c) => c.score >= 0.15).length && p.result.source !== 'template' && (
          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            <span className="hint">相近的模板：</span>
            {p.result.candidates.filter((c) => c.score >= 0.15).map((c) => <span key={c.id} className="ex-chip" title="改用这个模板作为蓝图" onClick={() => s.planIntent(p.intent, replanOpts(p, c.id))}><Icon name={s.registry.get(c.id)?.icon} />{c.name}<span className="muted">{Math.round(c.score * 100)}%</span></span>)}
          </div>
        )}
        {m && (<>
          <div className="bp-card simple-steps">
            <h3><Icon name="ri-footprint-line" />我们建议分 {m.stages.length} 步完成<span className="muted">（可以改名、增删）</span></h3>
            <div className="ss-body">
              <div className="ss-axis" title="越往后 AI 越克制：只改你选中的地方"><span>AI 放得开</span><i /><span>AI 很克制</span></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {m.stages.map((st, i) => (
                  <div key={st.id} className="sstep">
                    <span className="sstep-n" style={{ ['--h' as any]: m.stages.length > 1 ? i / (m.stages.length - 1) : 0 }}>{i + 1}</span>
                    <input className="sstep-name" value={st.name} onChange={(e) => setStages((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <input className="sstep-desc" value={st.description ?? ''} placeholder="这一步做什么（一句话）" onChange={(e) => setStages((a) => a.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    {i > 0 && m.stages.length > 2 && <button className="icon-btn" title="删除这一步" aria-label="删除这一步" onClick={() => setStages((a) => a.filter((_x, j) => j !== i))}><Icon name="ri-delete-bin-6-line" /></button>}
                  </div>
                ))}
                <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => setStages((a) => [...a, newStage(a, `第 ${a.length + 1} 步`)])}><Icon name="ri-add-line" />加一步</button>
              </div>
            </div>
          </div>
          {!expert && (
            <div className="more-set">
              <div className="more-h" onClick={() => setAdv(!adv)}><Icon name={adv ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />更多设置<span className="muted">（名称、放入哪个项目、AI 分工）</span></div>
              {adv && (
                <div className="more-b">
                  <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="field" style={{ flex: 1, minWidth: 200 }}><label>名称</label><input className="input" value={title} placeholder={p.intent.slice(0, 24)} onChange={(e) => setTitle(e.target.value)} /></div>
                    <div className="field" style={{ width: 220 }}><label>放入项目</label>
                      <select className="select" value={pid} onChange={(e) => setPid(e.target.value)}>
                        {s.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        <option value="__new">新建项目…</option>
                      </select>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn sm" onClick={() => m && s.setSaveTpl({ m, name: m.name })}><Icon name="ri-bookmark-line" />把这些步骤存为模板</button>
                    <button className="btn sm" disabled={p.running} onClick={() => s.planIntent(p.intent, replanOpts(p))}><Icon name="ri-refresh-line" />重新规划</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {(expert || adv) && (<>
          <div className="bp-card">
            <h3><Icon name="ri-shapes-line" />① 形态<span className="muted">产物是一棵节点树：层级、属性与视图由规划师推断</span></h3>
            <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
              <span className="hint" style={{ width: 64 }}>层级</span>
              {(m.nodeSchema?.levels ?? ['主题', m.nodeSchema?.childLabel ?? '要点']).map((l, i, a) => <span key={i} className="row" style={{ gap: 4 }}><span className="chip">{l}</span>{i < a.length - 1 && <Icon name="ri-arrow-right-s-line" className="muted" />}</span>)}
            </div>
            <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
              <span className="hint" style={{ width: 64 }}>属性</span>
              {(m.nodeSchema?.props ?? []).length ? m.nodeSchema!.props!.map((pp) => (
                <span key={pp.key} className="chip" title={pp.options?.join(' / ')}>{pp.label}<span className="muted">{pp.type}{pp.options ? `·${pp.options.length}` : ''}</span>
                  <span style={{ cursor: 'pointer', display: 'inline-flex' }} title="移除该属性" onClick={() => s.updateDraft((d) => ({ ...d, nodeSchema: { ...d.nodeSchema, props: (d.nodeSchema?.props ?? []).filter((x) => x.key !== pp.key) } }))}><Icon name="ri-close-line" className="muted" /></span></span>
              )) : <span className="muted">无（纯结构）</span>}
            </div>
            <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
              <span className="hint" style={{ width: 64 }}>一级结构</span>
              {(m.demo?.root?.children ?? []).map((c, i) => <span key={i} className="chip">{c.title}</span>)}
              {!(m.demo?.root?.children ?? []).length && <span className="muted">由第一个检查点生成</span>}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="hint" style={{ width: 64 }}>视图</span>
              {[m.renderer, ...(m.views ?? [])].filter((v) => RENDERERS[v]).map((v, i) => <span key={v} className={`tog ${i === 0 ? 'on' : ''}`} onClick={() => s.updateDraft((d) => ({ ...d, renderer: v, views: [d.renderer, ...(d.views ?? [])].filter((x) => x !== v) }))}><Icon name={RENDERERS[v].icon} /> {RENDERERS[v].name}</span>)}
              <span className="hint">（点击设为主视图）</span>
            </div>
          </div>

          <div className="bp-card">
            <h3><Icon name="ri-equalizer-line" />② 检查点与自由度<span className="muted">自由度沿轴逐维单调不增；检查点数量与名称都可以改</span></h3>
            <FreedomTrack stages={m.stages} />
            <table className="cp-table" style={{ marginTop: 8 }}>
              <thead><tr><th>#</th><th>检查点</th><th>温度</th><th>作用域</th><th>可用算子</th><th>严格度</th><th>新增上限</th><th>有效自由度</th><th /></tr></thead>
              <tbody>
                {m.stages.map((st, i) => (
                  <tr key={st.id}>
                    <td className="muted">{i + 1}</td>
                    <td><input className="input" style={{ width: 96, height: 24, padding: '2px 6px' }} value={st.name} onChange={(e) => setStages((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} title={st.description} /></td>
                    <td><input type="range" min={0} max={1.5} step={0.05} value={st.freedom.temperature} onChange={(e) => setF(i, { temperature: Number(e.target.value) })} /> <span className="mono">{st.freedom.temperature.toFixed(2)}</span></td>
                    <td>{(['artifact', 'subtree', 'node'] as Scope[]).map((x) => <span key={x} className={`tog ${st.freedom.scope.includes(x) ? 'on' : ''}`} onClick={() => setF(i, { scope: st.freedom.scope.includes(x) ? (st.freedom.scope.length > 1 ? st.freedom.scope.filter((y) => y !== x) : st.freedom.scope) : [...st.freedom.scope, x] })}>{SCOPE_LABEL[x]}</span>)}</td>
                    <td style={{ maxWidth: 240 }}>{listOps().map((o) => <span key={o} className={`tog ${st.freedom.ops.includes(o as OpKind) ? 'on' : ''}`} onClick={() => setF(i, { ops: st.freedom.ops.includes(o as OpKind) ? (st.freedom.ops.length > 1 ? st.freedom.ops.filter((y) => y !== o) : st.freedom.ops) : [...st.freedom.ops, o as OpKind] })}>{OP_LABEL[o]}</span>)}</td>
                    <td><select className="select" style={{ height: 24, padding: '0 4px', width: 88 }} value={st.freedom.strictness} onChange={(e) => setF(i, { strictness: e.target.value as Strictness })}>{(['loose', 'schema', 'strict'] as Strictness[]).map((x) => <option key={x} value={x}>{STRICT_LABEL[x]}</option>)}</select></td>
                    <td><input className="input" style={{ width: 54, height: 24, padding: '2px 6px' }} value={st.freedom.maxNewNodes ?? ''} placeholder="不限" onChange={(e) => setF(i, { maxNewNodes: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })} /></td>
                    <td><b>{freedomScore(effectiveFreedom(m.stages, i))}</b></td>
                    <td>{i > 0 && <button className="icon-btn" title="删除检查点" aria-label="删除检查点" onClick={() => setStages((a) => a.filter((_x, j) => j !== i))}><Icon name="ri-delete-bin-6-line" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => setStages((a) => [...a, newStage(a, `检查点 ${a.length + 1}`)])}><Icon name="ri-add-line" />追加检查点</button>
              <span className="spacer" />
              {warns.length ? <><span className="warnbox" style={{ padding: '3px 8px' }}><Icon name="ri-error-warning-line" /> {warns.length} 处放宽：{warns[0]}{warns.length > 1 ? ' …' : ''}</span>
                <button className="btn sm" onClick={() => setStages((a) => enforceMonotone(a))}><Icon name="ri-contract-left-right-line" />逐维取严，自动收紧</button></>
                : <span className="badge live"><Icon name="ri-checkbox-circle-line" /> 自由度逐维单调</span>}
            </div>
          </div>

          <div className="bp-card">
            <h3><Icon name="ri-flow-chart" />③ 每个检查点的智能体分工<span className="muted">智能体就是在当前自由度内执行算子的执行者</span></h3>
            {m.stages.map((st, i) => <PipelineRow key={st.id} m={m} i={i} />)}
          </div>
          </>)}
        </>)}
      </div>

      {expert && <div className="bp-side">
        <div className="sec">
          <div className="sec-h"><span>开始</span></div>
          <div className="field"><label>标题（可选）</label><input className="input" value={title} placeholder={p.intent.slice(0, 24)} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label>放入项目</label>
            <select className="select" value={pid} onChange={(e) => setPid(e.target.value)}>
              {s.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="__new">新建项目…</option>
            </select>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" style={{ flex: 1 }} disabled={!m} onClick={() => start(false)}>仅创建</button>
            <button className="btn sm" style={{ flex: 1 }} disabled={!m} onClick={() => m && s.setSaveTpl({ m, name: m.name })}><Icon name="ri-bookmark-line" />存为模板</button>
            <button className="btn sm" style={{ flex: 1 }} disabled={p.running} onClick={() => s.planIntent(p.intent, replanOpts(p))}><Icon name="ri-refresh-line" />重新规划</button>
          </div>
        </div>
        <div className="sec-h" style={{ padding: '10px 14px 0' }}><span>{expert ? '规划过程（蓝图本身也由粗到细）' : '规划过程'}</span>{p.running && <Icon name="ri-loader-4-line" className="spin" />}</div>
        <div className="plan-log">
          {p.log.map((e) => (
            <div key={e.id} className="plan-step" onClick={() => setOpenLog(openLog === e.id ? null : e.id)} style={{ cursor: 'pointer' }}>
              <Icon name={logIcon(e.role, e.stepId, e.role === 'process-planner' ? 'ri-route-line' : undefined)} size={16} />
              <div>
                <b style={{ fontWeight: 500 }}>{expert ? e.roleName : e.roleName.replace('流程规划 · ', '').replace('蓝图', '流程').replace('检查点', '步骤')}</b> <span className={`st ${e.status}`} style={{ fontSize: 11 }}>{({ running: '进行中', done: '完成', skipped: '跳过', error: '已兜底' } as Record<string, string>)[e.status]}</span>
                <div className="s">{e.status === 'running' ? (expert ? (p.live[e.stepId] ?? '').slice(-160) || '思考中…' : '思考中…') : expert ? e.summary : (e.summary ?? '').replace(/检查点/g, '步骤').replace(/，?自由度逐维单调/g, '').replace(/（通用回退）/, '（通用流程）')}</div>
                {expert && openLog === e.id && (e.output || p.live[e.stepId]) && <pre className="mono">{e.output ?? p.live[e.stepId]}</pre>}
              </div>
            </div>
          ))}
          {!!p.result?.warnings.length && <div className="warnbox" style={{ marginTop: 8 }}>{p.result.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
        </div>
      </div>}
      <div className="actionbar bp-bar">
        <div className="ab-left"><span className="ab-t"><Icon name="ri-time-line" />{m ? `大约 ${Math.max(1, Math.round(m.stages.length * (s.settings.demoMode ? 0.2 : 0.6)))} 分钟` : '正在规划…'}{s.settings.demoMode ? ' · 演示模式（不调用真实 AI）' : ''}</span></div>
        <span className="spacer" />
        {seedStart && m ? <button className="btn primary lg ab-primary" disabled={p.running} onClick={() => start(false)}>打开初稿，从第 {seedStart.index + 1} 步「{m.stages[seedStart.index].name}」接着做<Icon name="ri-arrow-right-line" className="after" /></button>
          : <button className="btn primary lg ab-primary" disabled={!m || p.running} onClick={() => start(true)}>开始第 1 步：{m?.stages[0]?.name ?? '…'}<Icon name="ri-arrow-right-line" className="after" /></button>}
      </div>
    </div>
  );
}

function PipelineRow({ m, i }: { m: TypeManifest; i: number }) {
  const roles = resolveRoles(m);
  const steps = stagePipeline(m, i).steps;
  const st = m.stages[i];
  return (
    <div className="row wrap" style={{ gap: 4, padding: '5px 0', borderTop: i ? '1px dashed var(--border)' : undefined }}>
      <span className="chip" style={{ minWidth: 70 }}>{i + 1}. {st.name}</span>
      {steps.map((x, k) => (
        <span key={x.id} className="row" style={{ gap: 4 }}>
          {k > 0 && <Icon name="ri-arrow-right-s-line" className="muted" />}
          <span className="row" style={{ gap: 3 }}><Icon name={roles[x.role]?.icon} fallback="ri-robot-2-line" />{roles[x.role]?.name ?? x.role}{x.when && <span className="muted" style={{ fontSize: 11 }} title={x.when}>（{whenText(x.when)}）</span>}{x.loop && <Icon name="ri-repeat-line" className="muted" title="复评循环" />}</span>
        </span>
      ))}
      <span className="row" style={{ gap: 3 }}><Icon name="ri-arrow-right-s-line" className="muted" /><Icon name="ri-shield-check-line" />约束守卫</span>
    </div>
  );
}

/** 从已有材料开始：说明导入了什么、是否作为初稿、规划师建议从哪一步开始 */
function SeedCard() {
  const s = useStore();
  const p = s.plan!;
  const sd = p.seed!;
  const m = p.draft;
  const tree = sd.tree;
  const parts = tree?.children?.filter((c) => !c.children?.every((g) => g.kind === 'open-question') || !c.children?.length).length ?? 0;
  let items = 0;
  const walkN = (n: any) => { (n.children ?? []).forEach((c: any) => { items++; walkN(c); }); };
  if (tree) walkN(tree);
  const pick = m && tree ? pickStartStage(tree, m) : null;
  const chars = sd.refs.reduce((x, r) => x + r.text.length, 0);
  const rd = m && tree ? readiness(tree, m) : null;
  const oq = sd.questions ?? 0;
  return (
    <div className="bp-card seed-card">
      <div className="row"><Icon name="ri-file-upload-line" /><b>已读取「{sd.name}」</b><span className="muted">{sd.refs.length > 1 ? `等 ${sd.refs.length} 份 · ` : ''}{chars.toLocaleString()} 字{parts ? ` · 识别出 ${parts} 个部分、${items - oq} 项` : ''}</span></div>
      {rd && parts > 0 && <div className="seed-stats"><span className="ready-chip small"><span className="rbar"><i style={{ width: `${rd.percent}%` }} /></span>就绪 {rd.percent}%</span>{rd.rough ? <span><span className="mat mat-rough" />{rd.rough} 项还比较粗</span> : null}{rd.medium ? <span><span className="mat mat-medium" />{rd.medium} 项基本清楚</span> : null}{rd.detailed ? <span><span className="mat mat-detailed" />{rd.detailed} 项已具体</span> : null}{oq ? <span className="oq-tag">{oq} 个待澄清问题</span> : null}</div>}
      {sd.notes?.map((x, i) => <div key={i} className="hint">{x}</div>)}
      <div className="hint" style={{ marginTop: 6 }}>原文会作为<b>参考资料</b>挂在作品上，之后每一步都会参考。</div>
      {tree && parts > 0 && (
        <label className="row" style={{ marginTop: 8, gap: 6 }}>
          <input type="checkbox" checked={sd.useAsDraft} onChange={(e) => s.setPlan({ ...p, seed: { ...sd, useAsDraft: e.target.checked } })} />
          把识别出的结构作为初稿{pick && sd.useAsDraft ? <span className="muted">— {pick.reason}</span> : <span className="muted">（不勾选则从第 1 步重新生成，只把原文当参考）</span>}
        </label>
      )}
    </div>
  );
}
