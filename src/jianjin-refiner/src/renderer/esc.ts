import { useEffect } from 'react';
/**
 * Esc 依次关闭：浮层（菜单/弹出说明）→ 面板（AI 过程 / 历史 / 检查器）→ 选择。
 * 组件在打开时登记一个关闭函数；全局 Esc 先关最近登记的最高优先级项。
 */
type Entry = { level: 0 | 1; fn: () => void; at: number };
const stack = new Set<Entry>();
let seq = 0;
export function useEscClose(open: boolean, fn: () => void, level: 0 | 1 = 0) {
  useEffect(() => {
    if (!open) return;
    const e: Entry = { level, fn, at: ++seq };
    stack.add(e);
    return () => { stack.delete(e); };
  }, [open, fn, level]);
}
/** 返回 true 表示 Esc 已被某个浮层/面板消费 */
export function escCloseTop(): boolean {
  const list = [...stack].sort((a, b) => a.level - b.level || b.at - a.at);
  const top = list[0];
  if (!top) return false;
  stack.delete(top);
  top.fn();
  return true;
}
