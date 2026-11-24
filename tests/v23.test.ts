import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TypeRegistry, buildSchedule, normalizeNode, createArtifact, commitManual, toHtml, toMdTable, packFiles, toMermaid, toJSONCanvas } from '../src/core';
import type { ArtNode, TypeManifest, Artifact } from '../src/core';

const dir = join(__dirname, '..', 'plugins');
const reg = new TypeRegistry();
reg.loadAll(readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8'), source: 'builtin' as const })));
const outline = reg.get('outline')!;
const M: TypeManifest = {
  ...outline, id: 'bp-plan', name: '计划',
  nodeSchema: { ...(outline.nodeSchema ?? {}), props: [{ key: 'owner', label: '负责人', type: 'string' }, { key: 'date', label: '日期', type: 'date' }] },
  stages: buildSchedule(['整体框架', '逐项展开', '核对定稿']),
};
const ROOT = (): ArtNode => normalizeNode({ title: '发布计划 <v2>', children: [
  { title: '准备', content: '锁定范围', children: [{ title: '需求冻结', props: { date: '2026-11-02', owner: '李想' } }] },
  { title: '上线', content: '提交审核' },
] });
const artOf = (root: ArtNode): Artifact => ({ ...commitManual(createArtifact(M, '发布'), root, '初稿', M.stages[0].id, { pin: false }), stageIndex: 1 });

describe('v2.3 本地导出：HTML / Markdown 表 / 交接包', () => {
  it('toHtml：自包含、转义标题中的 <、含就绪度、含一级部分', () => {
    const html = toHtml(ROOT(), M, artOf(ROOT()));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('发布计划 &lt;v2&gt;');
    expect(html).not.toContain('发布计划 <v2>');
    expect(html).toMatch(/就绪 \d+%/);
    expect(html).toContain('准备');
    expect(html).toContain('system-ui');
    expect(html).toContain('Mermaid');
  });
  it('toMdTable：每个一级部分一张表，含属性列', () => {
    const md = toMdTable(ROOT(), M);
    expect(md).toContain('## 准备');
    expect(md).toMatch(/\| 标题 \| 说明 \|/);
    expect(md).toContain('负责人');
    expect(md).toContain('需求冻结');
    expect(md).toContain('李想');
  });
  it('packFiles：含 html、表格、canvas、mermaid 与说明', () => {
    const files = packFiles(artOf(ROOT()), M, '# 大纲', 'csv');
    const names = files.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['overview.html', 'table.md', 'board.canvas', 'diagram.mmd', 'README.txt', 'outline.md', 'table.csv']));
    const canvas = JSON.parse(files.find((f) => f.name === 'board.canvas')!.text);
    expect(canvas.nodes.length).toBe(toJSONCanvas(ROOT(), M).nodes.length);
    expect(files.find((f) => f.name === 'diagram.mmd')!.text).toBe(toMermaid(ROOT(), M).text);
    expect(files.find((f) => f.name === 'overview.html')!.text).toContain('就绪');
  });
});
