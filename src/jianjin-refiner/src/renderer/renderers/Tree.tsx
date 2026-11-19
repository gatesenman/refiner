import { Icon } from '../icons/Icon';
import { useRef, useState } from 'react';
import { addChild, removeNode, updateNode, uid, moveNode, indentNode, outdentNode, insertSiblingAfter, findNode, findParent, flatten } from '../../core';
import type { ArtNode } from '../../core';
import type { RProps } from './types';
import { PropChips, chgClass, ChangeTag, numInfo, Subtotal, MatDot, maturityMap } from './common';
import { useMemo } from 'react';
import { usePointerDrag } from './drag';
import { useStore } from '../store';

const short = (t: string) => (t.length > 16 ? t.slice(0, 16) + '…' : t || '空行');

/** 大纲：单击选中、双击 / F2 / Enter 编辑标题；Enter 新建同级、Tab 缩进、Shift+Tab 提升、空行 Backspace 删除；拖动左侧把手排序 / 移动层级 */
export function TreeView(P: RProps) {
  const { m, root, sel, onSelect, onChange } = P;
  const s = useStore();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const skipBlur = useRef(false);
  const editing = s.editingId;
  const setEditing = s.setEditingId;
  const mats = useMemo(() => (m.output === 'tree' ? maturityMap(root, m) : new Map()), [root, m]);
  const nums = useMemo(() => numInfo(root, m, P.art?.facts), [root, m, P.art?.facts]);
  const hl = new Set(s.hlIds);
  const toggle = (id: string) => setCollapsed((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const dnd = usePointerDrag((id, t) => {
    const n = findNode(root, id); if (!n || !t.id) return;
    const r = moveNode(root, id, t.id, t.pos);
    if (!r) { s.toast('不能放到它自己的下面', 'info'); return; }
    const tgt = findNode(root, t.id)!;
    const label = `移动「${short(n.title)}」${t.pos === 'inside' ? `到「${short(tgt.title)}」下` : t.pos === 'before' ? `到「${short(tgt.title)}」前` : `到「${short(tgt.title)}」后`}`;
    onChange(r, label);
    if (t.pos === 'inside') setCollapsed((x) => { const c = new Set(x); c.delete(t.id); return c; });
    onSelect(id);
    s.toast(`已${label}`, 'info', { label: '撤销', fn: () => s.undo() });
  });

  /** 行内编辑的键盘操作：先提交标题，再做结构动作（合成一个版本，撤销一步到位） */
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, n: ArtNode) => {
    const v = e.currentTarget.value;
    if (['Enter', 'Tab', 'Escape'].includes(e.key) || (e.key === 'Backspace' && v === '')) skipBlur.current = true;
    const base = v !== n.title ? updateNode(root, n.id, { title: v }) : root;
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const r = insertSiblingAfter(base, n.id);
      if (!r) return;
      setEditing(r.id); onSelect(r.id);
      onChange(r.root, n.id === root.id ? '新建子项' : `在「${short(v)}」后新建同级`);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const r = e.shiftKey ? outdentNode(base, n.id) : indentNode(base, n.id);
      if (!r) { skipBlur.current = false; return; }
      if (!e.shiftKey) { const p = findParent(base, n.id)!; const i = p.children!.findIndex((c) => c.id === n.id); const prev = p.children![i - 1]; setCollapsed((x) => { const c = new Set(x); c.delete(prev.id); return c; }); }
      onChange(r, `${e.shiftKey ? '提升' : '缩进'}「${short(v)}」`);
      setTimeout(() => setEditing(n.id), 0);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      setEditing(null);
      if (!n.title && n.id !== root.id) onChange(removeNode(root, n.id), '删除空行');
    } else if (e.key === 'Backspace' && v === '' && n.id !== root.id) {
      e.preventDefault();
      const ids = flatten(root).map((x) => x.node.id);
      const prev = ids[ids.indexOf(n.id) - 1];
      setEditing(prev ?? null); onSelect(prev);
      onChange(removeNode(root, n.id), `删除「${short(n.title)}」`);
    }
  };
  const commit = (n: ArtNode, v: string) => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    if (s.editingId === n.id) setEditing(null);
    if (!v.trim() && !n.title && n.id !== root.id) { onChange(removeNode(root, n.id), '删除空行'); return; }
    if (v !== n.title) onChange(updateNode(root, n.id, { title: v }), `改标题「${short(v)}」`);
  };

  const renderNode = (n: ArtNode, depth: number, num: string): JSX.Element => {
    const kids = n.children ?? [];
    const isCol = collapsed.has(n.id);
    return (
      <div key={n.id}>
        <div className={`onode d${depth} ${sel === n.id ? 'sel' : ''} ${P.multi?.includes(n.id) ? 'msel' : ''} ${depth > 0 ? chgClass(P, n.id) : ''} ${dnd.dropClass(n.id)} ${hl.has(n.id) ? 'hl-rough' : ''} ${n.kind === 'open-question' ? 'oq' : ''}`} style={{ marginLeft: (depth - (depth > 0 ? 1 : 0)) * 22 }}
          data-drop-id={n.id} data-node-id={n.id} tabIndex={sel === n.id ? 0 : -1}
          onClick={(e) => { e.stopPropagation(); onSelect(n.id, e.ctrlKey || e.metaKey); }}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(n.id); }}>
          {depth > 0 ? <span className="dh" title="拖动：排序 / 移到别的部分下" onPointerDown={(e) => dnd.start(e, n.id, n.title)} onClick={(e) => e.stopPropagation()}><Icon name="ri-draggable" /></span> : <span className="dh-sp" />}
          <span className="tw" onClick={(e) => { e.stopPropagation(); if (kids.length) toggle(n.id); }}>{kids.length ? <Icon name={isCol ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} /> : <Icon name="ri-circle-fill" style={{ fontSize: 5 }} />}</span>
          {depth > 0 && <span className="num">{num}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing === n.id ? (
              <input className="inline-edit" autoFocus defaultValue={n.title} placeholder={`输入${m.nodeSchema?.childLabel ?? '条目'}标题，Enter 新建同级，Tab 缩进`}
                onClick={(e) => e.stopPropagation()} onFocus={(e) => { skipBlur.current = false; e.currentTarget.select(); }}
                onBlur={(e) => commit(n, e.target.value)} onKeyDown={(e) => onKey(e, n)} />
            ) : (
              <div className="ttl" style={depth === 0 ? { fontSize: 18, fontWeight: 700 } : undefined}>
                {depth > 0 && <MatDot mm={mats.get(n.id)} />}
                {n.kind === 'open-question' && <span className="oq-tag" title="导入时发现的还没定的地方">待澄清</span>}
                <span className="ttl-t" title="双击或按 F2 编辑标题；Ctrl+单击可多选" onClick={(e) => { e.stopPropagation(); onSelect(n.id, e.ctrlKey || e.metaKey); }}>{n.title || <span className="muted">（空）</span>}</span> {n.locked && <span className="lock" title="已锁定"><Icon name="ri-lock-line" /></span>}{n.pinned?.length ? <span className="lock" title={`手动编辑过：${n.pinned.join(', ')}（AI 不会改动）`}><Icon name="ri-pushpin-2-fill" /></span> : null}
                {depth > 0 && <ChangeTag p={P} id={n.id} />}
                {kids.length > 0 && <Subtotal nodeId={n.id} nums={nums} isRoot={depth === 0} />}
                {isCol && kids.length > 0 && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>（{kids.length} 项已折叠）</span>}
              </div>
            )}
            {n.content && <div className="cnt">{n.content}</div>}
            <PropChips m={m} node={n} />
            {depth > 0 && P.changes?.has(n.id) && P.review?.whyOf?.(n.id) && <div className="chg-why"><Icon name="ri-chat-quote-line" />{P.review.whyOf(n.id)}</div>}
          </div>
          <div className="ohover">
            <button className="icon-btn" title="添加子项" onClick={(e) => { e.stopPropagation(); const c = { id: uid(), title: '' }; onChange(addChild(root, n.id, c), `在「${short(n.title)}」下添加子项`); setCollapsed((x) => { const y = new Set(x); y.delete(n.id); return y; }); onSelect(c.id); setEditing(c.id); }}><Icon name="ri-add-line" /></button>
            <button className="icon-btn" title={n.locked ? '解锁' : '锁定（后续阶段不可修改）'} onClick={(e) => { e.stopPropagation(); onChange(updateNode(root, n.id, { locked: !n.locked }), `${n.locked ? '解锁' : '锁定'}「${short(n.title)}」`); }}><Icon name={n.locked ? 'ri-lock-unlock-line' : 'ri-lock-line'} /></button>
            {depth > 0 && <button className="icon-btn" title="删除（Delete）" onClick={(e) => { e.stopPropagation(); onChange(removeNode(root, n.id), `删除「${short(n.title)}」`); if (sel === n.id) onSelect(undefined); }}><Icon name="ri-delete-bin-6-line" /></button>}
          </div>
        </div>
        {!isCol && kids.map((c, i) => renderNode(c, depth + 1, depth === 0 ? `${i + 1}` : `${num}.${i + 1}`))}
      </div>
    );
  };
  return <div className="outline" onClick={() => onSelect(undefined)}>{renderNode(root, 0, '')}{dnd.ghost}</div>;
}
