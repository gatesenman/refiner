/**
 * v2.7 长任务检查点：多处细化已完成的部分先记在作品上，
 * 崩溃或退出后来得及选择「应用」或「丢弃」。不自动改 head。
 */
import type { ArtNode, Artifact, Version } from './types';
import { uid } from './tree';
import { commitVersion } from './versions';

export interface RunCheckpoint {
  artifactId: string;
  stageIndex: number;
  op: string;
  startedAt: number;
  done: { id: string; title: string }[];
  root: ArtNode;
}

export function hasPendingCheckpoint(a: Artifact): boolean {
  const j = a.runJournal;
  if (!j?.done?.length || !j.root) return false;
  try { return JSON.stringify(j.root) !== JSON.stringify(a.root); }
  catch { return true; }
}

export function checkpointLabel(j: RunCheckpoint): string {
  const n = j.done.length;
  const names = j.done.slice(0, 3).map((d) => `「${d.title}」`).join('');
  const more = n > 3 ? `等 ${n} 处` : `${n} 处`;
  return `恢复中断前已完成的${more}${n <= 3 ? names : ''}`;
}

export function applyCheckpoint(a: Artifact): Artifact {
  if (!hasPendingCheckpoint(a) || !a.runJournal) return { ...a, runJournal: undefined };
  const j = a.runJournal;
  const stageId = a.blueprint?.stages[j.stageIndex]?.id ?? a.versions.find((v) => v.id === a.head)?.stageId ?? '';
  const ver: Version = {
    id: uid('v'), parentId: a.head, stageId, op: (j.op as Version['op']) || 'expand',
    label: checkpointLabel(j), root: j.root, log: [], createdAt: Date.now(), partial: true,
  };
  return { ...commitVersion(a, ver), runJournal: undefined };
}

export function discardCheckpoint(a: Artifact): Artifact {
  if (!a.runJournal) return a;
  return { ...a, runJournal: undefined };
}
