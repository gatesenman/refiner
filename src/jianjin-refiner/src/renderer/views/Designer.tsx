import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore } from '../store';
import { parseManifest, freedomScore, effectiveFreedom, resolveRoles, OP_LABEL, SCOPE_LABEL } from '../../core';
import { RENDERERS } from '../renderers';
import { Icon } from '../icons/Icon';
import { ICON_NAMES } from '../icons/names';

const BLANK = `# 新模板（流程蓝图）：保存后立即出现在模板库，无需改任何代码
id: my-type
name: 我的模板
icon: ri-star-line      # 图标名（Remix Icon），可点上方「选择图标」挑选
category: 自定义
description: 用一句话描述这个流程
renderer: tree          # tree | mindmap | table | board | timeline | code | gallery | doc
views: [mindmap, table]
nodeSchema:
  childLabel: 条目
  props:
    - { key: status, label: 状态, type: enum, options: [待定, 进行中, 完成] }
stages: default         # 或自定义任意多个阶段，自由度需逐级递减
pipeline:
  steps:
    - { id: planner, role: planner }
    - { id: generator, role: generator, needs: [planner] }
    - { id: critic, role: critic, needs: [generator] }
    - { id: reviser, role: reviser, needs: [critic], when: "critic.score < 8" }
prompts:
  domain: 在这里写领域知识与质量标准
exporters: [markdown, json, csv]
`;

function FreedomCurve({ scores, names }: { scores: number[]; names: string[] }) {
  const W = 300, H = 120, pad = 24;
  const step = scores.length > 1 ? (W - pad * 2) / (scores.length - 1) : 0;
  const pts = scores.map((v, i) => [pad + i * step, H - pad - (v / 100) * (H - pad * 1.6)]);
  return (
    <svg width={W} height={H + 20}>
      {[0, 50, 100].map((g) => <line key={g} x1={pad} x2={W - pad} y1={H - pad - (g / 100) * (H - pad * 1.6)} y2={H - pad - (g / 100) * (H - pad * 1.6)} stroke="var(--border)" strokeDasharray="3 3" />)}
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={4.5} fill={i > 0 && scores[i] > scores[i - 1] ? 'var(--err)' : 'var(--accent)'} />
          <text x={x} y={y - 9} fontSize={11} textAnchor="middle" fill="var(--text)">{scores[i]}</text>
          <text x={x} y={H + 4} fontSize={11} textAnchor="middle" fill="var(--text2)">{names[i]}</text>
        </g>
      ))}
    </svg>
  );
}

export function Designer() {
  const s = useStore();
  const list = s.registry.list();
  const [selId, setSelId] = useState<string | undefined>(s.designerSel ?? list[0]?.manifest.id);
  const entry = selId ? s.registry.entry(selId) : undefined;
  const [text, setText] = useState<string>(entry?.raw ?? BLANK);
  const [isNew, setIsNew] = useState(false);
  useEffect(() => { if (entry && !isNew) setText(entry.raw); }, [selId, s.regVersion]); // eslint-disable-line
  const res = useMemo(() => parseManifest(text, (id) => s.registry.get(id)), [text, s.registry, s.regVersion]);
  const m = res.manifest;
  const builtin = !isNew && entry?.source === 'builtin';
  const [picker, setPicker] = useState(false);
  const setIcon = (name: string) => {
    setText((t) => (/^icon:.*$/m.test(t) ? t.replace(/^icon:.*$/m, `icon: ${name}`) : t.replace(/^(name:.*)$/m, `$1\nicon: ${name}`)));
    setPicker(false);
  };

  const save = async () => {
    const r = await s.installType(text);
    if (r.ok) { s.toast(`已保存并安装「${r.id}」`, 'success'); setIsNew(false); setSelId(r.id); }
    else s.toast(r.errors.join('；'), 'error');
  };
  const copyAsNew = () => {
    const id = `${entry?.manifest.id ?? 'type'}-copy`;
    setText(text.replace(/^id:\s*.*$/m, `id: ${id}`).replace(/^name:\s*(.*)$/m, 'name: $1（副本）'));
    setIsNew(true);
  };

  return (
    <div className="designer">
      <div className="dl">
        <div className="sec" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="btn primary block" onClick={() => s.setNewDialog({ typeId: 'meta.type' })}><Icon name="ri-sparkling-line" />让 AI 设计新模板</button>
          <div className="row">
            <button className="btn sm" style={{ flex: 1 }} onClick={() => { setText(BLANK); setIsNew(true); setSelId(undefined); }}><Icon name="ri-add-line" />空白模板</button>
            <button className="btn sm" style={{ flex: 1 }} onClick={async () => { const t = await window.api.openFile(); if (t) { setText(t); setIsNew(true); setSelId(undefined); } }}><Icon name="ri-file-upload-line" />导入文件</button>
          </div>
        </div>
        <div className="side-h">模板（缓存的流程蓝图）</div>
        {list.map(({ manifest: x, source }) => (
          <div key={x.id} className={`side-item ${x.id === selId && !isNew ? 'active' : ''}`} onClick={() => { setIsNew(false); setSelId(x.id); setText(s.registry.entry(x.id)!.raw); }}>
            <span className="ico"><Icon name={x.icon} /></span><span className="lbl">{x.name}</span>
            <span className={`badge ${source === 'user' ? 'accent' : ''}`} style={{ fontSize: 10, padding: '0 5px' }}>{source === 'user' ? '用户' : '内置'}</span>
          </div>
        ))}
        <div className="sec" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
          <button className="btn sm block" onClick={() => window.api.openPluginDir()}><Icon name="ri-folder-open-line" />打开用户插件文件夹</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        <div className="toolbar">
          <b>{isNew ? '新模板（未保存）' : <><Icon name={entry?.manifest.icon} /> {entry?.manifest.name ?? ''}</>}</b>
          {!isNew && <span className="chip mono">{selId}.yaml</span>}
          {builtin && <span className="badge">内置 · 只读，可复制为新模板</span>}
          <span className="spacer" />
          {!builtin && <button className="btn sm" onClick={() => setPicker(true)}><Icon name={m?.icon} />选择图标</button>}
          {builtin ? <button className="btn sm primary" onClick={copyAsNew}><Icon name="ri-file-copy-line" />复制为新模板</button> : <button className="btn sm primary" disabled={!m} onClick={save}><Icon name="ri-save-3-line" />保存并安装</button>}
          {!isNew && entry?.source === 'user' && <button className="btn sm danger" onClick={async () => { if (await s.confirmDialog({ title: `卸载模板「${selId}」？`, body: '用这个模板创建、且没有自带流程的作品将无法打开，直到重新安装。', ok: '卸载', danger: true })) { await s.deleteType(selId!); setSelId(list[0]?.manifest.id); } }}><Icon name="ri-delete-bin-6-line" />卸载</button>}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <CodeMirror value={text} height="100%" style={{ height: '100%' }} theme={s.settings.theme === 'dark' ? oneDark : 'light'} extensions={[yaml()]} readOnly={builtin} onChange={setText} />
        </div>
      </div>
      <div className="dr">
        <div className="sec">
          <div className="sec-h"><span>校验</span></div>
          {res.errors.length ? res.errors.map((e, i) => <div key={i} className="errbox" style={{ marginBottom: 4 }}><Icon name="ri-close-circle-line" /> {e}</div>) : <div className="badge live"><Icon name="ri-checkbox-circle-line" /> 插件结构合法</div>}
          {res.warnings.map((w, i) => <div key={i} className="warnbox" style={{ marginTop: 6 }}><Icon name="ri-error-warning-line" /> {w}</div>)}
        </div>
        {m && (<>
          <div className="sec">
            <div className="sec-h"><span>自由度曲线（应单调递减）</span></div>
            <FreedomCurve scores={m.stages.map((_x, i) => freedomScore(effectiveFreedom(m.stages, i)))} names={m.stages.map((x) => x.name)} />
          </div>
          <div className="sec">
            <div className="sec-h"><span>阶段</span></div>
            {m.stages.map((st, i) => (
              <div key={st.id} style={{ marginBottom: 8 }}>
                <div><b>{i + 1}. {st.name}</b> <span className="muted">· T={st.freedom.temperature} · {st.freedom.scope.map((x) => SCOPE_LABEL[x]).join('/')}</span></div>
                <div className="row wrap" style={{ gap: 3, marginTop: 3 }}>{st.freedom.ops.map((o) => <span key={o} className="chip">{OP_LABEL[o]}</span>)}</div>
              </div>
            ))}
          </div>
          <div className="sec">
            <div className="sec-h"><span>智能体流水线</span></div>
            {(() => { const roles = resolveRoles(m); return m.pipeline.steps.map((st, i) => (
              <div key={st.id}>{i > 0 && <div className="arrow"><Icon name="ri-arrow-down-line" /></div>}<div className="agent"><span className="ico"><Icon name={roles[st.role]?.icon} fallback="ri-robot-2-line" /></span><span className="nm">{roles[st.role]?.name ?? st.role}{st.when && <span className="chip" style={{ marginLeft: 6 }}>若 {st.when}</span>}{(st.needs?.length ?? 0) > 1 && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>汇合 {st.needs!.join(' + ')}</span>}</span></div></div>
            )); })()}
          </div>
          <div className="sec">
            <div className="sec-h"><span>视图积木</span></div>
            <div className="row wrap" style={{ gap: 4 }}>{[m.renderer, ...(m.views ?? [])].map((v) => <span key={v} className="chip"><Icon name={RENDERERS[v]?.icon} /> {RENDERERS[v]?.name ?? v}</span>)}</div>
            <div className="hint" style={{ marginTop: 8 }}>输出形态：{m.output === 'text' ? `文本（${m.language ?? 'plain'}）` : '节点树'} · 属性 {m.nodeSchema?.props?.length ?? 0} 个 · 导出 {m.exporters?.join(', ')}</div>
          </div>
        </>)}
      </div>
      {picker && <IconPicker current={m?.icon} onPick={setIcon} onClose={() => setPicker(false)} />}
    </div>
  );
}

/** 图标选择器：从离线打包的 Remix Icon 全集中搜索，点选后写入 YAML 的 icon 字段 */
function IconPicker({ current, onPick, onClose }: { current?: string; onPick: (n: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [fill, setFill] = useState(false);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase().replace(/^ri-/, '');
    return ICON_NAMES.filter((n) => (fill ? n.endsWith('-fill') : !n.endsWith('-fill')) && (!k || n.includes(k))).slice(0, 400);
  }, [q, fill]);
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><Icon name="ri-apps-2-line" size={18} />选择图标<span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>（Remix Icon · {ICON_NAMES.length} 个，离线内置）</span><span className="spacer" /><button className="icon-btn" onClick={onClose}><Icon name="ri-close-line" /></button></div>
        <div className="modal-b">
          <div className="row" style={{ marginBottom: 8 }}>
            <input className="input" autoFocus placeholder="搜索英文关键词，如 book、calendar、chart、user…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
            <button className={`btn sm ${fill ? '' : 'primary'}`} onClick={() => setFill(false)}>线性</button>
            <button className={`btn sm ${fill ? 'primary' : ''}`} onClick={() => setFill(true)}>面性</button>
          </div>
          <div className="icon-grid">
            {list.map((n) => <button key={n} title={n} className={n === current ? 'on' : ''} onClick={() => onPick(n)}><Icon name={n} /></button>)}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>{list.length >= 400 ? '仅显示前 400 个，输入关键词缩小范围。' : `${list.length} 个匹配。`}当前：<span className="mono">{current ?? '（默认）'}</span></div>
        </div>
      </div>
    </div>
  );
}
