import type { ArtNode, TypeManifest } from './types';

/**
 * 程序化检查注册表：类型通过 manifest.checks 引用。
 * 检查发现的问题与约束守卫的违规一起回流给修订者（闭环），而不是静默修补。
 */
export type DraftCheck = (draft: { text?: string; root?: ArtNode }, manifest: TypeManifest) => string[];
const CHECKS = new Map<string, { name: string; fn: DraftCheck }>();

export function registerCheck(id: string, name: string, fn: DraftCheck) { CHECKS.set(id, { name, fn }); }
export function getCheck(id: string) { return CHECKS.get(id); }
export function listChecks() { return [...CHECKS.keys()]; }
