import { Icon } from '../icons/Icon';
import { flatten, updateNode, moveNode, findNode } from '../../core';
import { usePointerDrag } from './drag';
import { useStore } from '../store';
import type { RProps } from './types';
import { PropChips, enumColor , chgClass, ChangeTag } from './common';

export function BoardView(P: RProps) {
  const { m, root, sel, onSelect, onChange } = P;
  const enumProps = (m.nodeSchema?.props ?? []).filter((p) => p.type === 'enum');
  const groupKey = (m.rendererOptions?.groupBy as string) ?? enumProps[0]?.key;
  const gp = enumProps.find((p) => p.key === groupKey) ?? enumProps[0];
  const s = useStore();
  const dnd = usePointerDrag((id, t) => {
    const n = findNode(root, id); if (!n || !gp) return;
    const col = t.col && t.col !== '未设置' ? t.col : undefined;
    let r = root;
    // 放到某张卡片前/后：先在树里排到它旁边，再改所在列
    if (t.id) { const mv = moveNode(root, id, t.id, t.pos === 'inside' ? 'after' : t.pos); if (mv) r = mv; }
    const curCol = n.props?.[gp.key];
    if (col && col !== curCol) r = updateNode(r, id, { props: { ...(n.props ?? {}), [gp.key]: col } });
    if (r === root) return;
    const label = col && col !== curCol ? `把「${n.title.slice(0, 16)}」移到「${col}」` : `调整「${n.title.slice(0, 16)}」的顺序`;
    onChange(r, label);
    s.toast(`已${label}`, 'info', { label: '撤销', fn: () => s.undo() });
  });
  if (!gp) return <div className="empty">此类型没有枚举属性，无法以看板展示</div>;
  const cards = flatten(root, { leavesOnly: true });
  const cols = [...gp.options!, '未设置'];
  return (
    <div className="board">
      {cols.map((col) => {
        const list = cards.filter(({ node }) => (node.props?.[gp.key] == null || node.props?.[gp.key] === '' ? '未设置' : String(node.props?.[gp.key])) === col);
        if (col === '未设置' && !list.length) return null;
        const c = enumColor(m, gp.key, col);
        return (
          <div key={col} className={`bcol ${dnd.colOver(col) ? 'over' : ''}`} data-drop-col={col}>
            <div className="bcol-h"><span style={{ width: 8, height: 8, borderRadius: 4, background: c ?? 'var(--text3)' }} />{col}<span className="muted" style={{ fontWeight: 400 }}>{list.length}</span><span className="spacer" /><span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{gp.label}</span></div>
            <div className="bcol-b">
              {list.map(({ node, path }) => (
                <div key={node.id} className={`bcard ${sel === node.id ? 'sel' : ''} ${chgClass(P, node.id)} ${dnd.dropClass(node.id)}`} data-drop-id={node.id} data-drop-inside="0" data-col={col} data-node-id={node.id}
                  onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button,select,input')) dnd.start(e, node.id, node.title); }} onClick={() => onSelect(node.id)}>
                  {path.length > 0 && <div className="bp">{path.join(' / ')}</div>}
                  <div className="bt">{node.title}{node.locked && <Icon name="ri-lock-line" className="mark" title="已锁定" />}{node.pinned?.length ? <Icon name="ri-pushpin-2-fill" className="mark pin" title="手动编辑过（AI 不会改动）" /> : null}<ChangeTag p={P} id={node.id} /></div>
                  {node.content && <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 5 }}>{node.content.slice(0, 80)}</div>}
                  <PropChips m={m} node={node} skip={[gp.key]} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {dnd.ghost}
    </div>
  );
}
