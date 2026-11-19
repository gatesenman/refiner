import { Icon } from '../icons/Icon';
import { useState } from 'react';
import { flatten, updateNode, moveNode, findNode, findParent } from '../../core';
import { usePointerDrag } from './drag';
import { useStore } from '../store';
import type { RProps } from './types';
import { enumColor, chgClass, ChangeTag, numInfo, MatDot, maturityMap } from './common';
import { useMemo } from 'react';
import { fmtNum } from '../../core';

export function TableView(P: RProps) {
  const { m, root, sel, onSelect, onChange } = P;
  const rows = flatten(root);
  const props = (m.nodeSchema?.props ?? []).filter((p) => p.type !== 'url');
  const [edit, setEdit] = useState<string | null>(null);
  const s = useStore();
  // 行拖拽：同级之间排序；拖到别的分组的行上 = 移到那一组（排在该行前/后）
  const dnd = usePointerDrag((id, t) => {
    const n = findNode(root, id); if (!n || !t.id) return;
    const r = moveNode(root, id, t.id, t.pos === 'inside' ? 'after' : t.pos);
    if (!r) { s.toast('不能放到它自己的下面', 'info'); return; }
    const moved = findParent(root, id)?.id !== findParent(r, id)?.id;
    const label = `${moved ? '移动' : '调整顺序'}「${n.title.slice(0, 16)}」`;
    onChange(r, label);
    s.toast(`已${label}`, 'info', { label: '撤销', fn: () => s.undo() });
  });
  const nums = useMemo(() => numInfo(root, m, P.art?.facts), [root, m, P.art?.facts]);
  const mats = useMemo(() => maturityMap(root, m), [root, m]);
  const setProp = (id: string, key: string, value: unknown, cur?: Record<string, unknown>) => {
    const n = findNode(root, id);
    const props = { ...(cur ?? {}) };
    if (value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value))) delete props[key]; else props[key] = value;
    // 手动填过的数字不再算“推断”
    const inferred = n?.inferred?.filter((k) => k !== key);
    onChange(updateNode(root, id, { props, inferred: inferred?.length ? inferred : undefined }), '编辑属性');
  };
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 22 }} />
            <th style={{ width: 36 }}>#</th>
            <th style={{ minWidth: 220 }}>标题</th>
            <th style={{ minWidth: 200 }}>说明</th>
            {props.map((p) => <th key={p.key}>{p.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth }, i) => {
            const isGroup = !!node.children?.length;
            return (
              <tr key={node.id} className={`${sel === node.id ? 'sel' : ''} ${isGroup && depth === 1 ? 'grp' : ''} ${chgClass(P, node.id)} ${dnd.dropClass(node.id)}`} onClick={() => onSelect(node.id)} data-drop-id={node.id} data-drop-inside="0" data-node-id={node.id}>
                <td className="dh" title="拖动排序" onPointerDown={(e) => dnd.start(e, node.id, node.title)} onClick={(e) => e.stopPropagation()}><Icon name="ri-draggable" /></td>
                <td className="muted">{i + 1}</td>
                <td className="edit" style={{ paddingLeft: 10 + (depth - 1) * 18 }} onDoubleClick={() => setEdit(node.id + ':title')}>
                  {edit === node.id + ':title' ? (
                    <input autoFocus defaultValue={node.title} style={{ width: '100%' }} onBlur={(e) => { setEdit(null); if (e.target.value !== node.title) onChange(updateNode(root, node.id, { title: e.target.value }), '编辑标题'); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  ) : (<>{isGroup && <Icon name="ri-arrow-down-s-line" className="muted" />}<MatDot mm={mats.get(node.id)} />{node.title}{node.locked && <Icon name="ri-lock-line" className="mark" title="已锁定" />}{node.pinned?.length ? <Icon name="ri-pushpin-2-fill" className="mark pin" title="手动编辑过（AI 不会改动）" /> : null}<ChangeTag p={P} id={node.id} /></>)}
                </td>
                <td className="edit muted" onDoubleClick={() => setEdit(node.id + ':content')} style={{ maxWidth: 360 }}>
                  {edit === node.id + ':content' ? (
                    <textarea autoFocus defaultValue={node.content ?? ''} style={{ width: '100%', minHeight: 60 }} onBlur={(e) => { setEdit(null); if (e.target.value !== (node.content ?? '')) onChange(updateNode(root, node.id, { content: e.target.value }), '编辑说明'); }} />
                  ) : <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{node.content}</span>}
                </td>
                {props.map((p) => {
                  const v = node.props?.[p.key];
                  const c = enumColor(m, p.key, v);
                  if (p.type === 'enum') {
                    return (
                      <td key={p.key}>
                        <select value={v == null ? '' : String(v)} onClick={(e) => e.stopPropagation()} onChange={(e) => setProp(node.id, p.key, e.target.value, node.props)} style={c ? { color: c } : undefined}>
                          <option value="">—</option>
                          {p.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                    );
                  }
                  const k = node.id + ':' + p.key;
                  const ni = p.type === 'number' ? nums.find((x) => x.key === p.key) : undefined;
                  const ru = ni?.map.get(node.id);
                  if (ni && isGroup && edit !== k) {
                    // 分组行：子项小计；自身有值时作为这一组的预算，超出标红
                    return (
                      <td key={p.key} className={`edit num sub ${ru?.over ? 'over' : ''}`} onDoubleClick={() => setEdit(k)} title={ru?.over ? `子项合计 ${fmtNum(ru.sum, ni.unit)}，超出这一组的预算 ${fmtNum(ru.own!, ni.unit)}` : '子项小计（双击可填这一组的预算）'}>
                        {ru && ru.count ? <>{fmtNum(ru.sum, ni.unit)}{ru.over ? <span className="over-t"> 超 {fmtNum(ru.over, ni.unit)}</span> : null}</> : <span className="muted">—</span>}
                      </td>
                    );
                  }
                  const inf = node.inferred?.includes(p.key);
                  return (
                    <td key={p.key} className={`edit ${ni ? 'num' : ''}`} onDoubleClick={() => setEdit(k)} style={p.type === 'text' ? { maxWidth: 260, color: 'var(--text2)' } : { whiteSpace: 'nowrap' }}>
                      {edit === k ? (
                        <input autoFocus type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'} defaultValue={v == null ? '' : String(v)} onBlur={(e) => { setEdit(null); const nv = p.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value; if (String(nv) !== String(v ?? '')) setProp(node.id, p.key, nv, node.props); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                      ) : v == null ? <span className="muted">—</span> : ni && typeof v === 'number' ? <>{fmtNum(v, ni.unit)}{inf && <span className="inf" title="从说明文字里推断的，双击可改">推断</span>}</> : String(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {nums.some((x) => x.map.get(root.id)?.count) && (
          <tfoot>
            <tr className="total">
              <td /><td /><td><b>合计</b>（{rows.filter((r) => !r.node.children?.length).length} 项）</td><td />
              {props.map((p) => {
                const ni = nums.find((x) => x.key === p.key);
                const r = ni?.map.get(root.id);
                if (!ni || !r?.count) return <td key={p.key} />;
                const cap = r.own ?? ni.budget;
                const over = cap != null && r.sum > cap ? r.sum - cap : 0;
                return <td key={p.key} className={`num ${over ? 'over' : ''}`} title={cap != null ? `总预算 ${fmtNum(cap, ni.unit)}${r.own == null ? '（来自你确认的事实）' : ''}` : ''}><b>{fmtNum(r.sum, ni.unit)}</b>{cap != null && <div className="muted" style={{ fontSize: 11 }}>{over ? <span className="over-t">超出预算 {fmtNum(over, ni.unit)}</span> : `预算 ${fmtNum(cap, ni.unit)} · 余 ${fmtNum(cap - r.sum, ni.unit)}`}</div>}</td>;
              })}
            </tr>
          </tfoot>
        )}
      </table>
      {dnd.ghost}
      {!rows.length && <div className="empty">暂无内容，先在右侧运行「生成」</div>}
    </div>
  );
}
