import { Icon } from '../icons/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flatten } from '../../core';
import type { RProps } from './types';

const DAY = 86400000;
const parse = (s: unknown) => { const t = Date.parse(String(s ?? '') + 'T00:00:00'); return isNaN(t) ? null : t; };

export function TimelineView({ root, sel, onSelect }: RProps) {
  const rows = flatten(root);
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(800);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - 250));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length > 0]); // eslint-disable-line
  const { min, days, px } = useMemo(() => {
    const ts = rows.flatMap(({ node }) => [parse(node.props?.start), parse(node.props?.end)]).filter((x): x is number => x != null);
    if (!ts.length) return { min: Date.now(), days: 30, px: 24 };
    const min = Math.min(...ts) - 2 * DAY;
    const max = Math.max(...ts) + 3 * DAY;
    const days = Math.ceil((max - min) / DAY);
    return { min, days, px: Math.max(6, Math.min(32, Math.floor(avail / days))) };
  }, [rows, avail]);
  const width = days * px;
  const months: { x: number; label: string }[] = [];
  const weeks: { x: number; label: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(min + i * DAY);
    if (d.getDate() === 1 || i === 0) months.push({ x: i * px, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
    if (d.getDay() === 1) weeks.push({ x: i * px, label: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  const today = (Date.now() - min) / DAY * px;
  if (!rows.length) return <div className="empty">暂无内容，先在右侧运行「生成」</div>;
  return (
    <div className="tl" ref={ref}>
      <div className="tl-left">
        <div className="tl-head" style={{ display: 'flex', alignItems: 'center', padding: '0 10px', fontWeight: 600, color: 'var(--text2)' }}>事项</div>
        {rows.map(({ node, depth }) => (
          <div key={node.id} className={`tl-row ${node.children?.length ? 'grp' : ''} ${sel === node.id ? 'sel' : ''}`} style={{ paddingLeft: 10 + (depth - 1) * 16 }} onClick={() => onSelect(node.id)} title={node.title}>
            {node.props?.milestone === '是' && <Icon name="ri-flag-2-fill" style={{ color: 'var(--warn)', marginRight: 4 }} title="里程碑" />}{node.title}
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', width }}>
        <div className="tl-head" style={{ position: 'sticky', width }}>
          {months.map((m) => <div key={m.x} style={{ position: 'absolute', left: m.x + 4, top: 2, fontSize: 11, fontWeight: 600, color: 'var(--text2)' }}>{m.label}</div>)}
          {weeks.map((w) => <div key={w.x} style={{ position: 'absolute', left: w.x, top: 18, fontSize: 10.5, color: 'var(--text3)', borderLeft: '1px solid var(--border2)', paddingLeft: 3, height: 16 }}>{w.label}</div>)}
        </div>
        {weeks.map((w) => <div key={'g' + w.x} style={{ position: 'absolute', left: w.x, top: 34, bottom: 0, borderLeft: '1px dashed var(--border)' }} />)}
        {today > 0 && today < width && <div style={{ position: 'absolute', left: today, top: 34, bottom: 0, borderLeft: '2px solid var(--err)', opacity: .7, zIndex: 1 }} title="今天" />}
        {rows.map(({ node }) => {
          const s = parse(node.props?.start), e = parse(node.props?.end);
          const grp = !!node.children?.length;
          const ms = node.props?.milestone === '是';
          return (
            <div key={node.id} style={{ position: 'relative', height: 32, borderBottom: '1px solid var(--border)' }}>
              {s != null && e != null && (ms && !grp ? (
                <div onClick={() => onSelect(node.id)} title={`${node.title} ${node.props?.end}`} style={{ position: 'absolute', left: (e - min) / DAY * px - 7, top: 9, width: 14, height: 14, transform: 'rotate(45deg)', background: 'var(--warn)', cursor: 'pointer', outline: sel === node.id ? '2px solid var(--text)' : undefined }} />
              ) : (
                <div className={`tl-bar ${grp ? 'grp' : ''} ${sel === node.id ? 'sel' : ''}`} onClick={() => onSelect(node.id)}
                  style={{ left: (s - min) / DAY * px, width: Math.max(px, (e - s) / DAY * px + px) }} title={`${node.title}：${node.props?.start} → ${node.props?.end}`}>
                  {!grp && `${node.title}${node.props?.owner ? ' · ' + node.props.owner : ''}`}
                </div>
              ))}
              {(s == null || e == null) && <span className="muted" style={{ position: 'absolute', left: 8, top: 8, fontSize: 11 }}>（缺少起止日期，细化后补全）</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
