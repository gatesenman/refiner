import { Icon } from '../icons/Icon';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { TEXT_PRESETS, type Settings } from '../settings';
import { uid, validateTextConfig, checkBaseUrl, splitDetail, extractJSON, isLocalUrl, priceFor } from '../../core';
import { priceTable } from '../flow';

type TestRes = { level: 'ok' | 'warn' | 'bad'; text: string; detail?: string };

const unwrap = (r: any): string => (typeof r === 'string' ? r : String(r?.text ?? ''));

export function SettingsView() {
  const s = useStore();
  const [st, setSt] = useState<Settings>(s.settings);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<TestRes | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [adv, setAdv] = useState(false);
  const up = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => setSt({ ...st, [k]: typeof v === 'object' ? { ...(st[k] as object), ...v } : v });
  // 自动保存：字段变更 600ms 后写盘（不再需要“保存设置”按钮）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (JSON.stringify(st) === JSON.stringify(s.settings)) return;
    const t = setTimeout(() => s.saveSettings(st), 600);
    return () => clearTimeout(t);
  }, [st]); // eslint-disable-line
  useEffect(() => { setSt((cur) => ({ ...cur, theme: s.settings.theme, expert: s.settings.expert, fontScale: s.settings.fontScale })); }, [s.settings.theme, s.settings.expert, s.settings.fontScale]);
  const urlErr = checkBaseUrl(st.text.baseUrl);

  /** 三档测试：① 连通 ② 能否稳定输出 JSON → 可用 / 勉强可用 / 不可用 */
  const test = async () => {
    setTestRes(null); setShowDetail(false);
    const bad = validateTextConfig(st.text);
    if (bad) { setTestRes({ level: 'bad', text: bad.message }); return; }
    setTesting(true);
    try {
      const t0 = Date.now();
      const text = unwrap(await window.api.chat(uid('test'), st.text, { messages: [{ role: 'user', content: '请只回复四个字：连接成功' }], temperature: 0 }));
      const t1 = ((Date.now() - t0) / 1000).toFixed(1);
      let jsonOk = false; let jtext = '';
      try {
        jtext = unwrap(await window.api.chat(uid('test'), st.text, { messages: [{ role: 'system', content: '只输出 JSON，不要任何解释。' }, { role: 'user', content: '请只输出这个 JSON：{"ok": true, "items": ["a", "b"]}' }], temperature: 0 }));
        const j = extractJSON(jtext); jsonOk = !!j && typeof j === 'object' && j.ok === true;
      } catch { jsonOk = false; }
      if (jsonOk) setTestRes({ level: 'ok', text: `可用：连接正常（${t1} 秒），能按要求输出结构化内容。`, detail: `模型回复：${String(text).slice(0, 120)}` });
      else setTestRes({ level: 'warn', text: '能连通，但不能稳定输出结构化内容，结果可能不理想。建议换一个更强的模型。', detail: `连通测试回复：${String(text).slice(0, 120)}\n结构化测试回复：${jtext.slice(0, 200)}` });
    } catch (e: any) {
      const { message, detail } = splitDetail(String(e?.message ?? e));
      setTestRes({ level: 'bad', text: `不可用：${message}`, detail });
    } finally { setTesting(false); }
  };
  const switchReal = async () => { const n = { ...st, demoMode: false }; setSt(n); await s.saveSettings(n); s.toast(`已切换到真实模型：${st.text.model}`, 'success'); };

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 16, maxWidth: 760 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>设置与模型</h2>
        <span className="spacer" />
        <span className="hint"><Icon name="ri-save-3-line" /> 修改会自动保存</span>
      </div>

      <div className="form-card">
        <h3><Icon name="ri-toggle-line" /> 运行模式</h3>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <button className={`switch ${st.demoMode ? 'on' : ''}`} onClick={() => setSt({ ...st, demoMode: !st.demoMode })} style={{ marginTop: 2 }} />
          <div>
            <b>演示模式</b>
            <div className="hint">开启时不调用任何真实 AI，用内置示例体验完整流程，无需 API Key。配置好下面的模型并测试通过后，可以一键切换到真实模型。</div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span>主题</span>
          <div className="seg"><button className={st.theme === 'dark' ? 'on' : ''} onClick={() => setSt({ ...st, theme: 'dark' })}>深色</button><button className={st.theme === 'light' ? 'on' : ''} onClick={() => setSt({ ...st, theme: 'light' })}>浅色</button></div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="ri-chat-3-line" /> 文本模型（OpenAI 兼容接口）<span className="spacer" />
          <select className="select" style={{ width: 230 }} value={TEXT_PRESETS.find((x) => x.baseUrl === st.text.baseUrl)?.name ?? ''} onChange={(e) => { const p = TEXT_PRESETS.find((x) => x.name === e.target.value); if (p) { up('text', { baseUrl: p.baseUrl, model: p.model }); setTestRes(null); } }}>
            <option value="">选择服务商…</option>
            {TEXT_PRESETS.map((p) => <option key={p.name}>{p.name}</option>)}
          </select>
        </h3>
        <div className="hint" style={{ marginBottom: 10 }}>① 选择服务商（右上角）→ ② 粘贴 API Key → ③ 测试连接 → ④ 切换到真实模型</div>
        <div className="field"><label>API Key（仅保存在本机）</label><input className="input mono" type="password" value={st.text.apiKey} onChange={(e) => up('text', { apiKey: e.target.value.trim() })} placeholder={isLocalUrl(st.text.baseUrl) ? '本机模型可以留空' : 'sk-…'} />
          {!st.text.apiKey && !isLocalUrl(st.text.baseUrl) && <div className="hint" style={{ marginTop: 4 }}>还没有 Key？可以先用演示模式体验。</div>}</div>
        {(s.settings.expert || adv || urlErr) ? (<>
        <div className="field"><label>接口地址（Base URL）</label><input className={`input mono ${urlErr ? 'invalid' : ''}`} value={st.text.baseUrl} onChange={(e) => up('text', { baseUrl: e.target.value.trim() })} placeholder="https://api.deepseek.com/v1" />
          {urlErr && <div className="field-err">{urlErr}</div>}</div>
        </>) : <div className="hint" style={{ marginBottom: 10 }}>接口地址：<span className="mono">{st.text.baseUrl}</span>　<span className="link" onClick={() => setAdv(true)}>修改</span></div>}
        <ModelPicker value={st.text.model} baseUrl={st.text.baseUrl} apiKey={st.text.apiKey} onChange={(v) => up('text', { model: v })} />
        <div className="row">
          {s.settings.expert && <>
          <button className={`switch ${st.text.stream ? 'on' : ''}`} onClick={() => up('text', { stream: !st.text.stream })} /><span>流式输出（SSE）</span>
          <span className="muted" style={{ marginLeft: 12 }}>单次最多输出</span>
          <input className="input mono" style={{ width: 90 }} type="number" min={0} value={st.text.maxTokens ?? 0} onChange={(e) => up('text', { maxTokens: Number(e.target.value) || undefined })} title="0 = 不限制（由服务商默认）" />
          <span className="muted">tokens（0=不限）</span></>}
          <span className="spacer" />
          <button className="btn primary" disabled={testing} onClick={test}>{testing ? <><Icon name="ri-loader-4-line" className="spin" />测试中…</> : <><Icon name="ri-pulse-line" />测试连接</>}</button>
        </div>
        {testRes && (
          <div className={`test-res ${testRes.level}`}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Icon name={testRes.level === 'ok' ? 'ri-checkbox-circle-fill' : testRes.level === 'warn' ? 'ri-error-warning-fill' : 'ri-close-circle-fill'} />
              <span style={{ flex: 1 }}>{testRes.text}</span>
              {testRes.detail && <span className="link" onClick={() => setShowDetail(!showDetail)}>{showDetail ? '收起' : '详情'}</span>}
            </div>
            {showDetail && testRes.detail && <pre className="mono">{testRes.detail}</pre>}
            {testRes.level !== 'bad' && st.demoMode && (
              <div className="row" style={{ marginTop: 8 }}>
                <span style={{ flex: 1 }}>{testRes.level === 'ok' ? '连接成功，现在切换到真实模型吗？' : '仍然可以切换到这个模型试试。'}</span>
                <button className="btn sm primary" onClick={switchReal}><Icon name="ri-plug-line" />切换并保存</button>
              </div>
            )}
          </div>
        )}
      </div>

      {!s.settings.expert && <div className="hint" style={{ maxWidth: 760, margin: '0 0 14px' }}><Icon name="ri-information-line" /> 图像 / 视频接口、流式输出等高级选项在「专家模式」中显示（标题栏右上角开关）。</div>}
      {s.settings.expert && <><div className="form-card">
        <h3><Icon name="ri-image-2-line" /> 图像模型 <span className="spacer" /><button className={`switch ${st.image.enabled ? 'on' : ''}`} onClick={() => up('image', { enabled: !st.image.enabled })} /></h3>
        <div className="hint" style={{ marginBottom: 10 }}>OpenAI 兼容 <span className="mono">POST /images/generations</span>（OpenAI DALL·E / gpt-image、硅基流动、各类兼容网关）。未启用时，图片类型只生成并精化提示词。</div>
        <div className="field"><label>Base URL</label><input className="input mono" value={st.image.baseUrl} onChange={(e) => up('image', { baseUrl: e.target.value })} /></div>
        <div className="grid2">
          <div className="field"><label>API Key</label><input className="input mono" type="password" value={st.image.apiKey} onChange={(e) => up('image', { apiKey: e.target.value })} /></div>
          <div className="field"><label>模型 / 尺寸</label><div className="row"><input className="input mono" value={st.image.model} onChange={(e) => up('image', { model: e.target.value })} /><input className="input mono" style={{ width: 120 }} value={st.image.size} onChange={(e) => up('image', { size: e.target.value })} /></div></div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="ri-movie-2-line" /> 视频模型（异步任务接口）<span className="spacer" /><button className={`switch ${st.video.enabled ? 'on' : ''}`} onClick={() => up('video', { enabled: !st.video.enabled })} /></h3>
        <div className="hint" style={{ marginBottom: 10 }}>通用“提交 → 轮询”适配：提交接口 POST <span className="mono">{'{model, prompt, duration}'}</span>，返回 id/task_id；轮询地址中用 <span className="mono">{'{id}'}</span> 占位，自动识别 status 与 video_url 等常见字段。未配置时视频类型只产出剧本与分镜，<b>不会伪造视频</b>。</div>
        <div className="field"><label>提交地址</label><input className="input mono" value={st.video.submitUrl} onChange={(e) => up('video', { submitUrl: e.target.value })} placeholder="https://…/v1/video/generations" /></div>
        <div className="field"><label>轮询地址</label><input className="input mono" value={st.video.pollUrl} onChange={(e) => up('video', { pollUrl: e.target.value })} placeholder="https://…/v1/video/generations/{id}" /></div>
        <div className="grid2">
          <div className="field"><label>API Key</label><input className="input mono" type="password" value={st.video.apiKey} onChange={(e) => up('video', { apiKey: e.target.value })} /></div>
          <div className="field"><label>模型</label><input className="input mono" value={st.video.model} onChange={(e) => up('video', { model: e.target.value })} /></div>
        </div>
      </div></>}

      <WorkPrefs st={st} setSt={setSt} />
      <CostCard st={st} setSt={setSt} />
      <BackupCard st={st} setSt={setSt} />
      <UpdateCard st={st} setSt={setSt} />

      <div className="form-card">
        <h3><Icon name="ri-database-2-line" /> 数据</h3>
        <div className="hint" style={{ marginBottom: 10 }}>所有项目、设置、用户插件都保存在本机：<span className="mono">{s.info?.userData}</span></div>
        <div className="row"><button className="btn" onClick={() => window.api.openDataDir()}>打开数据文件夹</button><button className="btn" onClick={() => window.api.openPluginDir()}>打开插件文件夹</button></div>
      </div>
    </div>
  );
}

type CardP = { st: Settings; setSt: (s: Settings) => void };

function WorkPrefs({ st, setSt }: CardP) {
  const fs = st.fontScale ?? 1;
  return (
    <div className="form-card">
      <h3><Icon name="ri-equalizer-line" /> 使用习惯</h3>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <button className={`switch ${st.autoRunNext ? 'on' : ''}`} onClick={() => setSt({ ...st, autoRunNext: !st.autoRunNext })} style={{ marginTop: 2 }} />
        <div><b>进入下一步时自动开始</b><div className="hint">默认关闭：进入下一步后先停下，你可以先选好要修改的范围（“将修改：全部”或某一部分）再开始。</div></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <span><Icon name="ri-font-size" /> 界面大小</span>
        <div className="seg">{[0.9, 1, 1.1, 1.25, 1.4].map((v) => <button key={v} className={Math.abs(fs - v) < 0.01 ? 'on' : ''} onClick={() => setSt({ ...st, fontScale: v })}>{Math.round(v * 100)}%</button>)}</div>
        <span className="hint">快捷键 <span className="kbd">Ctrl</span>+<span className="kbd">=</span> 放大、<span className="kbd">Ctrl</span>+<span className="kbd">-</span> 缩小、<span className="kbd">Ctrl</span>+<span className="kbd">0</span> 还原</span>
      </div>
    </div>
  );
}

function CostCard({ st, setSt }: CardP) {
  const table = priceTable(st.prices);
  const model = st.text.model;
  const p = priceFor(model, table);
  const [show, setShow] = useState(false);
  const setPrice = (k: string, f: 'input' | 'output', v: number) => setSt({ ...st, prices: { ...(st.prices ?? {}), [k]: { ...(table[k] ?? { input: 0, output: 0 }), [f]: v } } });
  const b = st.budget ?? {};
  return (
    <div className="form-card" id="cost">
      <h3><Icon name="ri-coins-line" /> 费用与预算</h3>
      <div className="hint" style={{ marginBottom: 8 }}>每次运行都会记录 tokens 用量（服务商返回真实用量时用真实值，否则按字数估算），按下面的价目表折算费用。运行前，底部操作栏会显示预估。</div>
      <div className="row wrap" style={{ gap: 10 }}>
        <span>当前模型 <b className="mono">{model || '（未设置）'}</b> 的价格：</span>
        {p ? <span className="muted">输入 ¥{p.input} / 输出 ¥{p.output}（每百万 tokens）</span> : <span className="warn-t">价目表里没有这个模型，费用显示为“未设价格”</span>}
        {model && !table[model] && <button className="btn sm" onClick={() => setSt({ ...st, prices: { ...(st.prices ?? {}), [model]: p ?? { input: 0, output: 0 } } })}>为它单独设价</button>}
        <button className="btn sm ghost" onClick={() => setShow(!show)}>{show ? '收起价目表' : '查看/修改价目表'}</button>
      </div>
      {show && (
        <table className="grid price-table" style={{ marginTop: 8 }}>
          <thead><tr><th>模型（按前缀匹配）</th><th>输入 ¥/百万</th><th>输出 ¥/百万</th></tr></thead>
          <tbody>{Object.keys(table).map((k) => (
            <tr key={k}><td className="mono">{k}</td>
              <td><input className="input" type="number" min={0} step={0.1} value={table[k].input} onChange={(e) => setPrice(k, 'input', Number(e.target.value))} /></td>
              <td><input className="input" type="number" min={0} step={0.1} value={table[k].output} onChange={(e) => setPrice(k, 'output', Number(e.target.value))} /></td></tr>
          ))}</tbody>
        </table>
      )}
      <div className="row wrap" style={{ marginTop: 12, gap: 14 }}>
        <label className="row" style={{ gap: 6 }}>单次运行上限 ¥<input className="input" style={{ width: 90 }} type="number" min={0} step={0.01} placeholder="不限" value={b.perRun ?? ''} onChange={(e) => setSt({ ...st, budget: { ...b, perRun: e.target.value === '' ? undefined : Number(e.target.value) } })} /></label>
        <label className="row" style={{ gap: 6 }}>每个作品上限 ¥<input className="input" style={{ width: 90 }} type="number" min={0} step={0.1} placeholder="不限" value={b.perWork ?? ''} onChange={(e) => setSt({ ...st, budget: { ...b, perWork: e.target.value === '' ? undefined : Number(e.target.value) } })} /></label>
        <span className="hint">超过上限时不会运行，并告诉你原因。留空 = 不限。</span>
      </div>
      <div className="row wrap" style={{ marginTop: 12, gap: 14 }}>
        <label className="row" style={{ gap: 6 }}>多处一起改时同时处理
          <select className="select par-select" value={st.parallel ?? 3} onChange={(e) => setSt({ ...st, parallel: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n === 1 ? '1 处（依次）' : `${n} 处`}</option>)}
          </select></label>
        <span className="hint">“往下展开全部”“细化最粗的 3 处”和多选时生效。并行更快，但服务商有频率限制时可调小。</span>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', marginTop: 12 }}>
        <button className={`switch ${st.confirmEach ? 'on' : ''}`} onClick={() => setSt({ ...st, confirmEach: !st.confirmEach })} style={{ marginTop: 2 }} />
        <div><b>多处细化时逐处确认</b><div className="hint">改完一处先问你「保留 / 撤回」，再继续其余。打开后不再并行合并成一次审阅。</div></div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', marginTop: 12 }}>
        <button className={`switch ${(st.survey !== false) ? 'on' : ''}`} onClick={() => setSt({ ...st, survey: st.survey === false })} style={{ marginTop: 2 }} />
        <div><b>第一次铺整体前先多角度看一看</b><div className="hint">用「执行者 / 审查者 / 使用者」三个过程角色各写一段备忘，再开始生成。失败会自动跳过。</div></div>
      </div>
    </div>
  );
}

function BackupCard({ st, setSt }: CardP) {
  const s = useStore();
  const [list, setList] = useState<any[] | null>(null);
  const [enc, setEnc] = useState<boolean | null>(null);
  const load = () => window.api.backups().then(setList);
  useEffect(() => { load(); window.api.secureStatus().then((x: any) => setEnc(!!x?.available)); }, []);
  const R: Record<string, string> = { daily: '每日自动', manual: '手动', 'before-delete': '删除前', 'before-restore': '恢复前' };
  return (
    <div className="form-card">
      <h3><Icon name="ri-safe-2-line" /> 备份与安全</h3>
      <div className="hint">每天第一次打开时自动备份全部作品；删除项目、恢复备份前也会先备份。保留最近
        <input className="input" type="number" min={1} max={100} style={{ width: 60, margin: '0 6px' }} value={st.backupKeep ?? 10} onChange={(e) => setSt({ ...st, backupKeep: Math.max(1, Number(e.target.value) || 10) })} />份。</div>
      <div className="row" style={{ margin: '8px 0' }}>
        <button className="btn" onClick={async () => { await window.api.backup('manual'); await load(); s.toast('已备份', 'success'); }}><Icon name="ri-archive-line" />立即备份</button>
        <button className="btn ghost" onClick={() => window.api.openBackupDir()}>打开备份文件夹</button>
      </div>
      <div className="backup-list">
        {list === null ? <div className="hint">读取中…</div> : !list.length ? <div className="hint">还没有备份。</div> : list.map((b) => (
          <div key={b.id} className="row backup-i">
            <Icon name="ri-archive-line" className="muted" />
            <span>{new Date(b.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="chip">{R[b.reason] ?? b.reason}</span>
            <span className="muted">{b.projects} 个项目文件 · {(b.bytes / 1024).toFixed(0)} KB</span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => s.restoreBackup(b.id, new Date(b.at).toLocaleString('zh-CN'))}>恢复到这里</button>
          </div>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 10 }}><Icon name={enc ? 'ri-shield-check-line' : 'ri-error-warning-line'} /> API Key {enc ? '已加密保存（Windows 使用系统 DPAPI，只有当前用户能解密）' : enc === false ? '在本系统上无法使用系统加密，暂以明文保存在本机设置文件中' : '…'}</div>
    </div>
  );
}

function UpdateCard({ st, setSt }: CardP) {
  const s = useStore();
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => window.api.onUpdate(setState), []);
  const check = async () => { setBusy(true); try { setState(await window.api.checkUpdate(st.updateUrl ?? '')); } catch (e: any) { setState({ status: 'error', error: String(e?.message ?? e) }); } finally { setBusy(false); } };
  const txt = !state ? '' : state.status === 'latest' ? `已是最新版本（v${s.info?.version}）` : state.status === 'downloading' ? `发现新版本 v${state.version}，正在下载${state.percent ? ` ${state.percent}%` : '…'}` : state.status === 'ready' ? `新版本 v${state.version} 已下载好` : state.status === 'error' ? `检查失败：${state.error}` : '';
  return (
    <div className="form-card">
      <h3><Icon name="ri-download-cloud-2-line" /> 更新</h3>
      <div className="hint" style={{ marginBottom: 8 }}>当前版本 v{s.info?.version}。更新地址填放置 latest.yml 和安装包的目录（任何静态网站 / 对象存储 / 内网文件服务器均可），留空则不检查。</div>
      <div className="row">
        <input className="input mono" style={{ flex: 1 }} placeholder="例如 https://example.com/jianjin-refiner/" value={st.updateUrl ?? ''} onChange={(e) => setSt({ ...st, updateUrl: e.target.value })} />
        <button className="btn" disabled={busy || !st.updateUrl?.trim()} onClick={check}>{busy ? <Icon name="ri-loader-4-line" className="spin" /> : <Icon name="ri-refresh-line" />}检查更新</button>
        {state?.status === 'ready' && <button className="btn primary" onClick={() => window.api.installUpdate()}>重启并安装</button>}
      </div>
      {txt && <div className={`hint ${state?.status === 'error' ? 'warn-t' : ''}`} style={{ marginTop: 6 }}>{txt}</div>}
    </div>
  );
}

/** 模型：从服务商的 /models 读取列表做成下拉；读不到时仍可手填 */
function ModelPicker({ value, baseUrl, apiKey, onChange }: { value: string; baseUrl: string; apiKey: string; onChange: (v: string) => void }) {
  const [list, setList] = useState<string[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);
  const load = async () => {
    setBusy(true); setErr('');
    try { const r = await (window.api as any).listModels({ baseUrl, apiKey }); if (r?.ok && r.models?.length) { setList(r.models); setCustom(false); } else setErr(r?.error ? `读不到模型列表（${r.error}），可以直接手填` : '服务商没有返回模型列表，可以直接手填'); }
    finally { setBusy(false); }
  };
  useEffect(() => { setList(null); setErr(''); }, [baseUrl]);
  const opts = list ? [...new Set([value, ...list].filter(Boolean))] : [];
  return (
    <div className="field"><label>模型</label>
      <div className="row" style={{ gap: 6 }}>
        {list && !custom ? (
          <select className="select mono" style={{ flex: 1 }} value={value} onChange={(e) => (e.target.value === '__custom' ? setCustom(true) : onChange(e.target.value))}>
            {opts.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__custom">其他（手填）…</option>
          </select>
        ) : <input className="input mono" style={{ flex: 1 }} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="如 deepseek-chat" />}
        <button className="btn sm" disabled={busy || !baseUrl} onClick={load} title="从服务商读取可用模型"><Icon name={busy ? 'ri-loader-4-line' : 'ri-list-unordered'} className={busy ? 'spin' : ''} />{list ? '刷新列表' : '获取模型列表'}</button>
      </div>
      {err && <div className="hint" style={{ marginTop: 4 }}>{err}</div>}
      {list && <div className="hint" style={{ marginTop: 4 }}>共 {list.length} 个可用模型</div>}
    </div>
  );
}
