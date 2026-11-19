import { diffLines } from 'diff';
import { toOutlineText, uid, clone, diffFields, walk, findNode, removeNode, replaceNode } from './tree';
import type { Artifact, ArtNode, TypeManifest, Version } from './types';

export function createArtifact(manifest: TypeManifest, seed: string, title?: string): Artifact {
  const root: ArtNode = manifest.output === 'text'
    ? { id: uid(), title: title || seed.slice(0, 24) || manifest.name, content: '' }
    : { id: uid(), title: title || seed.slice(0, 24) || manifest.name, children: [] };
  const v: Version = { id: uid('v'), parentId: null, stageId: manifest.stages[0].id, op: 'init', label: '创建', root, log: [], createdAt: Date.now() };
  return { id: uid('a'), typeId: manifest.id, title: root.title, seed, root, stageIndex: 0, head: v.id, versions: [v], createdAt: Date.now(), updatedAt: Date.now() };
}

export function commitVersion(a: Artifact, v: Version): Artifact {
  return { ...a, root: v.root, head: v.id, versions: [...a.versions, v], updatedAt: Date.now(), title: a.title };
}

/** 手动编辑也是一个版本（自由度 0：完全由用户决定） */
export function commitManual(a: Artifact, root: ArtNode, label = '手动编辑', stageId?: string, opts: { pin?: boolean } = {}): Artifact {
  if (opts.pin !== false) root = pinEdits(a.root, root);
  const head = a.versions.find((v) => v.id === a.head);
  // 连续的同类手动编辑（同一标签，如连续改属性）合并为一个版本；不同操作各自成版本，撤销时能说清撤销了什么
  if (head && head.op === 'manual' && head.label === label && Date.now() - head.createdAt < 8000) {
    const versions = a.versions.map((v) => (v.id === head.id ? { ...v, root: clone(root), createdAt: Date.now() } : v));
    return { ...a, root, versions, updatedAt: Date.now() };
  }
  const v: Version = { id: uid('v'), parentId: a.head, stageId: stageId ?? head?.stageId ?? '', op: 'manual', label, root: clone(root), log: [], createdAt: Date.now() };
  return commitVersion(a, v);
}

/** 回滚：仅移动 head 指针；下一次操作将从该版本分叉，形成版本树 */
export function rollback(a: Artifact, versionId: string): Artifact {
  const v = a.versions.find((x) => x.id === versionId);
  if (!v) return a;
  return { ...a, root: clone(v.root), head: v.id, updatedAt: Date.now() };
}

export function versionChildren(a: Artifact): Map<string | null, Version[]> {
  const m = new Map<string | null, Version[]>();
  for (const v of a.versions) { const k = v.parentId; m.set(k, [...(m.get(k) ?? []), v]); }
  return m;
}

/** 按版本树深度优先排序，带缩进层级 */
export function versionTreeRows(a: Artifact): { v: Version; depth: number; isHead: boolean; onPath: boolean }[] {
  const kids = versionChildren(a);
  const path = new Set<string>();
  let cur = a.versions.find((v) => v.id === a.head);
  while (cur) { path.add(cur.id); cur = a.versions.find((v) => v.id === cur!.parentId); }
  const rows: { v: Version; depth: number; isHead: boolean; onPath: boolean }[] = [];
  const rec = (pid: string | null, depth: number) => {
    const list = kids.get(pid) ?? [];
    list.forEach((v, i) => {
      rows.push({ v, depth: depth + (i > 0 ? 1 : 0), isHead: v.id === a.head, onPath: path.has(v.id) });
      rec(v.id, depth + (i > 0 ? 1 : 0));
    });
  };
  rec(null, 0);
  return rows;
}

export function nodeText(root: ArtNode, isText: boolean): string {
  return isText ? (root.content ?? '') : toOutlineText(root);
}

export function diffVersions(a: ArtNode, b: ArtNode, isText: boolean) {
  return diffLines(nodeText(a, isText), nodeText(b, isText));
}

/**
 * 用户编辑 → 约束：把手动改过的字段记为 pinned。
 * 之后任何 AI 运行若改动这些字段，约束守卫会还原并把违规回流给修订者。用户越投入，越被尊重。
 */
export function pinEdits(before: ArtNode, after: ArtNode): ArtNode {
  const changed = diffFields(before, after);
  if (!changed.size) return after;
  const root = clone(after);
  walk(root, (n) => {
    const f = changed.get(n.id);
    if (f) n.pinned = [...new Set([...(n.pinned ?? []), ...f])];
  });
  return root;
}

/** 取消固定（用户主动放开某节点的手动约束） */
export function unpin(root: ArtNode, id: string): ArtNode {
  const r = clone(root);
  walk(r, (n) => { if (n.id === id) delete n.pinned; });
  return r;
}

/* ───── 审阅 AI 改动：高亮 / 全部保留 / 撤销重做 / 逐条撤回 ───── */
export interface NodeChange { kind: 'add' | 'mod'; before?: { title: string; content?: string; props?: Record<string, unknown> } }
const sig = (n: ArtNode) => JSON.stringify([n.title, n.content ?? '', n.props ?? {}]);
/** 逐节点比较（按 id）：新增 / 修改；removed 为被删除的节点数 */
export function changeMap(before: ArtNode, after: ArtNode): { map: Map<string, NodeChange>; added: number; modified: number; removed: number } {
  const old = new Map<string, ArtNode>();
  walk(before, (n) => { old.set(n.id, n); });
  const map = new Map<string, NodeChange>();
  let added = 0, modified = 0;
  const seen = new Set<string>();
  walk(after, (n) => {
    seen.add(n.id);
    const o = old.get(n.id);
    if (!o) { map.set(n.id, { kind: 'add' }); added++; }
    else if (sig(o) !== sig(n)) { map.set(n.id, { kind: 'mod', before: { title: o.title, content: o.content, props: o.props } }); modified++; }
  });
  let removed = 0;
  old.forEach((_n, id) => { if (!seen.has(id)) removed++; });
  return { map, added, modified, removed };
}
const AI_OPS = new Set(['generate', 'expand', 'restructure', 'detail', 'rewrite', 'patch']);
/** 当前待审阅的 AI 版本（跳过“逐条撤回”产生的中间版本）；没有则 undefined */
export function pendingReview(a: Artifact): { version: Version; base: ArtNode } | undefined {
  let v = a.versions.find((x) => x.id === a.head);
  while (v && v.revert) v = a.versions.find((x) => x.id === v!.parentId);
  if (!v || !AI_OPS.has(v.op) || v.reviewed) return undefined;
  const parent = a.versions.find((x) => x.id === v!.parentId);
  if (!parent) return undefined;
  return { version: v, base: parent.root };
}
export function headChanges(a: Artifact) {
  const p = pendingReview(a);
  if (!p) return undefined;
  if (!p.base.children?.length && !p.base.content) return undefined; // 第一次铺开：全是新内容，不逐条高亮
  const c = changeMap(p.base, a.root);
  for (const id of p.version.kept ?? []) { const k = c.map.get(id); if (k) { c.map.delete(id); if (k.kind === 'add') c.added--; else c.modified--; } }
  if (!c.map.size) return undefined;
  return { ...c, version: p.version };
}
/** 全部保留：标记为已审阅 */
export function markReviewed(a: Artifact, versionId?: string): Artifact {
  return { ...a, versions: a.versions.map((v) => (!versionId || v.id === versionId ? (v.reviewed ? v : { ...v, reviewed: true }) : v)) };
}
/** 撤销：head 回到父版本（不新建分支）；返回新制品与被撤销的版本 id（供重做） */
export function undo(a: Artifact): { artifact: Artifact; undone?: string } {
  const head = a.versions.find((v) => v.id === a.head);
  if (!head?.parentId) return { artifact: a };
  return { artifact: rollback(a, head.parentId), undone: head.id };
}
/** 重做：head 前进到指定版本（必须是当前 head 的子版本） */
export function redo(a: Artifact, versionId: string): Artifact {
  const v = a.versions.find((x) => x.id === versionId);
  if (!v || v.parentId !== a.head) return a;
  return rollback(a, versionId);
}
/** 逐条撤回：把某个节点恢复到 AI 改动之前（新增 → 删除；修改 → 还原标题/内容/属性） */
export function revertChange(a: Artifact, nodeId: string): Artifact {
  const p = pendingReview(a);
  if (!p) return a;
  const before = findNode(p.base, nodeId);
  const now = findNode(a.root, nodeId);
  if (!now) return a;
  let root: ArtNode;
  if (!before) root = removeNode(a.root, nodeId);
  else {
    const n: ArtNode = { ...now, title: before.title };
    if (before.content != null) n.content = before.content; else delete n.content;
    if (before.props) n.props = before.props; else delete n.props;
    root = replaceNode(a.root, nodeId, n);
  }
  const v: Version = { id: uid('v'), parentId: a.head, stageId: p.version.stageId, op: 'manual', label: `撤回一处 AI 改动「${now.title}」`, root: clone(root), log: [], createdAt: Date.now(), revert: true };
  return commitVersion(a, v);
}
/** 保留一处：之后不再高亮这一处 */
export function keepChange(a: Artifact, nodeId: string): Artifact {
  const p = pendingReview(a);
  if (!p) return a;
  return { ...a, versions: a.versions.map((v) => (v.id === p.version.id ? { ...v, kept: [...(v.kept ?? []), nodeId] } : v)) };
}
