import { Icon, SvgIcon } from '../icons/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtNode } from '../../core';
import type { RProps } from './types';

const BRANCH = ['#5aa3ff', '#b277f0', '#3fb97f', '#e3a33a', '#ef5f6b', '#4fc1c9', '#f08bd0', '#9ccc65'];
const FONT = '"Segoe UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

export interface MNode { id: string; title: string; x: number; y: number; w: number; h: number; depth: number; color: string; locked?: boolean; pinned?: boolean; hasContent: boolean }
export interface MEdge { from: MNode; to: MNode; color: string }

let ctx: CanvasRenderingContext2D | null = null;
function measure(text: string, size: number, weight = 400) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  ctx!.font = `${weight} ${size}px ${FONT}`;
  return ctx!.measureText(text).width;
}

const trunc = (s: string, n = 26) => (s.length > n ? s.slice(0, n) + '…' : s);

export function layoutMindmap(root: ArtNode) {
  const nodes: MNode[] = [];
  const edges: MEdge[] = [];
  const GAP_Y = 10;
  const GAP_X = 54;
  let cursorY = 0;
  const place = (n: ArtNode, depth: number, x: number, color: string): MNode => {
    const size = depth === 0 ? 17 : depth === 1 ? 14 : 13;
    const label = trunc(n.title, depth === 0 ? 30 : 26);
    const marks = (n.locked ? 1 : 0) + (n.pinned?.length ? 1 : 0);
    const w = Math.ceil(measure(label, size, depth <= 1 ? 600 : 400)) + marks * (size + 4) + (depth === 0 ? 36 : 24);
    const h = depth === 0 ? 44 : depth === 1 ? 34 : 28;
    const me: MNode = { id: n.id, title: label, x, y: 0, w, h, depth, color, locked: n.locked, pinned: !!n.pinned?.length, hasContent: !!n.content };
    const kids = n.children ?? [];
    if (!kids.length) {
      me.y = cursorY + h / 2;
      cursorY += h + GAP_Y;
    } else {
      const placed = kids.map((c, i) => place(c, depth + 1, x + w + GAP_X, depth === 0 ? BRANCH[i % BRANCH.length] : color));
      me.y = (placed[0].y + placed[placed.length - 1].y) / 2;
      for (const c of placed) edges.push({ from: me, to: c, color: c.color });
      if (depth === 1) cursorY += 8;
    }
    nodes.push(me);
    return me;
  };
  place(root, 0, 0, '#6c7cff');
  const minY = Math.min(...nodes.map((n) => n.y - n.h / 2));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h / 2));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  return { nodes, edges, bounds: { x: -20, y: minY - 20, w: maxX + 40, h: maxY - minY + 40 } };
}

function edgePath(e: MEdge) {
  const x1 = e.from.x + e.from.w, y1 = e.from.y, x2 = e.to.x, y2 = e.to.y;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 导出为独立 SVG 字符串 */
export function mindmapSVG(root: ArtNode, dark: boolean): string {
  const { nodes, edges, bounds } = layoutMindmap(root);
  const bg = dark ? '#17181c' : '#ffffff';
  const fg = dark ? '#e3e5ea' : '#1f2329';
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.w}" height="${bounds.h}" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}" font-family='${FONT}'>`, `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${bg}"/>`];
  for (const e of edges) parts.push(`<path d="${edgePath(e)}" fill="none" stroke="${e.color}" stroke-width="${e.from.depth === 0 ? 2.5 : 1.6}" opacity="0.85"/>`);
  for (const n of nodes) {
    const fill = n.depth === 0 ? n.color : n.depth === 1 ? n.color + '2a' : (dark ? '#23262d' : '#f6f7fa');
    parts.push(`<rect x="${n.x}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="${n.depth === 0 ? 10 : 7}" fill="${fill}" stroke="${n.color}" stroke-width="${n.depth === 0 ? 0 : 1.2}"/>`);
    parts.push(`<text x="${n.x + n.w / 2}" y="${n.y + 1}" text-anchor="middle" dominant-baseline="middle" font-size="${n.depth === 0 ? 17 : n.depth === 1 ? 14 : 13}" font-weight="${n.depth <= 1 ? 600 : 400}" fill="${n.depth === 0 ? '#fff' : fg}">${esc(n.title)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

export function MindmapView({ root, sel, onSelect }: RProps) {
  const layout = useMemo(() => layoutMindmap(root), [root]);
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    const { w, h, x, y } = layout.bounds;
    const k = Math.min(1.3, Math.max(0.25, Math.min((el.clientWidth - 40) / w, (el.clientHeight - 40) / h)));
    setT({ k, x: (el.clientWidth - w * k) / 2 - x * k, y: (el.clientHeight - h * k) / 2 - y * k });
  };
  useEffect(fit, [layout.nodes.length]); // eslint-disable-line

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg className="mm"
        onWheel={(e) => {
          const r = (e.currentTarget as SVGElement).getBoundingClientRect();
          const px = e.clientX - r.left, py = e.clientY - r.top;
          const k2 = Math.min(3, Math.max(0.2, t.k * (e.deltaY < 0 ? 1.1 : 0.9)));
          setT({ k: k2, x: px - ((px - t.x) * k2) / t.k, y: py - ((py - t.y) * k2) / t.k });
        }}
        onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false }; }}
        onMouseMove={(e) => {
          const d = drag.current; if (!d) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
          setT((s) => ({ ...s, x: d.tx + e.clientX - d.x, y: d.ty + e.clientY - d.y }));
        }}
        onMouseUp={() => { setTimeout(() => (drag.current = null), 0); }}
        onMouseLeave={() => (drag.current = null)}
        onClick={() => { if (!drag.current?.moved) onSelect(undefined); }}>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {layout.edges.map((e) => <path key={e.from.id + e.to.id} d={edgePath(e)} fill="none" stroke={e.color} strokeWidth={e.from.depth === 0 ? 2.5 : 1.6} opacity={0.85} />)}
          {layout.nodes.map((n) => {
            const isSel = sel === n.id;
            const fill = n.depth === 0 ? n.color : n.depth === 1 ? n.color + '2a' : 'var(--card)';
            return (
              <g key={n.id} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (!drag.current?.moved) onSelect(n.id); }}>
                {isSel && <rect x={n.x - 4} y={n.y - n.h / 2 - 4} width={n.w + 8} height={n.h + 8} rx={10} fill="none" stroke="var(--warn)" strokeWidth={2} strokeDasharray="4 3" />}
                <rect x={n.x} y={n.y - n.h / 2} width={n.w} height={n.h} rx={n.depth === 0 ? 10 : 7} fill={fill} stroke={n.color} strokeWidth={n.depth === 0 ? 0 : 1.2} />
                {(() => {
                  const fs = n.depth === 0 ? 17 : n.depth === 1 ? 14 : 13;
                  const marks = (n.locked ? 1 : 0) + (n.pinned ? 1 : 0);
                  const tw = n.w - (n.depth === 0 ? 36 : 24) - marks * (fs + 4);
                  const cx = n.x + (n.w - marks * (fs + 4)) / 2;
                  const fg = n.depth === 0 ? '#fff' : 'var(--text)';
                  let ix = cx + tw / 2 + 4;
                  return (<>
                    <text x={cx} y={n.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight={n.depth <= 1 ? 600 : 400} fill={fg} style={{ fontFamily: FONT }}>{n.title}</text>
                    {n.locked && <SvgIcon name="ri-lock-line" x={ix} y={n.y - fs / 2} size={fs} color={fg} opacity={0.7} />}
                    {n.pinned && <SvgIcon name="ri-pushpin-2-fill" x={(ix += n.locked ? fs + 4 : 0)} y={n.y - fs / 2} size={fs} color="var(--accent)" />}
                  </>);
                })()}
                {n.hasContent && n.depth > 0 && <circle cx={n.x + n.w - 5} cy={n.y - n.h / 2 + 5} r={2.5} fill={n.color} />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="mm-tools">
        <button className="icon-btn" title="放大" onClick={() => setT((s) => ({ ...s, k: Math.min(3, s.k * 1.2) }))}><Icon name="ri-zoom-in-line" /></button>
        <button className="icon-btn" title="缩小" onClick={() => setT((s) => ({ ...s, k: Math.max(0.2, s.k / 1.2) }))}><Icon name="ri-zoom-out-line" /></button>
        <button className="icon-btn" title="适应窗口" onClick={fit}><Icon name="ri-fullscreen-line" /></button>
        <span className="muted" style={{ fontSize: 11, alignSelf: 'center', padding: '0 6px' }}>{Math.round(t.k * 100)}%</span>
      </div>
    </div>
  );
}
