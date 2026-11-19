/** 术语表：简单模式用人话，专家模式保留工程术语（同一引擎、同一数据） */
import { OP_LABEL } from '../core';

export const SIMPLE_OP: Record<string, string> = { generate: '重新铺开', expand: '往下展开', restructure: '调整结构', detail: '补充细节', rewrite: '换个说法', patch: '小改一下' };
export const SIMPLE_OP_DESC: Record<string, string> = {
  generate: '从你的意图出发，一次铺开整体结构',
  expand: '在选中的部分下面增加新的子项',
  restructure: '重新组织选中部分的顺序与分组',
  detail: '给已有内容补充具体说明与细节',
  rewrite: '换一种表达方式，结构不变',
  patch: '只做最小的修改，其他地方一个字都不动',
};
export const SIMPLE_ROLE: Record<string, string> = { planner: '构思', generator: '撰写', critic: '检查', reviser: '修改', consistency: '通读', guard: '保护规则', 'process-planner': '规划', reviewer: '检查' };
export const SIMPLE_SCOPE: Record<string, string> = { artifact: '全部', subtree: '这一部分及下级', node: '只改这一条' };

export function opLabel(op: string, expert: boolean): string { return expert ? (OP_LABEL as Record<string, string>)[op] ?? op : SIMPLE_OP[op] ?? op; }
export function roleLabel(role: string, roleName: string, expert: boolean, stepId?: string): string {
  if (expert) return roleName;
  const round = roleName.match(/（第 \d+ 轮）/)?.[0] ?? '';
  if (stepId?.endsWith('-loop')) return '自动修改结束';
  if (stepId?.startsWith('guard') || role === 'guard') return '保护规则';
  if (stepId === 'cross-review') return '交叉检查';
  return (SIMPLE_ROLE[role] ?? roleName) + round;
}
export function whenText(when: string): string {
  const m = when.match(/critic\.score\s*<\s*(\d+(?:\.\d+)?)/);
  return m ? `检查不合格（低于 ${m[1]} 分）时自动修改，最多 2 轮` : `满足条件时运行（${when}）`;
}
export const step = (expert: boolean) => (expert ? '检查点' : '步骤');
export const BOLD_HINT = '像写作一样：先粗后细。第一步 AI 大胆铺开整体；越往后越克制——只改你选中的地方，你亲手改过的内容不会被 AI 动。';
