/**
 * v1.8 逐条改动理由（借鉴 ChatGPT Canvas 的“解释改了什么”、Gamma 的改前/改后对照）：
 * 每一处 AI 改动都给出“改了什么 + 为什么”。优先用模型自己给的 why；
 * 没有时由程序对比改前改后（补了哪些字段、说明变长/变具体、去掉了“待定”）并关联检查意见，保证每处都有理由。
 */
import type { ArtNode, TypeManifest } from './types';
import type { NodeChange } from './versions';
import { walk } from './tree';

const VAGUE = /待定|待确认|待讨论|待补充|不确定|未定|TBD|TODO|[?？]|大概|若干/i;
const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** 一处改动的理由（一句话，最多两三个要点） */
export function changeReason(c: NodeChange, after: ArtNode, m?: TypeManifest, issues: string[] = [], aiWhy?: string): string {
  const parts: string[] = [];
  if (aiWhy?.trim()) parts.push(aiWhy.trim());
  const props = m?.nodeSchema?.props ?? [];
  if (c.kind === 'add') {
    const n = after.children?.length ?? 0;
    if (!aiWhy) parts.push(`新增「${after.title.slice(0, 16)}」${n ? `（含 ${n} 项）` : ''}`);
  } else if (c.before) {
    const b = c.before;
    if (b.title !== after.title) parts.push(`标题改为「${after.title.slice(0, 16)}」`);
    const filled = props.filter((p) => empty(b.props?.[p.key]) && !empty(after.props?.[p.key])).map((p) => p.label);
    if (filled.length) parts.push(`补了${filled.slice(0, 3).join('、')}`);
    const changed = props.filter((p) => !empty(b.props?.[p.key]) && !empty(after.props?.[p.key]) && JSON.stringify(b.props?.[p.key]) !== JSON.stringify(after.props?.[p.key])).map((p) => p.label);
    if (changed.length) parts.push(`调整了${changed.slice(0, 3).join('、')}`);
    const l0 = (b.content ?? '').trim().length, l1 = (after.content ?? '').trim().length;
    if (VAGUE.test(b.content ?? '') && !VAGUE.test(after.content ?? '')) parts.push('把“待定”写成了具体内容');
    else if (l0 === 0 && l1 > 0) parts.push(`补了说明（${l1} 字）`);
    else if (l1 > l0 * 1.5 && l1 - l0 >= 8) parts.push(`说明更具体（${l0}→${l1} 字）`);
    else if (l0 > 0 && l1 < l0 * 0.6) parts.push(`说明精简（${l0}→${l1} 字）`);
    else if ((b.content ?? '') !== (after.content ?? '')) parts.push('改写了说明');
  }
  const key = after.title.replace(/[（(].*$/, '').slice(0, 6);
  const hit = issues.find((x) => key.length >= 2 && x.includes(key)) ?? (parts.length <= 1 && issues.length === 1 ? issues[0] : undefined);
  if (hit && !parts.some((p) => p.includes(hit))) parts.push(`回应检查意见：${hit.slice(0, 40)}`);
  return parts.join('；') || 'AI 调整了这里';
}

/** 整次改动的理由表 id → 理由 */
export function changeReasons(after: ArtNode, map: Map<string, NodeChange>, m?: TypeManifest, issues: string[] = [], whys: Record<string, string> = {}): Map<string, string> {
  const out = new Map<string, string>();
  walk(after, (n) => { const c = map.get(n.id); if (c) out.set(n.id, changeReason(c, n, m, issues, whys[n.id])); });
  return out;
}

/** 从模型输出的节点上摘下 why（不进入作品内容），返回 id → why */
export function stripWhys(root: ArtNode): { root: ArtNode; whys: Record<string, string> } {
  const whys: Record<string, string> = {};
  const go = (n: ArtNode): ArtNode => {
    const { why, ...rest } = n as ArtNode & { why?: string };
    if (typeof why === 'string' && why.trim()) whys[n.id] = why.trim().slice(0, 80);
    return rest.children ? { ...rest, children: rest.children.map(go) } : rest;
  };
  return { root: go(root), whys };
}
