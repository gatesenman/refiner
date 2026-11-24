/**
 * v2.9 上游变更的三方合并（本地、不接账号）：
 * 以「下游新建时的上游版本」为 base，把上游最新（theirs）与下游当前（ours）按节点合并。
 * 只改一方的取该方；两方都改且不同则保留己方，并在节点上标记冲突，供用户查看。
 */
import type { ArtNode } from './types';
import { uid } from './tree';

export interface MergeConflict { id: string; title: string; ours: string; theirs: string }
export interface MergeResult { root: ArtNode; conflicts: MergeConflict[]; takenTheirs: number; keptOurs: number; added: number }

const sig = (n: ArtNode) => JSON.stringify({ t: n.title, c: n.content ?? '', p: n.props ?? {} });

function index(n: ArtNode, byId: Map<string, ArtNode>, byTitle: Map<string, ArtNode[]>) {
  byId.set(n.id, n);
  const k = n.title.trim();
  if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), n]);
  for (const c of n.children ?? []) index(c, byId, byTitle);
}

function match(n: ArtNode, byId: Map<string, ArtNode>, byTitle: Map<string, ArtNode[]>, used: Set<string>): ArtNode | undefined {
  const a = byId.get(n.id);
  if (a && !used.has(a.id)) { used.add(a.id); return a; }
  const cand = (byTitle.get(n.title.trim()) ?? []).find((x) => !used.has(x.id));
  if (cand) { used.add(cand.id); return cand; }
  return undefined;
}

function mergeNode(base: ArtNode | undefined, ours: ArtNode | undefined, theirs: ArtNode | undefined, conflicts: MergeConflict[]): ArtNode | undefined {
  if (!ours && !theirs) return undefined;
  if (!ours) return theirs;
  if (!theirs) return ours;
  const b = base ? sig(base) : undefined;
  const o = sig(ours), t = sig(theirs);
  let node: ArtNode = { ...ours };
  if (o === t) {
    // same
  } else if (b != null && o === b && t !== b) {
    node = { ...ours, title: theirs.title, content: theirs.content, props: theirs.props, kind: theirs.kind };
    return afterKids(base, node, ours, theirs, conflicts, true);
  } else if (b != null && t === b && o !== b) {
    // keep ours
  } else if (o !== t) {
    conflicts.push({ id: ours.id, title: ours.title, ours: [ours.title, ours.content ?? ''].filter(Boolean).join('：'), theirs: [theirs.title, theirs.content ?? ''].filter(Boolean).join('：') });
    node = { ...ours, conflict: { theirsTitle: theirs.title, theirsContent: theirs.content } };
  }
  return afterKids(base, node, ours, theirs, conflicts, false);
}

function afterKids(base: ArtNode | undefined, node: ArtNode, ours: ArtNode, theirs: ArtNode, conflicts: MergeConflict[], _tookTheirs: boolean): ArtNode {
  const bId = new Map<string, ArtNode>(), bT = new Map<string, ArtNode[]>();
  const oId = new Map<string, ArtNode>(), oT = new Map<string, ArtNode[]>();
  const tId = new Map<string, ArtNode>(), tT = new Map<string, ArtNode[]>();
  for (const c of base?.children ?? []) index(c, bId, bT);
  for (const c of ours.children ?? []) index(c, oId, oT);
  for (const c of theirs.children ?? []) index(c, tId, tT);
  const usedO = new Set<string>(), usedT = new Set<string>();
  const children: ArtNode[] = [];
  // 以己方顺序为主，穿插对方新增
  for (const oc of ours.children ?? []) {
    const tc = match(oc, tId, tT, usedT);
    const bc = match(oc, bId, bT, new Set());
    const m = mergeNode(bc, oc, tc, conflicts);
    if (m) children.push(m);
    usedO.add(oc.id);
  }
  for (const tc of theirs.children ?? []) {
    if (usedT.has(tc.id) || [...usedT].includes(tc.id)) continue;
    // 未匹配上：若 base 里有（我删了）则不恢复；否则视为对方新增
    const was = match(tc, bId, bT, new Set());
    if (was) continue;
    usedT.add(tc.id);
    children.push({ ...tc, id: tc.id || uid('n') });
  }
  return { ...node, children: children.length ? children : undefined };
}

/** 三方合并树。ids 对不上时按标题配对。 */
export function mergeTrees(base: ArtNode, ours: ArtNode, theirs: ArtNode): MergeResult {
  const conflicts: MergeConflict[] = [];
  const oursSig = sig(ours) + JSON.stringify((ours.children ?? []).map((c) => c.id));
  const root = mergeNode(base, ours, theirs, conflicts) ?? ours;
  let takenTheirs = 0, keptOurs = 0, added = 0;
  // 粗略统计
  const walk = (n: ArtNode) => { if (n.conflict) keptOurs++; (n.children ?? []).forEach(walk); };
  walk(root);
  keptOurs = conflicts.length;
  const count = (n: ArtNode): number => 1 + (n.children ?? []).reduce((s, c) => s + count(c), 0);
  added = Math.max(0, count(root) - count(ours));
  takenTheirs = Math.max(0, count(root) - count(ours) + /* content takes */ 0);
  // 更精确：比较非冲突节点是否采用了 theirs 的正文
  takenTheirs = 0;
  const oursById = new Map<string, ArtNode>();
  const indexO = (n: ArtNode) => { oursById.set(n.id, n); (n.children ?? []).forEach(indexO); };
  indexO(ours);
  const countTake = (n: ArtNode) => {
    const o = oursById.get(n.id);
    if (o && sig(o) !== sig(n) && !n.conflict) takenTheirs++;
    (n.children ?? []).forEach(countTake);
  };
  countTake(root);
  void oursSig;
  return { root, conflicts, takenTheirs, keptOurs, added };
}

export function mergeSummary(r: MergeResult): string {
  const bits: string[] = [];
  if (r.takenTheirs) bits.push(`吸收上游 ${r.takenTheirs} 处未冲突的改动`);
  if (r.added) bits.push(`加入上游新增 ${r.added} 项`);
  if (r.conflicts.length) bits.push(`${r.conflicts.length} 处两边都改过，已保留你的版本并做了标记`);
  if (!bits.length) return '上游与当前没有需要对齐的树改动';
  return bits.join('；') + '。';
}
