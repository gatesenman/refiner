/**
 * v2.11 把恢复、损坏、部分完成说成一句人听得懂的中文。
 * 纯函数，UI 只负责展示。
 */
import type { Artifact } from './types';
import { hasPendingCheckpoint, checkpointLabel } from './journal';

export interface Notice { kind: 'info' | 'warn'; text: string; action?: 'apply-journal' | 'dismiss-journal' }

export function recoveryNotices(opts: {
  loadWarnings?: string[];
  artifact?: Artifact;
  lastWarnings?: string[];
  lastPartial?: boolean;
}): Notice[] {
  const out: Notice[] = [];
  for (const w of opts.loadWarnings ?? []) out.push({ kind: 'warn', text: w });
  if (opts.artifact && hasPendingCheckpoint(opts.artifact)) {
    const j = opts.artifact.runJournal!;
    out.push({
      kind: 'info',
      text: `上次有一次多处细化做到一半就中断了（${checkpointLabel(j).replace(/^恢复/, '')}）。可以把它补成一个版本，或丢掉这些未提交的改动。`,
      action: 'apply-journal',
    });
  }
  if (opts.lastPartial) {
    const extra = (opts.lastWarnings ?? []).find((w) => /已停止|已保留/.test(w));
    out.push({ kind: 'info', text: extra ?? '这次只完成了其中一部分，已保存为版本，其余保持原样。' });
  }
  return out;
}
