import { Icon } from '../icons/Icon';
import type { ArtNode } from '../../core';
import type { RProps } from './types';
import { PropChips, chgClass, ChangeTag } from './common';

export function DocView(P: RProps) {
  const { m, root, sel, onSelect } = P;
  const li = (n: ArtNode): JSX.Element => (
    <li key={n.id} className={`${sel === n.id ? 'sel' : ''} ${chgClass(P, n.id)}`} onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}>
      <b style={{ color: 'var(--text)', fontWeight: 500 }}>{n.title}</b><ChangeTag p={P} id={n.id} />{n.content ? `：${n.content}` : ''}
      {!!n.children?.length && <ul>{n.children.map(li)}</ul>}
    </li>
  );
  return (
    <div className="doc" onClick={() => onSelect(undefined)}>
      <h1 onClick={(e) => { e.stopPropagation(); onSelect(root.id); }} style={{ cursor: 'pointer' }}>{root.title}</h1>
      {root.content && <div className="lead" style={{ whiteSpace: 'pre-line' }}>{root.content}</div>}
      <div className="dcards">
        {(root.children ?? []).map((c, i) => (
          <div key={c.id} className={`dcard ${sel === c.id ? 'sel' : ''} ${chgClass(P, c.id)}`} onClick={(e) => { e.stopPropagation(); onSelect(c.id); }}>
            <h3><span className="muted" style={{ fontSize: 12 }}>{String(i + 1).padStart(2, '0')}</span>{c.title}{c.locked && <Icon name="ri-lock-line" className="mark" title="已锁定" />}{c.pinned?.length ? <Icon name="ri-pushpin-2-fill" className="mark pin" title="手动编辑过（AI 不会改动）" /> : null}<ChangeTag p={P} id={c.id} /></h3>
            <PropChips m={m} node={c} />
            {c.content && <p style={{ marginTop: 6, whiteSpace: 'pre-line' }}>{c.content}</p>}
            {!!c.children?.length && <ul>{c.children.map(li)}</ul>}
          </div>
        ))}
      </div>
      {!root.children?.length && !root.content && <div className="empty" style={{ height: 300 }}>暂无内容，先在右侧运行「{m.stages[0].name}」</div>}
    </div>
  );
}
