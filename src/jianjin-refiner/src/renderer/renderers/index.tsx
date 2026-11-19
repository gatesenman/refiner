import { registerRenderers } from '../../core';
import type { ComponentType } from 'react';
import type { RProps } from './types';
import { TreeView } from './Tree';
import { MindmapView } from './Mindmap';
import { TableView } from './Table';
import { BoardView } from './Board';
import { TimelineView } from './Timeline';
import { CodeView } from './Code';
import { GalleryView } from './Gallery';
import { DocView } from './Doc';

/** 渲染积木注册表：类型插件只通过 id 引用 */
export const RENDERERS: Record<string, { name: string; icon: string; fill?: boolean; C: ComponentType<RProps> }> = {
  tree: { name: '大纲树', icon: 'ri-list-unordered', C: TreeView },
  mindmap: { name: '脑图', icon: 'ri-mind-map', fill: true, C: MindmapView },
  table: { name: '表格', icon: 'ri-table-line', C: TableView },
  board: { name: '看板', icon: 'ri-layout-column-line', C: BoardView },
  timeline: { name: '时间线', icon: 'ri-bar-chart-horizontal-line', C: TimelineView },
  code: { name: '代码', icon: 'ri-code-s-slash-line', fill: true, C: CodeView },
  gallery: { name: '图库', icon: 'ri-gallery-view-2', C: GalleryView },
  doc: { name: '文档', icon: 'ri-article-line', C: DocView },
};

// 向核心注册本界面提供的积木：核心只校验“已注册”，不内置任何渲染器清单
registerRenderers(Object.keys(RENDERERS));
