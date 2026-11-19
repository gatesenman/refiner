import { useMemo, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useStore } from '../store';
import { refContext, REF_BUDGET, fmtTokens, fmtCost, type ArtNode } from '../../core';
import { partialTree, runEstimate } from '../flow';

/** 参考资料面板：文件 / 粘贴文字 / 网址；每一步都会作为上下文发给 AI（超出预算的部分截断并标出） */
export function RefsPanel() {
  const s = useStore();
  const a = s.currentArtifact!;
  const refs = a.refs ?? [];
  const ctx = useMemo(() => refContext(refs), [refs]);
  const [mode, setMode] = useState<'text' | 'url' | null>(null);
  const [name, setName] = useState(''), [text, setText] = useState(''), [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const pct = Math.min(100, Math.round((ctx.used / REF_BUDGET) * 100));
  const add = async () => {
    setBusy(true);
    try {
      if (mode === 'text') await s.addRefs('text', { name, text });
      else await s.addRefs('url', { url, text });
    } finally { setBusy(false); setMode(null); setName(''); setText(''); setUrl(''); }
  };
  return (
    <div className="refs">
      <div className="refs-h">
        <span className="muted">这些资料会作为每一步的参考（AI 优先采用其中的事实和约束）</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => s.addRefs('file')}><Icon name="ri-attachment-2" />添加文件</button>
        <button className={`btn sm ${mode === 'text' ? 'on' : ''}`} onClick={() => setMode(mode === 'text' ? null : 'text')}><Icon name="ri-file-text-line" />粘贴文字</button>
        <button className={`btn sm ${mode === 'url' ? 'on' : ''}`} onClick={() => setMode(mode === 'url' ? null : 'url')}><Icon name="ri-links-line" />网址</button>
      </div>
      {mode && (
        <div className="refs-add">
          {mode === 'text' ? <input className="input" placeholder="名称（可选），如：公司差旅标准" value={name} onChange={(e) => setName(e.target.value)} /> : <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />}
          <textarea className="input" rows={3} placeholder={mode === 'text' ? '把资料正文粘贴到这里' : '（可选）网页正文；留空则尝试自动读取网页文字'} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row"><span className="spacer" /><button className="btn sm ghost" onClick={() => setMode(null)}>取消</button><button className="btn sm primary" disabled={busy || (mode === 'text' ? !text.trim() : !url.trim())} onClick={add}>{busy ? '读取中…' : '添加'}</button></div>
        </div>
      )}
      <div className="refs-budget" title={`参考资料上限 ${REF_BUDGET} 字（避免提示词过长、费用失控）`}>
        <div className="bar"><i style={{ width: `${pct}%` }} className={ctx.total > REF_BUDGET ? 'over' : ''} /></div>
        <span className="muted">已用 {ctx.used.toLocaleString()} / {REF_BUDGET.toLocaleString()} 字{ctx.total > REF_BUDGET ? ` · 共 ${ctx.total.toLocaleString()} 字，超出部分不会发送` : ''}</span>
      </div>
      <Facts />
      <Prefs />
      {!refs.length && <div className="empty" style={{ padding: 18 }}>还没有参考资料。可以添加公司规范、往期方案、会议纪要等（支持 Word、PDF、Excel、Markdown、文本）。</div>}
      <div className="refs-list">
        {refs.map((r) => {
          const t = ctx.truncated.find((x) => x.id === r.id);
          return (
            <div key={r.id} className={`ref-i ${r.off ? 'off' : ''}`}>
              <Icon name={r.kind === 'url' ? 'ri-links-line' : r.kind === 'text' ? 'ri-file-text-line' : 'ri-attachment-2'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ref-n">{r.name}</div>
                <div className="muted ref-s">{r.text.length.toLocaleString()} 字{r.off ? ' · 已停用' : t ? (t.kept ? ` · 只发送前 ${t.kept.toLocaleString()} 字（已截断）` : ' · 超出预算，本次不发送') : ''} · {r.text.slice(0, 60).replace(/\s+/g, ' ')}</div>
              </div>
              <label className="row muted" style={{ gap: 4, fontSize: 12 }}><input type="checkbox" checked={!r.off} onChange={() => s.toggleRef(r.id)} />使用</label>
              <button className="icon-btn" title="移除" onClick={() => s.removeRef(r.id)}><Icon name="ri-delete-bin-6-line" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 运行中：立即显示骨架行；服务商流式输出时逐步显示已生成的部分 */
export function LivePreview({ replace }: { replace: boolean }) {
  const s = useStore();
  const tree = useMemo(() => {
    const log = s.run.log;
    for (let i = log.length - 1; i >= 0; i--) {
      const t = partialTree(s.run.live[log[i].stepId] ?? '');
      if (t) return t;
    }
    return null;
  }, [s.run.live, s.run.log]);
  const rec = (n: ArtNode, d: number): JSX.Element => (
    <div key={n.id} className={`live-n d${d}`}>
      <div className="live-t">{n.title}</div>
      {n.content && <div className="live-c">{n.content}</div>}
      {(n.children ?? []).map((c) => rec(c, d + 1))}
    </div>
  );
  return (
    <div className={`live ${replace ? 'replace' : ''}`} data-live={tree ? 'stream' : 'skeleton'}>
      <div className="live-h"><Icon name="ri-loader-4-line" className="spin" />{tree ? `正在生成… 已出 ${tree.children!.length} 个部分` : 'AI 正在准备内容…'}</div>
      {tree ? (tree.children ?? []).map((c) => rec(c, 1)) : [0, 1, 2, 3].map((i) => <div key={i} className="skel"><i style={{ width: `${46 + ((i * 17) % 30)}%` }} /><i style={{ width: `${70 - ((i * 13) % 25)}%` }} /></div>)}
    </div>
  );
}

/** 用量：作品累计 + 运行前预估 */
export function UsageChip() {
  const s = useStore();
  const a = s.currentArtifact!;
  const u = a.usage;
  if (!u || !u.runs) return null;
  return <span className="chip usage" title={`这个作品累计：输入 ${u.input.toLocaleString()} · 输出 ${u.output.toLocaleString()} tokens，共 ${u.runs} 次运行${s.settings.demoMode ? '（演示模式不计费）' : ''}`}><Icon name="ri-coins-line" />{fmtTokens(u.input + u.output)} tokens{u.cost ? ` · ${fmtCost(u.cost)}` : ''}</span>;
}

export function EstimateText({ stageIndex }: { stageIndex?: number }) {
  const s = useStore();
  const a = s.currentArtifact, m = s.currentManifest;
  if (!a || !m) return null;
  const e = runEstimate(a, m, stageIndex ?? a.stageIndex, { model: s.settings.text.model, demo: s.settings.demoMode, prices: s.settings.prices });
  const tk = e.usage.input + e.usage.output;
  return <span className="ab-est muted" title={`运行前预估：输入约 ${e.usage.input.toLocaleString()}、输出约 ${e.usage.output.toLocaleString()} tokens（模型 ${e.model}）`}><Icon name="ri-coins-line" />约 {fmtTokens(tk)} tokens{e.cost != null ? ` · ${s.settings.demoMode ? '演示免费' : fmtCost(e.cost)}` : ' · 未设价格'}</span>;
}

/** 固定事实：澄清与步骤间追问的回答；每一步都会遵守 */
function Facts() {
  const s = useStore();
  const a = s.currentArtifact!;
  const fs = (a.facts ?? []).filter((f) => f.a);
  const [q, setQ] = useState(''), [ans, setAns] = useState('');
  return (
    <div className="facts">
      <div className="facts-h"><Icon name="ri-pushpin-line" /><b>固定事实</b><span className="muted">（你确认过的，AI 不会再猜：澄清时的回答、步骤之间的追问）</span></div>
      {fs.map((f) => (
        <div key={f.id} className="fact"><span className="fq">{f.q.replace(/[？?]\s*$/, '').replace(/——能补充一下吗$/, '')}</span><span className="fa">{f.a}</span><span className="muted" style={{ fontSize: 11 }}>{f.from === 'clarify' ? '澄清' : f.from === 'review' ? '追问' : '手填'}</span><button className="icon-btn" title="移除" onClick={() => s.removeFact(f.id)}><Icon name="ri-close-line" /></button></div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ flex: 1 }} placeholder="事项，如：总预算" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" style={{ flex: 2 }} placeholder="内容，如：不超过 20 万" value={ans} onChange={(e) => setAns(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim() && ans.trim()) { s.addFact(q, ans); setQ(''); setAns(''); } }} />
        <button className="btn sm" disabled={!q.trim() || !ans.trim()} onClick={() => { s.addFact(q, ans); setQ(''); setAns(''); }}>添加</button>
      </div>
    </div>
  );
}

/** v2.0 从撤回中学到的偏好：每步作为约束；可停用 / 删除 / 手动添加 */
function Prefs() {
  const s = useStore();
  const a = s.currentArtifact!;
  const ps = a.prefs ?? [];
  const [t, setT] = useState('');
  return (
    <div className="facts prefs">
      <div className="facts-h"><Icon name="ri-user-heart-line" /><b>你的偏好</b><span className="muted">（从你撤回的改动中学到的，之后每一步 AI 都会避开；可以停用）</span></div>
      {!ps.length && <div className="hint">还没有。撤回某处 AI 改动时，会自动记一条在这里。</div>}
      {ps.map((p) => (
        <div key={p.id} className={`fact pref ${p.on ? '' : 'off'}`}>
          <span className="fa">{p.text}</span>
          <span className="muted" style={{ fontSize: 11 }}>{p.from === 'user' ? '手填' : p.from === 'undoAll' ? '整次撤回' : '撤回'}{(p.hits ?? 1) > 1 ? ` ×${p.hits}` : ''}</span>
          <button className="btn sm ghost" title={p.on ? '停用这条' : '重新启用'} onClick={() => s.togglePref(p.id)}>{p.on ? '停用' : '启用'}</button>
          <button className="icon-btn" title="删除" onClick={() => s.removePref(p.id)}><Icon name="ri-close-line" /></button>
        </div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ flex: 1 }} placeholder="也可以直接写，如：不要用英文缩写" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { s.addUserPref(t); setT(''); } }} />
        <button className="btn sm" disabled={!t.trim()} onClick={() => { s.addUserPref(t); setT(''); }}>添加</button>
      </div>
    </div>
  );
}
