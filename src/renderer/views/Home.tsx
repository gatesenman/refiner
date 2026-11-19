import { useState } from 'react';
import { Icon, LogoMark } from '../icons/Icon';
import { useStore } from '../store';
import { buildSchedule, genericCheckpointNames, shouldClarify, clarifyIntent, composeIntent, uid } from '../../core';
import type { ClarifyQuestion } from '../../core';
import { buildProviders } from '../settings';
import { BOLD_HINT } from '../terms';
import { FreedomTrack } from '../components/FreedomTrack';

/** 不同领域、互不相关的意图示例：产品不预设场景 */
const EXAMPLES: { icon: string; text: string }[] = [
  { icon: 'ri-team-line', text: '策划一场三天的团队建设' },
  { icon: 'ri-database-2-line', text: '设计一个微信小程序的数据库' },
  { icon: 'ri-music-2-line', text: '写一首关于秋天的歌' },
  { icon: 'ri-compass-3-line', text: '我们公司明年该不该进入东南亚市场' },
  { icon: 'ri-map-pin-line', text: '一次带父母去云南的五日旅行' },
  { icon: 'ri-heart-line', text: '一场 80 人的户外婚礼' },
  { icon: 'ri-microscope-line', text: '研究：远程办公是否降低了创新' },
];

export function Home() {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const fs = [...e.dataTransfer.files];
    if (!fs.length) return;
    setBusy(true);
    try {
      const files = await Promise.all(fs.map(async (f) => { const b = new Uint8Array(await f.arrayBuffer()); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return { name: f.name, data: btoa(x) }; }));
      await s.importStart(files);
    } finally { setBusy(false); }
  };
  const s = useStore();
  const [intent, setIntent] = useState('');
  const recent = s.projects.flatMap((p) => p.artifacts.map((a) => ({ p, a }))).sort((x, y) => y.a.updatedAt - x.a.updatedAt).slice(0, 6);
  const [clar, setClar] = useState<{ intent: string; loading: boolean; qs: ClarifyQuestion[]; ans: Record<string, string> } | null>(null);
  const go = async (t = intent) => {
    const x = t.trim();
    if (!x) { s.toast('先描述一下你想做或想决定的事', 'error'); return; }
    if (shouldClarify(x)) {
      setClar({ intent: x, loading: true, qs: [], ans: {} });
      const qs = await clarifyIntent({ intent: x, providers: buildProviders(s.settings) }).catch(() => []);
      if (qs.length) { setClar({ intent: x, loading: false, qs, ans: {} }); return; }
      setClar(null);
    }
    s.planIntent(x);
  };
  // 澄清答案不进标题：标题用原话，答案进意图上下文并作为固定事实挂到作品上
  const finishClar = (useAnswers: boolean) => {
    if (!clar) return;
    const t = useAnswers ? composeIntent(clar.intent, clar.qs, clar.ans) : clar.intent;
    const facts = useAnswers ? clar.qs.filter((q) => clar.ans[q.id]?.trim()).map((q) => ({ id: uid('f'), q: q.q, a: clar.ans[q.id].trim(), from: 'clarify' as const, at: Date.now() })) : [];
    setClar(null);
    s.planIntent(t, { title: clar.intent, facts });
  };
  const demoAxis = buildSchedule(genericCheckpointNames(4));
  return (
    <div className="page" style={{ maxWidth: 1060, margin: '0 auto' }}>
      <div className="hero">
        <LogoMark size={52} />
        <div>
          <h1>{s.settings.expert ? '渐进 Refiner · 从粗到细的过程引擎' : '想做什么？'}</h1>
          <p>{s.settings.expert ? '先在高自由度下铺开整体，再沿着自由度逐级收紧，直到每个细节都确定。' : '一句话告诉我，我们一步步把它做细。'}</p>
        </div>
      </div>

      {clar ? (
        <div className="intent-mini">
          <Icon name="ri-chat-quote-line" /><b>{clar.intent}</b><span className="spacer" />
          <button className="btn sm ghost" onClick={() => { setIntent(clar.intent); setClar(null); }}><Icon name="ri-edit-line" />修改</button>
        </div>
      ) : (
        <div className="intent-box">
          <textarea rows={3} autoFocus value={intent} placeholder="例如：策划一场三天的团队建设"
            onChange={(e) => setIntent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); }} />
          <div className="intent-row">
            <span className="hint">{s.settings.expert ? '流程规划师会推断：产物形态、检查点、每步自由度、智能体分工、合适的视图。' : '我们会先建议分几步完成，你确认后再开始。'}</span>
            <span className="spacer" />
            <span className="hint"><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span></span>
            <button className="btn primary lg" onClick={() => go()}>开始<Icon name="ri-arrow-right-line" className="after" /></button>
          </div>
        </div>
      )}
      {!clar && (
        <div className={`import-zone ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <Icon name="ri-file-upload-line" />
          <span>已经有草稿？<b>从已有材料开始</b>：Word、PDF、Excel/CSV、Markdown/文本，或 XMind、OPML、JSON/YAML 结构</span>
          <span className="spacer" />
          <span className="hint">可直接拖文件到这里</span>
          <button className="btn" disabled={busy} onClick={() => { setBusy(true); s.importStart().finally(() => setBusy(false)); }}>{busy ? <Icon name="ri-loader-4-line" className="spin" /> : <Icon name="ri-folder-open-line" />}{busy ? '读取中…' : '选择文件'}</button>
        </div>
      )}
      {clar && (
        <div className="clarify-card">
          {clar.loading ? <div className="hint"><Icon name="ri-loader-4-line" className="spin" /> 正在理解你的意思…</div> : (<>
            <div className="clar-h"><Icon name="ri-question-answer-line" />为了做得更贴合，回答 {clar.qs.length} 个小问题<span className="muted">（都可以跳过）</span></div>
            {clar.qs.map((q) => {
              const cur = clar.ans[q.id] ?? '';
              const custom = cur && !q.options.includes(cur) ? cur : '';
              return (
                <div key={q.id} className="clar-q">
                  <div className="clar-qt">{q.q}</div>
                  <div className="clar-opts" role="radiogroup" aria-label={q.q}>
                    {q.options.map((o) => (
                      <button key={o} type="button" role="radio" aria-checked={cur === o} className={`opt-btn ${cur === o ? 'on' : ''}`}
                        onClick={() => setClar((c) => c && ({ ...c, ans: { ...c.ans, [q.id]: c.ans[q.id] === o ? '' : o } }))}>
                        {cur === o && <Icon name="ri-check-line" />}{o}
                      </button>
                    ))}
                    <input className={`input opt-in ${custom ? 'on' : ''}`} placeholder="其他，自己写…" value={custom} onChange={(e) => { const v = e.target.value; setClar((c) => c && ({ ...c, ans: { ...c.ans, [q.id]: v } })); }} />
                  </div>
                </div>
              );
            })}
            <div className="clar-foot">
              <span className="hint clar-preview"><Icon name="ri-route-line" />将按这个来规划：<b>{composeIntent(clar.intent, clar.qs, clar.ans)}</b></span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => finishClar(false)}>跳过</button>
              <button className="btn primary" onClick={() => finishClar(true)}>继续<Icon name="ri-arrow-right-line" className="after" /></button>
            </div>
          </>)}
        </div>
      )}
      {!clar && <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        <span className="hint">试试：</span>
        {EXAMPLES.map((x) => <span key={x.text} className="ex-chip" onClick={() => { setIntent(x.text); go(x.text); }}><Icon name={x.icon} />{x.text}</span>)}
      </div>}

      {!clar && recent.length > 0 && (<>
        <div className="h2"><Icon name="ri-history-line" />继续上次的工作</div>
        <div className="grid-cards">
          {recent.slice(0, 3).map(({ p, a }) => {
            const m = s.manifestFor(a);
            return (
              <div key={a.id} className="tcard" style={{ minHeight: 76 }} onClick={() => s.openArtifact(p.id, a.id)}>
                <div className="tn"><Icon name={m?.icon} />{a.title}</div>
                <div className="td">{a.finishedAt ? `全部 ${m?.stages.length ?? '?'} 步已完成` : `第 ${a.stageIndex + 1}/${m?.stages.length ?? '?'} 步 · ${m?.stages[a.stageIndex]?.name ?? ''}`} · {p.name}</div>
              </div>
            );
          })}
        </div>
      </>)}

      {s.settings.expert ? (<>
        <div className="h2"><Icon name="ri-equalizer-line" />过程本身就是产品：自由度是一条连续的轴，检查点只是轴上的命名点</div>
        <div className="bp-card" style={{ paddingBottom: 6 }}>
          <FreedomTrack stages={demoAxis} />
          <div className="hint" style={{ marginTop: 4 }}>每个检查点的自由度是一个向量（温度、作用域、可用算子、严格度、新增上限……），沿轴逐维单调不增；你的手动编辑和锁定会成为后续步骤的硬约束。检查点数量和名称因事而异，“生成 → 细化 → 调整”只是默认的三点蓝图。</div>
        </div>
      </>) : (
        <div className="how-card">
          <div className="how-steps">
            {[['ri-edit-2-line', '说出想法', '一句话描述想做或想决定的事'], ['ri-footprint-line', '确认步骤', '我们会建议分几步完成，可以改'], ['ri-magic-line', '逐步推进', '每一步看结果，满意就进入下一步']].map(([ic, t, d], i) => (
              <div key={t} className="how-step"><span className="how-n">{i + 1}</span><Icon name={ic} size={18} /><div><b>{t}</b><div className="hint">{d}</div></div></div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 8 }}><span className="bold-bar" />{BOLD_HINT}</div>
        </div>
      )}


      {!clar && <div className="h2"><Icon name="ri-bookmark-line" />或从模板开始<span className="muted" style={{ fontWeight: 400 }}>（用别人或自己做过的步骤，直接开始）</span>
        <span className="spacer" /><button className="btn sm" onClick={() => s.setView('templates')}><Icon name="ri-layout-grid-line" />模板库（{s.registry.list().length}）</button></div>}
    </div>
  );
}
