import { Icon, LogoMark } from '../icons/Icon';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export function TitleBar() {
  const s = useStore();
  const st = s.settings;
  return (
    <div className="titlebar">
      <div className="brand"><LogoMark />渐进 Refiner<small>v{s.info?.version ?? '1.0.0'}</small></div>
      <div className="crumbs">
        {s.view !== 'artifact' && <b>{({ home: '新建', designer: '模板编辑器', settings: '设置', artifact: '', blueprint: st.expert ? '流程蓝图' : '确认步骤', templates: '模板库' } as Record<string, string>)[s.view]}</b>}
      </div>
      <span className="spacer" />
      {s.savedAt && <span className="saved muted" title="所有内容自动保存在本机"><Icon name="ri-check-line" />已保存 · {new Date(s.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
      {s.run.running && <span className="saved muted"><Icon name="ri-loader-4-line" className="spin" />AI 运行中</span>}
      {st.demoMode
        ? <span className="badge demo" title="未调用任何真实 AI 服务，输出为内置样例。点击去配置模型。" onClick={() => s.setView('settings')} style={{ cursor: 'pointer' }}><Icon name="ri-flask-line" /> 演示模式 · 去配置</span>
        : <span className="badge live tb-model" title={`${st.text.model} @ ${st.text.baseUrl}`} onClick={() => s.setView('settings')} style={{ cursor: 'pointer' }}><Icon name="ri-plug-line" /><span className="tb-model-t">{st.text.model}</span></span>}
      <label className="expert-toggle" title="专家模式：显示自由度、算子、智能体流水线等引擎细节">
        <button className={`switch ${st.expert ? 'on' : ''}`} onClick={() => s.saveSettings({ ...st, expert: !st.expert })} /><span>专家模式</span>
      </label>
      <button className="icon-btn" title="快捷键（?）" onClick={() => s.setHelpOpen(true)}><Icon name="ri-keyboard-line" /></button>
      <button className="icon-btn" title="切换明暗主题" onClick={() => s.saveSettings({ ...st, theme: st.theme === 'dark' ? 'light' : 'dark' })}><Icon name={st.theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'} /></button>
      <button className="icon-btn" title="设置" onClick={() => s.setView('settings')}><Icon name="ri-settings-3-line" /></button>
    </div>
  );
}

export function Sidebar() {
  const s = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const nTpl = s.registry.list().length;
  const st = s.settings;
  void s.regVersion;
  return (
    <aside className="sidebar">
      <div className="side-scroll">
        <div className={`side-item ${s.view === 'home' ? 'active' : ''}`} style={{ marginTop: 2 }} onClick={() => s.setView('home')}>
          <span className="ico" title="新建"><Icon name="ri-sparkling-2-line" /></span><span className="lbl">新建</span>
        </div>
        {s.plan && st.expert && <div className={`side-item ${s.view === 'blueprint' ? 'active' : ''}`} onClick={() => s.setView('blueprint')} title={s.plan.intent}>
          <span className="ico"><Icon name="ri-route-line" /></span><span className="lbl">当前蓝图：{s.plan.draft?.name ?? s.plan.intent}</span>{s.plan.running && <Icon name="ri-loader-4-line" className="spin" />}
        </div>}
        <div className={`side-item ${s.view === 'templates' ? 'active' : ''}`} onClick={() => s.setView('templates')}>
          <span className="ico"><Icon name="ri-layout-grid-line" /></span><span className="lbl">模板库</span><span className="meta">{nTpl}</span>
        </div>
        <div className="side-h" style={{ marginTop: 12 }}><span>我的项目</span><button className="icon-btn" title="新建项目" onClick={() => { const p = s.newProject('新项目'); setRenaming(p.id); }}><Icon name="ri-add-line" /></button></div>
        {!s.projects.length && <div className="hint" style={{ padding: '4px 16px' }}>还没有项目。在「新建」里描述你想做的事。</div>}
        {s.projects.map((p) => {
          const isOpen = open[p.id] ?? true;
          return (
            <div key={p.id}>
              <div className="side-item proj" onClick={() => setOpen((o) => ({ ...o, [p.id]: !isOpen }))} onDoubleClick={() => setRenaming(p.id)}>
                <span className="ico"><Icon name={isOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} /></span>
                {renaming === p.id ? (
                  <input className="inline-edit" autoFocus defaultValue={p.name} onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { s.renameProject(p.id, e.target.value || p.name); setRenaming(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                ) : <span className="lbl"><Icon name={isOpen ? 'ri-folder-open-line' : 'ri-folder-3-line'} className="muted" /> {p.name}</span>}
                <span className="meta">{p.artifacts.length}</span>
                <span className="act"><button className="icon-btn" title="删除项目" onClick={async (e) => { e.stopPropagation(); if (await s.confirmDialog({ title: `删除项目「${p.name}」？`, body: `其中的 ${p.artifacts.length} 份作品会一起删除。删除后 10 秒内可以撤销。`, ok: '删除', danger: true })) s.deleteProject(p.id); }}><Icon name="ri-delete-bin-6-line" /></button></span>
              </div>
              {isOpen && p.artifacts.map((a) => {
                const m = s.manifestFor(a);
                const active = s.view === 'artifact' && s.current?.artifactId === a.id;
                return (
                  <div key={a.id} className={`side-item child ${active ? 'active' : ''}`} onClick={() => s.openArtifact(p.id, a.id)} title={a.seed}>
                    <span className="ico"><Icon name={m?.icon} fallback="ri-question-line" /></span><span className="lbl">{a.title}</span>
                    <span className="meta" title={m?.stages[a.stageIndex]?.name}>{a.finishedAt ? <Icon name="ri-check-double-line" /> : `${a.stageIndex + 1}/${m?.stages.length ?? '?'}`}</span>
                    <span className="act"><button className="icon-btn" title="删除" onClick={(e) => { e.stopPropagation(); s.deleteArtifact(p.id, a.id); }}><Icon name="ri-delete-bin-6-line" /></button></span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="side-foot">
        {s.settings.expert && <div className={`side-item ${s.view === 'designer' ? 'active' : ''}`} onClick={() => s.setView('designer')}><span className="ico"><Icon name="ri-puzzle-line" /></span><span className="lbl">模板编辑器</span></div>}
        <div className={`side-item ${s.view === 'settings' ? 'active' : ''}`} onClick={() => s.setView('settings')}><span className="ico"><Icon name="ri-settings-3-line" /></span><span className="lbl">设置与模型</span></div>
      </div>
    </aside>
  );
}

export function StatusBar() {
  const s = useStore();
  const running = s.run.running;
  const cur = s.run.log.filter((l) => l.status === 'running').pop();
  return (
    <div className="statusbar">
      <span><span className={`dot ${running ? 'busy' : ''}`} />{running ? `运行中：${cur?.roleName ?? '…'}` : '就绪'}</span>
      <span>{s.registry.list().length} 个模板</span>
      <span>{s.projects.length} 个项目 · {s.projects.reduce((a, p) => a + p.artifacts.length, 0)} 份作品</span>
      <span className="spacer" />
      <span>{s.settings.demoMode ? '演示模式（未调用真实 AI）' : `文本：${s.settings.text.model}${s.settings.image.enabled ? ' · 图像：' + s.settings.image.model : ''}${s.settings.video.enabled ? ' · 视频：已配置' : ''}`}</span>
      <span>{s.savedAt ? `已保存 · ${new Date(s.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '数据自动保存到本地'}</span>
    </div>
  );
}

export function Toasts() {
  const s = useStore();
  return <div className="toasts">{s.toasts.slice(-3).map((t) => <div key={t.id} className={`toast ${t.kind}`}><span style={{ flex: 1 }}>{t.text}</span>{t.action && <button className="toast-act" onClick={t.action.fn}>{t.action.label}</button>}</div>)}</div>;
}

export function NewDialog() {
  const s = useStore();
  const d = s.newDialog!;
  const m = s.manifestOf(d.typeId);
  const [seed, setSeed] = useState(d.seed ?? '');
  const [title, setTitle] = useState('');
  const [pid, setPid] = useState(s.current?.projectId ?? s.projects[0]?.id ?? '__new');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  if (!m) return null;
  const submit = (autoRun: boolean) => {
    if (!seed.trim()) { s.toast('请先写一句话描述你的想法', 'error'); return; }
    let projectId = pid;
    if (pid === '__new') projectId = s.newProject('新项目').id;
    if (autoRun) s.createArtifact(m.id, seed.trim(), { title: title.trim() || undefined, projectId, autoRun });
    else s.planIntent(seed.trim(), { templateId: m.id, title: title.trim() || undefined });
    s.setNewDialog(null);
  };
  return (
    <div className="modal-mask" onMouseDown={() => s.setNewDialog(null)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-h"><Icon name={m.icon} size={18} />用模板「{m.name}」开始<span className="spacer" /><button className="icon-btn" onClick={() => s.setNewDialog(null)}><Icon name="ri-close-line" /></button></div>
        <div className="modal-b">
          <div className="hint" style={{ marginBottom: 12 }}>{m.description}</div>
          <div className="field">
            <label>意图（一句话即可，越往后越精细）</label>
            <textarea ref={ref} className="textarea" rows={3} value={seed} placeholder={m.seedPlaceholder ?? '描述你想要的内容'} onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(true); }} />
          </div>
          <div className="grid2">
            <div className="field"><label>标题（可选）</label><input className="input" value={title} placeholder="默认取种子前 24 字" onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="field"><label>放入项目</label>
              <select className="select" value={pid} onChange={(e) => setPid(e.target.value)}>
                {s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="__new">新建项目…</option>
              </select>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="hint">{s.settings.expert ? '检查点：' : '步骤：'}</span>
            {m.stages.map((st, i) => <span key={st.id} className="chip">{i + 1}. {st.name}</span>)}
          </div>
        </div>
        <div className="modal-f">
          <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> 创建并生成</span>
          <button className="btn" onClick={() => submit(false)}><Icon name="ri-route-line" />先看看步骤</button>
          <button className="btn primary" onClick={() => submit(true)}>直接开始「{m.stages[0].name}」</button>
        </div>
      </div>
    </div>
  );
}

/** 应用内对话框（中文按钮，替代原生 confirm） */
export function AppDialog() {
  const s = useStore();
  const d = s.dialog;
  useEffect(() => {
    if (!d) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); d.resolve(false); } if (e.key === 'Enter') { e.preventDefault(); d.resolve(true); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [d]);
  if (!d) return null;
  return (
    <div className="modal-mask" onMouseDown={() => d.resolve(false)}>
      <div className="modal" style={{ width: 440 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-h">{d.danger ? <Icon name="ri-error-warning-line" style={{ color: 'var(--err)' }} /> : <Icon name="ri-question-line" />}{d.title}</div>
        {d.body && <div className="modal-b" style={{ color: 'var(--text2)' }}>{d.body}</div>}
        <div className="modal-f">
          {d.cancel !== null && <button className="btn" onClick={() => d.resolve(false)}>{d.cancel ?? '取消'}</button>}
          <button className={`btn ${d.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => d.resolve(true)}>{d.ok ?? '确定'}</button>
        </div>
      </div>
    </div>
  );
}

/** 存为模板：命名 + 说明 + 明确“保存的是流程，不含内容” */
export function SaveTemplateDialog() {
  const s = useStore();
  const d = s.saveTpl!;
  const [name, setName] = useState(d.name.slice(0, 24));
  const [desc, setDesc] = useState('');
  const save = async () => { if (!name.trim()) return; const r = await s.saveAsTemplate(d.m, name.trim(), desc.trim() || undefined); if (r.ok) s.setSaveTpl(null); };
  return (
    <div className="modal-mask" onMouseDown={() => s.setSaveTpl(null)}>
      <div className="modal" style={{ width: 480 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-h"><Icon name="ri-bookmark-line" />存为模板<span className="spacer" /><button className="icon-btn" onClick={() => s.setSaveTpl(null)}><Icon name="ri-close-line" /></button></div>
        <div className="modal-b">
          <div className="field"><label>模板名称</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></div>
          <div className="field"><label>一句话说明（可选）</label><input className="input" value={desc} placeholder="例如：适合 2~5 天的团队活动" onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}><span className="hint">将保存 {d.m.stages.length} 个步骤：</span>{d.m.stages.map((st, i) => <span key={st.id} className="chip">{i + 1}. {st.name}</span>)}</div>
          <div className="hint"><Icon name="ri-information-line" /> 保存的是<b>流程</b>（步骤与 AI 分工），不包含当前内容。下次遇到同类事情可以直接复用。</div>
        </div>
        <div className="modal-f"><button className="btn" onClick={() => s.setSaveTpl(null)}>取消</button><button className="btn primary" disabled={!name.trim()} onClick={save}>保存模板</button></div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + Enter', '运行 / 开始规划'], ['Esc', '停止正在运行的 AI'], ['Ctrl + Z', '撤销（回到上一个版本）'], ['Ctrl + Shift + Z / Ctrl + Y', '重做'],
  ['方向键 上 / 下', '在部分之间移动选择'], ['F2', '重命名选中的部分（属性面板）'], ['Delete', '删除选中的部分（可撤销）'], ['Ctrl + Shift + C', '复制为 Markdown'], ['?', '打开这张快捷键表'],
];
export function HelpDialog() {
  const s = useStore();
  return (
    <div className="modal-mask" onMouseDown={() => s.setHelpOpen(false)}>
      <div className="modal" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-h"><Icon name="ri-keyboard-line" />快捷键<span className="spacer" /><button className="icon-btn" onClick={() => s.setHelpOpen(false)}><Icon name="ri-close-line" /></button></div>
        <div className="modal-b"><table className="kbd-table"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td>{k.split(' / ').map((x, i) => <span key={x}>{i > 0 && ' / '}{x.split(' + ').map((y, j) => <span key={y}>{j > 0 && ' + '}<span className="kbd">{y}</span></span>)}</span>)}</td><td>{v}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}

/** 方案对比：左 = 当前版本，右 = 选中的版本；按一级部分对齐，每部分可“采用此方案” */
export { CompareDialog } from './Compare';
