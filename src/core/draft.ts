/**
 * v2.1 草稿层：把待审阅的 AI 改动收成一份可浏览的清单（侧栏 diff），
 * 而不只是散落在树上的「新」「改」标记。含新增 / 修改 / 删除。
 */
import type { ArtNode, Artifact, TypeManifest } from './types';
import { findNode, findParent, walk } from './tree';
import { changeMap, headChanges, pendingReview } from './versions';
import { changeReasons } from './reasons';

export interface DraftItem {
  id: string;
  kind: 'add' | 'mod' | 'del';
  title: string;
  parentTitle?: string;
  before?: string;
  after?: string;
  why?: string;
}

const snip = (title: string, content?: string, props?: Record<string, unknown>) => {
  const bits = [title];
  if (content?.trim()) bits.push(content.trim().slice(0, 80));
  if (props) {
    const kv = Object.entries(props).filter(([, v]) => v != null && v !== '').slice(0, 3).map(([k, v]) => `${k}=${v}`);
    if (kv.length) bits.push(kv.join('，'));
  }
  return bits.join(' · ');
};

/** 从待审阅版本抽出完整改动清单（含删除）；首次铺开无底稿时返回空（与 headChanges 一致） */
export function draftItems(a: Artifact, m?: TypeManifest): DraftItem[] {
  const chg = headChanges(a);
  const pend = pendingReview(a);
  if (!chg || !pend) return [];
  const whyMap = changeReasons(a.root, chg.map, m, pend.version.summary?.issues, pend.version.summary?.whys);
  const items: DraftItem[] = [];
  const seen = new Set<string>();
  walk(a.root, (n) => {
    const c = chg.map.get(n.id);
    if (!c) return;
    seen.add(n.id);
    const parent = findParent(a.root, n.id);
    items.push({
      id: n.id,
      kind: c.kind,
      title: n.title,
      parentTitle: parent && parent.id !== a.root.id ? parent.title : undefined,
      before: c.before ? snip(c.before.title, c.before.content, c.before.props) : undefined,
      after: snip(n.title, n.content, n.props),
      why: whyMap.get(n.id),
    });
  });
  // 删除：在底稿里有、当前没有、且未被 kept
  const kept = new Set(pend.version.kept ?? []);
  walk(pend.base, (n) => {
    if (n.id === pend.base.id) return;
    if (findNode(a.root, n.id) || kept.has(n.id) || seen.has(n.id)) return;
    const parent = findParent(pend.base, n.id);
    items.push({
      id: n.id,
      kind: 'del',
      title: n.title,
      parentTitle: parent && parent.id !== pend.base.id ? parent.title : undefined,
      before: snip(n.title, n.content, n.props),
      why: '这一项被去掉了',
    });
  });
  return items;
}

/** 预览两棵树的改动（逐处确认时尚未落成版本） */
export function draftItemsBetween(base: ArtNode, after: ArtNode, m?: TypeManifest, issues: string[] = [], whys: Record<string, string> = {}): DraftItem[] {
  const c = changeMap(base, after);
  if (!c.map.size && !c.removed) return [];
  const fake = { root: after, head: 'x', versions: [{ id: 'x', parentId: 'b', op: 'expand', reviewed: false, root: after, kept: [] }] } as unknown as Artifact;
  void fake;
  const whyMap = changeReasons(after, c.map, m, issues, whys);
  const items: DraftItem[] = [];
  walk(after, (n) => {
    const ch = c.map.get(n.id);
    if (!ch) return;
    const parent = findParent(after, n.id);
    items.push({
      id: n.id, kind: ch.kind, title: n.title,
      parentTitle: parent && parent.id !== after.id ? parent.title : undefined,
      before: ch.before ? snip(ch.before.title, ch.before.content, ch.before.props) : undefined,
      after: snip(n.title, n.content, n.props),
      why: whyMap.get(n.id),
    });
  });
  walk(base, (n) => {
    if (n.id === base.id || findNode(after, n.id)) return;
    const parent = findParent(base, n.id);
    items.push({
      id: n.id, kind: 'del', title: n.title,
      parentTitle: parent && parent.id !== base.id ? parent.title : undefined,
      before: snip(n.title, n.content, n.props),
      why: '这一项被去掉了',
    });
  });
  return items;
}

export const KIND_LABEL: Record<DraftItem['kind'], string> = { add: '新', mod: '改', del: '删' };
