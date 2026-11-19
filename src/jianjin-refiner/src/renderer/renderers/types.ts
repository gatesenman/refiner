import type { Artifact, ArtNode, NodeChange, TypeManifest } from '../../core';
export interface RProps {
  art: Artifact;
  m: TypeManifest;
  root: ArtNode;
  sel?: string;
  onSelect: (id?: string, additive?: boolean) => void;
  /** v1.8 多选的节点 */
  multi?: string[];
  onChange: (root: ArtNode, label?: string) => void;
  /** 本次 AI 改动（用于高亮与逐条审阅） */
  changes?: Map<string, NodeChange>;
  review?: { why?: string; whyOf?: (id: string) => string | undefined; onKeep: (id: string) => void; onRevert: (id: string) => void };
}
