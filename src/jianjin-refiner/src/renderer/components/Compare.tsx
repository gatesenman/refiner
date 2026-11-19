import { Icon } from '../icons/Icon';
import { useMemo } from 'react';
import { useStore } from '../store';
import { alignParts, nodeSig, propsText, subtreeStatus, wordDiff, type ArtNode, type TypeManifest, type Version } from '../../core';

/** 字级差异：other 为对侧文字；side = 'l' 显示删除、'r' 显示新增 */
export function WordDiff({ mine, other, side }: { mine: string; other?: string; side: 'l' | 'r' }) {
  if (other == null || other === mine) return <>{mine}</>;
  const segs = side === 'r' ? wordDiff(other, mine) : wordDiff(mine, other);
  return <>{segs.map((g, i) => (g.add ? (side === 'r' ? <ins key={i}>{g.t}</ins> : null) : g.del ? (side === 'l' ? <del key={i}>{g.t}</del> : null) : <span key={i}>{g.t}</span>))}</>;
}

/** 结构化渲染一个部分（标题、说明、属性行、子项），并按对侧高亮：新增绿、改动黄（内含字级差异） */
function PartView({ n, other, side, m }: { n: ArtNode; other?: ArtNode; side: 'l' | 'r'; m: TypeManifest }) {
  const st = useMemo(() => subtreeStatus(n, other), [n, other]);
  const rec = (x: ArtNode, d: number): JSX.Element => {
    const s0 = other ? st.get(x.id) : undefined;
    const o = s0?.other;
    const cls = !other ? '' : s0?.status === 'add' ? (side === 'r' ? 'c-add' : 'c-del') : s0?.status === 'mod' ? 'c-mod' : '';
    const pt = propsText(x, m.nodeSchema), opt = o ? propsText(o, m.nodeSchema) : undefined;
    return (
      <div key={x.id} className={`cmp-node d${d} ${cls}`}>
        <div className="cmp-t"><WordDiff mine={x.title} other={o?.title} side={side} /></div>
        {x.content && <div className="cmp-c"><WordDiff mine={x.content} other={o ? o.content ?? '' : undefined} side={side} /></div>}
        {pt && <div className="cmp-p"><WordDiff mine={pt} other={opt} side={side} /></div>}
        {(x.children ?? []).map((c) => rec(c, d + 1))}
      </div>
    );
  };
  return rec(n, 0);
}

const vName = (a: { versions: Version[] }, v: Version, m: TypeManifest) => {
  const i = a.versions.indexOf(v) + 1;
  const st = m.stages.find((x) => x.id === v.stageId)?.name;
  return `#${i} ${v.label}${st ? ` · ${st}` : ''} · ${new Date(v.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
};

/** 并排对比任意两个版本 / 分支：每个部分都可以“用这一版” */
export function CompareDialog() {
  const s = useStore();
  const c = s.compare!;
  const a = s.currentArtifact, m = s.currentManifest;
  const va = a?.versions.find((v) => v.id === c.a), vb = a?.versions.find((v) => v.id === c.b);
  const rows = useMemo(() => (va && vb ? alignParts(va.root, vb.root) : []), [va, vb]);
  if (!a || !m || !va || !vb) return null;
  const head = a.root;
  const counts = { mod: rows.filter((r) => r.status === 'mod').length, add: rows.filter((r) => r.status === 'add').length, del: rows.filter((r) => r.status === 'del').length };
  // “用这一版”：把这一侧的该部分写进当前内容；这一侧没有该部分 = 从当前去掉
  const inHead = (n?: ArtNode) => n && head.children?.find((x) => x.id === n.id || x.title === n.title);
  const isCurrent = (n: ArtNode | undefined, other: ArtNode | undefined) => (n ? !!inHead(n) && nodeSig(inHead(n)!) === nodeSig(n) : !inHead(other));
  const use = (v: Version, n: ArtNode | undefined, other: ArtNode | undefined) => (n ? s.adoptPart(v.id, n.id) : other && s.adoptPart(v.id, null, { id: other.id, title: other.title }));
  const sel = (side: 'a' | 'b') => (
    <select className="select" value={side === 'a' ? c.a : c.b} onChange={(e) => s.setCompare({ ...c, [side]: e.target.value })}>
      {[...a.versions].reverse().map((v) => <option key={v.id} value={v.id}>{vName(a, v, m)}{v.id === a.head ? '（当前）' : ''}</option>)}
    </select>
  );
  const btn = (v: Version, n: ArtNode | undefined, other: ArtNode | undefined) => {
    const cur = isCurrent(n, other);
    return <button className={`btn sm ${cur ? 'ghost' : ''}`} disabled={cur || s.run.running} title={cur ? '当前内容已是这一版' : n ? '把这一版的这部分写入当前内容' : '这一版没有此部分：从当前内容去掉'} onClick={() => use(v, n, other)}><Icon name={cur ? 'ri-check-double-line' : 'ri-check-line'} />{cur ? '当前用的这版' : '用这一版'}</button>;
  };
  return (
    <div className="modal-mask" onMouseDown={() => s.setCompare(null)}>
      <div className="modal cmp-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-h"><Icon name="ri-layout-column-line" />并排对比<span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>　{counts.mod} 处改动 · {counts.add} 处新增 · {counts.del} 处删除</span><span className="spacer" />
          <span className="cmp-legend"><i className="lg-add" />新增<i className="lg-del" />删除<i className="lg-mod" />改动</span>
          <button className="icon-btn" title="关闭（Esc）" onClick={() => s.setCompare(null)}><Icon name="ri-close-line" /></button></div>
        <div className="cmp-grid cmp-head">
          <div className="row">{sel('a')}<span className="spacer" />{c.a !== a.head && <button className="btn sm ghost" onClick={() => { s.rollback(c.a); s.setCompare(null); }}>整版用这一版</button>}</div>
          <div className="row">{sel('b')}<span className="spacer" />{c.b !== a.head && <button className="btn sm ghost" onClick={() => { s.rollback(c.b); s.setCompare(null); }}>整版用这一版</button>}</div>
        </div>
        <div className="modal-b cmp-body">
          {rows.map((r, i) => (
            <div key={i} className={`cmp-grid cmp-row st-${r.status}`}>
              <div className="cmp-cell">{r.l ? <PartView n={r.l} other={r.r} side="l" m={m} /> : <div className="muted cmp-none">（这一版没有此部分）</div>}<div className="cmp-act">{r.status !== 'same' && btn(va, r.l, r.r)}</div></div>
              <div className="cmp-cell">{r.r ? <PartView n={r.r} other={r.l} side="r" m={m} /> : <div className="muted cmp-none">（这一版没有此部分）</div>}<div className="cmp-act">{r.status !== 'same' && btn(vb, r.r, r.l)}</div></div>
            </div>
          ))}
          {!rows.length && <div className="empty">两个版本都还没有内容</div>}
        </div>
      </div>
    </div>
  );
}

/** 历史面板用：一个版本相对上一版的结构化改动清单（替代原始文本 diff） */
export function ChangeList({ before, after, m }: { before?: ArtNode; after: ArtNode; m: TypeManifest }) {
  const items = useMemo(() => {
    if (!before) return null;
    const st = subtreeStatus(after, before);
    const afterIds = new Set<string>(); const out: { kind: 'add' | 'mod' | 'del'; n: ArtNode; o?: ArtNode }[] = [];
    const visit = (n: ArtNode, d: number) => { afterIds.add(n.id); const x = st.get(n.id); if (d > 0 && x && x.status !== 'same') out.push({ kind: x.status, n, o: x.other }); (n.children ?? []).forEach((c) => visit(c, d + 1)); };
    visit(after, 0);
    const back = subtreeStatus(before, after);
    const visitB = (n: ArtNode, d: number) => { if (d > 0 && back.get(n.id)?.status === 'add') out.push({ kind: 'del', n }); (n.children ?? []).forEach((c) => visitB(c, d + 1)); };
    visitB(before, 0);
    return out;
  }, [before, after]);
  if (m.output === 'text') {
    return <div className="chg-list"><div className="chg-i c-mod"><WordDiff mine={after.content ?? ''} other={before ? before.content ?? '' : undefined} side="r" /></div></div>;
  }
  if (!items) return <div className="muted" style={{ padding: 12 }}>初始版本</div>;
  if (!items.length) return <div className="muted" style={{ padding: 12 }}>内容没有变化</div>;
  return (
    <div className="chg-list">
      {items.slice(0, 200).map((x, i) => {
        const pt = propsText(x.n, m.nodeSchema), opt = x.o ? propsText(x.o, m.nodeSchema) : undefined;
        return (
          <div key={i} className={`chg-i c-${x.kind}`}>
            <span className={`badge ${x.kind}`}>{x.kind === 'add' ? '新增' : x.kind === 'del' ? '删除' : '修改'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cmp-t">{x.kind === 'mod' ? <WordDiff mine={x.n.title} other={x.o?.title} side="r" /> : x.n.title}</div>
              {(x.n.content || x.o?.content) && <div className="cmp-c">{x.kind === 'mod' ? <WordDiff mine={x.n.content ?? ''} other={x.o?.content ?? ''} side="r" /> : x.n.content}</div>}
              {(pt || opt) && <div className="cmp-p">{x.kind === 'mod' ? <WordDiff mine={pt} other={opt} side="r" /> : pt}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
