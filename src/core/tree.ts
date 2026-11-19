import type { ArtNode } from './types';

let counter = 0;
export function uid(prefix = 'n'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function walk(node: ArtNode, fn: (n: ArtNode, parent: ArtNode | null, depth: number) => void, parent: ArtNode | null = null, depth = 0) {
  fn(node, parent, depth);
  for (const c of node.children ?? []) walk(c, fn, node, depth + 1);
}

export function findNode(root: ArtNode, id: string | undefined): ArtNode | null {
  if (!id) return null;
  let hit: ArtNode | null = null;
  walk(root, (n) => { if (!hit && n.id === id) hit = n; });
  return hit;
}

export function findParent(root: ArtNode, id: string): ArtNode | null {
  let hit: ArtNode | null = null;
  walk(root, (n, p) => { if (!hit && n.id === id) hit = p; });
  return hit;
}

export function countNodes(root: ArtNode): number {
  let c = 0;
  walk(root, () => c++);
  return c;
}

export function collectIds(root: ArtNode): Set<string> {
  const s = new Set<string>();
  walk(root, (n) => s.add(n.id));
  return s;
}

/** 规范化 AI 返回的树：补 id、修正字段类型 */
export function normalizeNode(raw: any, existing?: Set<string>, used = new Set<string>()): ArtNode {
  const r = raw && typeof raw === 'object' ? raw : { title: String(raw ?? '') };
  let id: string = typeof r.id === 'string' && r.id ? r.id : typeof r.id === 'number' ? String(r.id) : '';
  if (!id || used.has(id)) id = uid();
  void existing;
  used.add(id);
  const node: ArtNode = {
    id,
    title: String(r.title ?? r.name ?? r.label ?? '').trim() || '（未命名）',
  };
  const content = r.content ?? r.description ?? r.desc ?? r.text;
  if (content != null && String(content).trim()) node.content = String(content);
  if (r.props && typeof r.props === 'object' && !Array.isArray(r.props)) {
    // 模型不允许通过属性夹带结构字段；锁定状态只能由用户设置
    const { locked: _l, id: _i, children: _c, ...rest } = r.props;
    if (Object.keys(rest).length) node.props = rest;
  }
  const why = r.why ?? r.reason;
  if (typeof why === 'string' && why.trim()) (node as ArtNode & { why?: string }).why = why.trim();
  const kids = Array.isArray(r.children) ? r.children : Array.isArray(r.items) ? r.items : [];
  if (kids.length) node.children = kids.map((k: any) => normalizeNode(k, existing, used));
  return node;
}

export function replaceNode(root: ArtNode, id: string, next: ArtNode): ArtNode {
  if (root.id === id) return next;
  return { ...root, children: root.children?.map((c) => replaceNode(c, id, next)) };
}

export function removeNode(root: ArtNode, id: string): ArtNode {
  return { ...root, children: root.children?.filter((c) => c.id !== id).map((c) => removeNode(c, id)) };
}

export function updateNode(root: ArtNode, id: string, patch: Partial<ArtNode>): ArtNode {
  if (root.id === id) return { ...root, ...patch };
  return { ...root, children: root.children?.map((c) => updateNode(c, id, patch)) };
}

export function addChild(root: ArtNode, parentId: string, child: ArtNode): ArtNode {
  if (root.id === parentId) return { ...root, children: [...(root.children ?? []), child] };
  return { ...root, children: root.children?.map((c) => addChild(c, parentId, child)) };
}

/** 扁平化为行（用于表格/看板/时间线积木） */
export function flatten(root: ArtNode, opts: { leavesOnly?: boolean; includeRoot?: boolean } = {}): { node: ArtNode; path: string[]; depth: number }[] {
  const out: { node: ArtNode; path: string[]; depth: number }[] = [];
  const rec = (n: ArtNode, path: string[], depth: number) => {
    const isLeaf = !n.children?.length;
    if ((depth > 0 || opts.includeRoot) && (!opts.leavesOnly || isLeaf)) out.push({ node: n, path, depth });
    for (const c of n.children ?? []) rec(c, depth > 0 ? [...path, n.title] : path, depth + 1);
  };
  rec(root, [], 0);
  return out;
}

/** 树 → 缩进文本（用于提示词与差异比较） */
export function toOutlineText(root: ArtNode, opts: { ids?: boolean; props?: boolean } = { props: true }): string {
  const lines: string[] = [];
  walk(root, (n, _p, d) => {
    const pad = '  '.repeat(d);
    let line = `${pad}- ${n.title}`;
    if (opts.ids) line += `  [id=${n.id}]`;
    if (n.locked) line += ' [锁定]';
    if (n.pinned?.length) line += ` [手动固定:${n.pinned.join(',')}]`;
    lines.push(line);
    if (opts.props !== false && n.props && Object.keys(n.props).length) {
      const ps = Object.entries(n.props).filter(([k]) => k !== 'url').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      if (ps.length) lines.push(`${pad}  {${ps.join('; ')}}`);
    }
    if (n.content) for (const cl of n.content.split('\n')) lines.push(`${pad}  ${cl}`);
  });
  return lines.join('\n');
}

/** 精简 JSON（发给模型，去掉大体积字段） */
export function toPromptJSON(node: ArtNode): string {
  const strip = (n: ArtNode): any => {
    const o: any = { id: n.id, title: n.title };
    if (n.content) o.content = n.content;
    if (n.props) {
      const p: any = {};
      for (const [k, v] of Object.entries(n.props)) if (!(typeof v === 'string' && v.startsWith('data:'))) p[k] = v;
      if (Object.keys(p).length) o.props = p;
    }
    if (n.locked) o.locked = true;
    if (n.pinned?.length) o.pinned = n.pinned;
    if (n.children?.length) o.children = n.children.map(strip);
    return o;
  };
  return JSON.stringify(strip(node), null, 1);
}

/** 根到目标的祖先链（不含目标本身） */
export function ancestors(root: ArtNode, id: string): ArtNode[] {
  const path: ArtNode[] = [];
  const rec = (n: ArtNode): boolean => {
    if (n.id === id) return true;
    path.push(n);
    for (const c of n.children ?? []) if (rec(c)) return true;
    path.pop();
    return false;
  };
  return rec(root) ? path : [];
}

/** 按“原兄弟顺序”插回节点：放在最近一个仍存在的前序兄弟之后，否则放在最前 */
export function insertByOrder(root: ArtNode, parentId: string, child: ArtNode, oldSiblingIds: string[]): ArtNode {
  const idx = oldSiblingIds.indexOf(child.id);
  const prevIds = idx > 0 ? oldSiblingIds.slice(0, idx).reverse() : [];
  const rec = (n: ArtNode): ArtNode => {
    if (n.id === parentId) {
      const kids = [...(n.children ?? [])];
      let at = 0;
      for (const p of prevIds) { const j = kids.findIndex((k) => k.id === p); if (j >= 0) { at = j + 1; break; } }
      kids.splice(at, 0, child);
      return { ...n, children: kids };
    }
    return { ...n, children: n.children?.map(rec) };
  };
  return rec(root);
}

/** 对比两棵树，返回用户改动过的字段：id → 字段列表（新节点视为 title+content 全部改动） */
export function diffFields(before: ArtNode, after: ArtNode): Map<string, string[]> {
  const old = new Map<string, ArtNode>();
  walk(before, (n) => old.set(n.id, n));
  const out = new Map<string, string[]>();
  walk(after, (n) => {
    const o = old.get(n.id);
    const f: string[] = [];
    if (!o) { f.push('title'); if (n.content) f.push('content'); for (const k of Object.keys(n.props ?? {})) f.push('props.' + k); }
    else {
      if (o.title !== n.title) f.push('title');
      if ((o.content ?? '') !== (n.content ?? '')) f.push('content');
      const keys = new Set([...Object.keys(o.props ?? {}), ...Object.keys(n.props ?? {})]);
      for (const k of keys) if (JSON.stringify(o.props?.[k]) !== JSON.stringify(n.props?.[k])) f.push('props.' + k);
    }
    if (f.length) out.set(n.id, f);
  });
  return out;
}
