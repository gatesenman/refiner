import type { ArtNode } from './types';
import { clone, findNode, findParent, uid } from './tree';

/** 结构编辑：拖拽排序 / 移动层级 / 缩进 / 提升 / 新建同级。全部为纯函数，返回新树或 null（不合法的操作）。 */
export type DropPos = 'before' | 'after' | 'inside';

function isDescendant(root: ArtNode, ancestorId: string, id: string): boolean {
  const a = findNode(root, ancestorId);
  if (!a) return false;
  let hit = false;
  const visit = (n: ArtNode) => { if (n.id === id) hit = true; else n.children?.forEach(visit); };
  a.children?.forEach(visit);
  return hit;
}

/** 把节点 id 移到 targetId 的前/后（同级）或里面（成为最后一个子项） */
export function moveNode(root0: ArtNode, id: string, targetId: string, pos: DropPos): ArtNode | null {
  if (id === targetId || id === root0.id) return null;
  if (targetId === root0.id && pos !== 'inside') return null;
  if (isDescendant(root0, id, targetId)) return null; // 不能放进自己的子孙
  const root = clone(root0);
  const parent = findParent(root, id);
  if (!parent?.children) return null;
  const i = parent.children.findIndex((c) => c.id === id);
  const [node] = parent.children.splice(i, 1);
  if (pos === 'inside') {
    const t = findNode(root, targetId)!;
    t.children = [...(t.children ?? []), node];
    return root;
  }
  const tp = findParent(root, targetId);
  if (!tp?.children) return null;
  const j = tp.children.findIndex((c) => c.id === targetId);
  tp.children.splice(pos === 'before' ? j : j + 1, 0, node);
  return root;
}

/** 在同一父节点下把 id 移到 index（表格行拖拽） */
export function reorderSibling(root0: ArtNode, id: string, index: number): ArtNode | null {
  const root = clone(root0);
  const p = findParent(root, id);
  if (!p?.children) return null;
  const i = p.children.findIndex((c) => c.id === id);
  const [n] = p.children.splice(i, 1);
  p.children.splice(Math.max(0, Math.min(index, p.children.length)), 0, n);
  return root;
}

/** Tab：成为上一个同级的最后一个子项 */
export function indentNode(root: ArtNode, id: string): ArtNode | null {
  const p = findParent(root, id);
  const i = p?.children?.findIndex((c) => c.id === id) ?? -1;
  if (!p || i <= 0) return null;
  return moveNode(root, id, p.children![i - 1].id, 'inside');
}

/** Shift+Tab：提升为父节点之后的同级 */
export function outdentNode(root: ArtNode, id: string): ArtNode | null {
  const p = findParent(root, id);
  if (!p || p.id === root.id) return null;
  return moveNode(root, id, p.id, 'after');
}

/** Enter：在 id 之后新建同级空节点（返回新树与新节点 id） */
export function insertSiblingAfter(root0: ArtNode, id: string, title = ''): { root: ArtNode; id: string } | null {
  const root = clone(root0);
  const nid = uid('n');
  if (id === root.id) { root.children = [...(root.children ?? []), { id: nid, title }]; return { root, id: nid }; }
  const p = findParent(root, id);
  if (!p?.children) return null;
  const i = p.children.findIndex((c) => c.id === id);
  p.children.splice(i + 1, 0, { id: nid, title });
  return { root, id: nid };
}

/** 给定被拖节点相对目标行的纵向位置（0~1），决定落点 */
export function dropPosFor(ratio: number, allowInside = true): DropPos {
  if (!allowInside) return ratio < 0.5 ? 'before' : 'after';
  return ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside';
}
