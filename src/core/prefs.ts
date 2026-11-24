/**
 * v2.0 从撤回中学习（借鉴 Cursor Bugbot 的 learned rules：把人的反馈变成规则，可停用；
 * DSPy GEPA：用自然语言反馈改进指令）。用户撤回某处 AI 改动 = 一条明确的负反馈，
 * 记成一句“偏好”，之后每一步都作为约束交给 AI；用户可随时停用或删除。与场景无关。
 */
import type { ArtNode } from './types';
import type { NodeChange } from './versions';

export type PrefScope = 'work' | 'global';
export interface Pref { id: string; text: string; on: boolean; from: 'revert' | 'undoAll' | 'user'; at: number; hits?: number; scope?: PrefScope }
export const MAX_PREFS = 8;

/** 撤回一处改动 → 一句偏好 */
export function prefFromRevert(c: NodeChange, after: ArtNode, reason?: string): string {
  const t = (c.before?.title ?? after.title).slice(0, 16);
  if (c.kind === 'add') return `不需要在这里新增「${t}」这类内容`;
  const r = (reason ?? '').replace(/；?回应检查意见：.*$/, '').trim();
  return r ? `「${t}」不要这样改（${r.slice(0, 40)}）` : `「${t}」保持用户原来的写法，不要改动`;
}
/** 整次撤回 → 一句偏好 */
export function prefFromUndoAll(label: string, instruction?: string): string {
  return `用户撤回过整次改动「${label.slice(0, 30)}」${instruction ? `（当时的要求：${instruction.slice(0, 30)}）` : ''}，不要再用同样的方式改`;
}
/** 加入偏好：同句去重（再次出现 = 计数 +1 并重新启用），最新的在前，最多 MAX_PREFS 条 */
export function addPref(list: Pref[] | undefined, text: string, from: Pref['from'], id: string, now = Date.now()): Pref[] {
  const cur = [...(list ?? [])];
  const i = cur.findIndex((p) => p.text === text);
  if (i >= 0) { const p = cur.splice(i, 1)[0]; return [{ ...p, on: true, hits: (p.hits ?? 1) + 1, at: now }, ...cur].slice(0, MAX_PREFS); }
  return [{ id, text, on: true, from, at: now, hits: 1 }, ...cur].slice(0, MAX_PREFS);
}
/** 注入提示词的偏好段（只含启用的） */
export function prefBlock(list: Pref[] | undefined): string {
  const on = (list ?? []).filter((p) => p.on);
  return on.length ? `\n\n【用户偏好】以下是从用户撤回的改动中学到的，务必避免：\n${on.map((p) => `- ${p.text}`).join('\n')}` : '';
}

/** 合并本作品 + 全局偏好（同句去重，作品级覆盖全局的开关） */
export function effectivePrefs(work?: Pref[], global?: Pref[]): Pref[] {
  const out: Pref[] = [];
  const seen = new Set<string>();
  for (const p of [...(work ?? []), ...(global ?? [])]) {
    if (seen.has(p.text)) continue;
    seen.add(p.text);
    out.push(p);
  }
  return out;
}
/** 导出为可分享的 JSON（不含瞬时 hits 也可保留） */
export function serializePrefs(prefs: Pref[]): string {
  return JSON.stringify({ version: 1, prefs: prefs.map((p) => ({ text: p.text, on: p.on, from: p.from ?? 'user', scope: p.scope ?? 'work' })) }, null, 2);
}
/** 解析偏好 JSON；坏数据抛错 */
export function parsePrefs(json: string): Pref[] {
  const o = JSON.parse(json);
  const arr = Array.isArray(o) ? o : o?.prefs;
  if (!Array.isArray(arr)) throw new Error('不是有效的偏好文件（需要 { version, prefs }）');
  const now = Date.now();
  return arr.map((p: any, i: number) => {
    const text = String(p?.text ?? '').trim();
    if (!text) throw new Error(`第 ${i + 1} 条缺少文本`);
    return { id: `imp${i}-${text.slice(0, 8)}`, text, on: p?.on !== false, from: (p?.from === 'revert' || p?.from === 'undoAll' ? p.from : 'user') as Pref['from'], at: now, scope: p?.scope === 'global' ? 'global' as const : 'work' as const, hits: 1 };
  });
}
/** 把一批偏好并入已有列表（同句去重） */
export function mergePrefs(list: Pref[] | undefined, incoming: Pref[], scope?: PrefScope): Pref[] {
  let cur = list ?? [];
  for (const p of incoming) cur = addPref(cur, p.text, p.from, p.id, p.at);
  if (scope) cur = cur.map((p) => ({ ...p, scope: incoming.some((i) => i.text === p.text) ? scope : p.scope }));
  return cur;
}
