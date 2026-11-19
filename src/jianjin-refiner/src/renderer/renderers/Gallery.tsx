import { Icon } from '../icons/Icon';
import { useState } from 'react';
import type { RProps } from './types';
import { PropChips } from './common';
import { useStore } from '../store';
import { buildProviders } from '../settings';

export function GalleryView({ m, root, sel, onSelect, onChange }: RProps) {
  const store = useStore();
  const storyboard = m.rendererOptions?.mode === 'storyboard';
  const items = root.children ?? [];
  const [polling, setPolling] = useState(false);
  const total = items.reduce((a, c) => a + (Number(c.props?.duration) || 0), 0);
  // 字段名全部来自 manifest.media 声明，画廊积木不认识“图片/视频”
  const media = m.media;
  const of = media?.outputField ?? 'url';
  const pf = media?.promptField ?? 'prompt';
  const rootJob = media?.scope === 'root';
  const nodeOut = rootJob ? 'url' : of;
  const vs = rootJob ? root.props?.[of + 'Status'] as string | undefined : undefined;
  const msg = rootJob ? root.props?.[of + 'Message'] : undefined;
  const outUrl = rootJob ? root.props?.[of] : undefined;
  const capName = media?.capability ?? '媒体';

  const poll = async () => {
    const id = root.props?.[of + 'Job'] as string | undefined;
    const p = media ? buildProviders(store.settings).media?.[media.capability] : undefined;
    if (!id) return;
    if (!p?.poll) { store.toast(`「${capName}」服务未配置`, 'error'); return; }
    setPolling(true);
    try {
      const r = await p.poll(id);
      onChange({ ...root, props: { ...root.props, [of + 'Status']: r.status, [of]: r.urls?.[0] ?? root.props?.[of], [of + 'Message']: r.message } }, '刷新任务状态');
    } catch (e: any) { store.toast(String(e?.message ?? e), 'error'); } finally { setPolling(false); }
  };

  return (
    <div>
      {storyboard && (
        <>
          <div className="banner" style={{ marginBottom: 0 }}>
            <Icon name="ri-film-line" size={20} />
            <div style={{ flex: 1 }}>
              <b>{root.title}</b>
              <div className="muted" style={{ fontSize: 12 }}>{items.length} 个镜头 · 合计 {total} 秒 {root.content ? '· ' + root.content : ''}</div>
            </div>
          </div>
          {vs === 'unconfigured' && (
            <div className="banner warn"><Icon name="ri-error-warning-line" size={16} /><div style={{ flex: 1 }}><b>未生成「{capName}」结果</b>：{String(msg ?? '未配置服务')}。本应用不会伪造结果——当前交付物为分镜脚本，可导出 CSV / Markdown。</div><button className="btn sm" onClick={() => store.setView('settings')}>配置服务</button></div>
          )}
          {vs && vs !== 'unconfigured' && (
            <div className="banner">
              <Icon name="ri-movie-2-line" />
              <div style={{ flex: 1 }}>「{capName}」任务 <span className="mono">{String(root.props?.[of + 'Job'] ?? '')}</span>：<b>{({ queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败' } as Record<string, string>)[vs] ?? vs}</b> {msg ? `（${String(msg)}）` : ''}</div>
              {vs !== 'succeeded' && <button className="btn sm" disabled={polling} onClick={poll}>{polling ? '查询中…' : '刷新状态'}</button>}
            </div>
          )}
          {typeof outUrl === 'string' && (
            <div style={{ padding: '14px 16px 0' }}><video src={outUrl} controls style={{ width: '100%', maxHeight: 420, borderRadius: 10, background: '#000' }} /></div>
          )}
        </>
      )}
      <div className="gallery" style={storyboard ? { gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' } : undefined}>
        {items.map((n, i) => {
          const url = n.props?.[nodeOut] as string | undefined;
          return (
            <div key={n.id} className={`gcard ${sel === n.id ? 'sel' : ''}`} onClick={() => onSelect(n.id)}>
              <div className={`gimg ${storyboard ? 'wide' : ''}`} style={storyboard && !url ? { background: `linear-gradient(135deg, hsl(${(i * 47) % 360},35%,26%), hsl(${(i * 47 + 60) % 360},40%,16%))`, color: '#fff' } : undefined}>
                {url ? <img src={url} alt={n.title} draggable={false} /> : storyboard ? (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 30, fontWeight: 800, opacity: .9 }}>镜头 {i + 1}</div>
                    <div style={{ fontSize: 12, opacity: .75, marginTop: 4 }}>{String(n.props?.shot ?? '')} · {String(n.props?.camera ?? '')} · {String(n.props?.duration ?? '?')}s</div>
                  </div>
                ) : <div style={{ textAlign: 'center', padding: 16, lineHeight: 1.6 }}>{n.props?.[nodeOut + 'Error'] ? <span style={{ color: 'var(--err)' }}>生成失败：{String(n.props[nodeOut + 'Error'])}</span> : `尚未生成「${capName}」\n（未配置服务时仅保留提示词）`}</div>}
              </div>
              <div className="gbody">
                <div className="gt">{storyboard && <span className="muted">#{i + 1} </span>}{n.title}{n.locked && <Icon name="ri-lock-line" className="mark" title="已锁定" />}{n.pinned?.length ? <Icon name="ri-pushpin-2-fill" className="mark pin" title="手动编辑过（AI 不会改动）" /> : null}</div>
                {n.content && <div className="gp">{n.content}</div>}
                {n.props?.[pf] != null && <div className="gp"><span className="muted">提示词：</span>{String(n.props[pf])}</div>}
                {storyboard && n.props?.voice ? <div className="gp"><Icon name="ri-mic-line" /> {String(n.props.voice)}</div> : null}
                <PropChips m={m} node={n} skip={[pf, 'voice']} />
              </div>
            </div>
          );
        })}
      </div>
      {!items.length && <div className="empty" style={{ height: 300 }}>暂无内容，先在右侧运行「{m.stages[0].name}」</div>}
    </div>
  );
}
