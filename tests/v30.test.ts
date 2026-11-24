import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, packFiles, importPackFiles, toJSONCanvas, fromJSONCanvas, toMdTable } from '../src/core';
import type { ArtNode, TypeManifest, Artifact } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = { ...outline, id: 'bp', name: '计划', stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']) };
const ROOT = (): ArtNode => normalizeNode({ title: '发布计划', content: '8 周', children: [
  { title: '准备', content: '锁定范围', children: [{ title: '需求冻结', content: 'PRD 通过' }] },
  { title: '上线', content: '提交审核' },
] });
const artOf = (root: ArtNode): Artifact => ({ ...commitManual(createArtifact(M, '发布'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: 1 });

describe('v2.10 交接包再导入与往返', () => {
  it('toJSONCanvas → fromJSONCanvas 保留标题与父子关系', () => {
    const root = ROOT();
    const back = fromJSONCanvas(toJSONCanvas(root, M));
    expect(back.title).toContain('发布计划');
    const titles = (n: ArtNode): string[] => [n.title, ...(n.children ?? []).flatMap(titles)];
    expect(titles(back).sort()).toEqual(titles(root).sort());
    expect(back.children!.map((c) => c.title)).toEqual(['准备', '上线']);
  });
  it('packFiles 再 importPackFiles：优先用 board.canvas，结构可回来', () => {
    const files = packFiles(artOf(ROOT()), M, '# 发布计划\n\n## 准备\n锁定范围\n', 'csv');
    const r = importPackFiles(files);
    expect(r.source).toBe('board.canvas');
    expect(r.root.title).toMatch(/发布计划/);
    expect(r.root.children!.some((c) => c.title.includes('准备'))).toBe(true);
    expect(r.root.children!.some((c) => c.title.includes('上线'))).toBe(true);
  });
  it('没有 canvas 时从 outline.md 导入', () => {
    const r = importPackFiles([{ name: 'outline.md', text: '# 旅程\n\n引言\n\n## 第一天\n出发\n\n## 第二天\n到达\n' }]);
    expect(r.source).toBe('outline.md');
    expect(r.root.title).toBe('旅程');
    expect(r.root.children!.map((c) => c.title)).toEqual(['第一天', '第二天']);
  });
  it('缺文件时抛出中文错误', () => {
    expect(() => importPackFiles([{ name: 'README.txt', text: 'hi' }])).toThrow(/没有可导入/);
  });
  it('toMdTable 仍可用于导出（回归）', () => {
    expect(toMdTable(ROOT(), M)).toContain('## 准备');
  });
});
