import { useCallback, useEffect, useRef, useState } from 'react';
import { dropPosFor, type DropPos } from '../../core';

/**
 * 指针拖拽（不依赖 HTML5 DnD：在 Windows 触控板、截图/验收的合成鼠标事件下都可靠）。
 * 拖拽源：把手调用 start(e, id, label)；落点：元素带 data-drop-id（可选 data-drop-inside="0" 禁止放入、data-drop-col 列）。
 */
export interface DropTarget { id: string; pos: DropPos; col?: string }
export function usePointerDrag(onDrop: (dragId: string, t: DropTarget) => void) {
  const [st, setSt] = useState<{ id: string; label: string; x: number; y: number; active: boolean; target?: DropTarget } | null>(null);
  const ref = useRef(st); ref.current = st;
  const drop = useRef(onDrop); drop.current = onDrop;
  const start = useCallback((e: React.PointerEvent, id: string, label: string) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    setSt({ id, label, x: e.clientX, y: e.clientY, active: false });
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const cur = ref.current; if (!cur) return;
      const active = cur.active || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4;
      let target: DropTarget | undefined;
      if (active) {
        const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-drop-id],[data-drop-col]') as HTMLElement | null;
        if (el) {
          const r = el.getBoundingClientRect();
          const tid = el.dataset.dropId;
          if (tid && tid !== cur.id) target = { id: tid, pos: dropPosFor((ev.clientY - r.top) / Math.max(1, r.height), el.dataset.dropInside !== '0'), col: el.dataset.col };
          else if (!tid && el.dataset.dropCol) target = { id: '', pos: 'inside', col: el.dataset.dropCol };
        }
      }
      setSt({ ...cur, x: ev.clientX, y: ev.clientY, active, target });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const cur = ref.current; setSt(null);
      if (cur?.active && cur.target) drop.current(cur.id, cur.target);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, []);
  useEffect(() => { document.body.classList.toggle('dragging', !!st?.active); }, [st?.active]);
  const dropClass = (id: string) => (st?.active && st.target?.id === id ? `drop-${st.target.pos}` : '') + (st?.active && st.id === id ? ' drag-src' : '');
  const colOver = (col: string) => !!st?.active && st.target?.col === col;
  const ghost = st?.active ? <div className="drag-ghost" style={{ left: st.x + 12, top: st.y + 8 }}>{st.label}{st.target ? <span>{st.target.pos === 'inside' ? (st.target.id ? ' → 成为子项' : ` → ${st.target.col}`) : st.target.pos === 'before' ? ' → 放在前面' : ' → 放在后面'}</span> : null}</div> : null;
  return { start, dropClass, colOver, ghost, dragging: !!st?.active };
}
