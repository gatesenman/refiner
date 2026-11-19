import type { AgentRoleDef, PipelineDef, StageDef } from './types';

/** 内置智能体角色。类型插件可以通过 manifest.roles 覆盖或新增角色 */
export const DEFAULT_ROLES: Record<string, AgentRoleDef> = {
  planner: {
    id: 'planner', name: '规划师', icon: 'ri-compass-3-line', output: 'plan', temperatureDelta: -0.1,
    description: '先拆解任务、明确本次要做什么，再交给生成者',
    system: '你是「{{type.name}}」领域的资深规划师。你只负责制定本次操作的执行计划，不直接产出内容。\n{{type.prompts.domain}}',
    task: '任务：对「{{seed}}」执行【{{stage.name}} · {{opLabel}}】操作。\n算子含义：{{opDesc}}\n{{#if instruction}}用户指令：{{instruction}}\n{{/if}}{{#if targetTitle}}作用对象：「{{targetTitle}}」\n{{/if}}约束：\n{{constraints}}\n\n当前内容：\n{{outline}}\n\n请用 3~6 条要点给出执行计划（中文、简洁）。',
  },
  generator: {
    id: 'generator', name: '生成者', icon: 'ri-quill-pen-line', output: 'artifact',
    description: '依据计划与约束产出内容草稿',
    system: '你是「{{type.name}}」的创作专家。{{type.description}}\n{{type.prompts.domain}}\n{{stage.guidance}}\n{{#if persona}}你的设计人设：{{persona}}——请鲜明地体现这一视角，与其他人设拉开差异。\n{{/if}}你必须严格遵守输出格式要求。',
    task: '种子想法：{{seed}}\n阶段：{{stage.name}}（{{stage.description}}）\n算子：{{opLabel}} —— {{opDesc}}\n{{#if instruction}}用户指令：{{instruction}}\n{{/if}}{{#if plan}}执行计划：\n{{plan}}\n{{/if}}约束（必须遵守）：\n{{constraints}}\n{{#if schema}}节点属性定义：\n{{schema}}\n{{/if}}\n{{#if current}}当前完整内容：\n{{current}}\n{{/if}}{{#if target}}\n本次只处理以下目标部分：\n{{target}}\n{{/if}}\n{{format}}',
  },
  critic: {
    id: 'critic', name: '评审者', icon: 'ri-search-eye-line', output: 'review', temperatureDelta: -0.4,
    description: '从完整性、具体性、可执行性角度挑错并打分',
    system: '你是严格的「{{type.name}}」评审专家，只做评审，不重写内容。',
    task: '种子想法：{{seed}}\n阶段：{{stage.name}} · {{opLabel}}\n{{#if instruction}}用户指令：{{instruction}}\n{{/if}}约束：\n{{constraints}}\n\n待评审草稿：\n{{draft}}\n\n请输出 JSON：{"score": 0~10 的数字, "issues": ["问题…"], "suggestions": ["建议…"], "questions": [{"q": "只有用户知道的关键事实（如总预算、地点、截止日期）", "options": ["选项…"]}]}。questions 只在缺少只有用户才能回答的关键事实时给出，最多 3 个，否则省略。只输出 JSON。',
  },
  reviser: {
    id: 'reviser', name: '修订者', icon: 'ri-tools-line', output: 'artifact', temperatureDelta: -0.2,
    description: '根据评审意见修订草稿，保持约束',
    system: '你是「{{type.name}}」的修订专家，根据评审意见改进草稿，同时遵守全部约束。{{type.prompts.domain}}',
    task: '种子想法：{{seed}}\n阶段：{{stage.name}} · {{opLabel}}\n{{#if instruction}}用户指令：{{instruction}}\n{{/if}}约束：\n{{constraints}}\n\n{{#if targetTitle}}{{ancestry}}\n\n本次只处理以下目标部分：\n{{draft}}\n\n只修订这个目标部分，输出的根节点必须是「{{targetTitle}}」本身（保留其 id），不要输出其它部分或整份文档。\n{{/if}}{{#unless targetTitle}}草稿：\n{{draft}}\n{{/unless}}\n评审意见：\n{{reviews}}\n\n请输出修订后的结果。\n{{format}}',
  },
  consistency: {
    id: 'consistency', name: '一致性检查', icon: 'ri-puzzle-line', output: 'review', temperatureDelta: -0.6,
    description: '检查草稿与整体内容、约束、结构定义是否一致',
    system: '你是一致性审查员，检查内容是否与上下文、约束和结构定义一致。',
    task: '约束：\n{{constraints}}\n{{#if schema}}结构定义：\n{{schema}}\n{{/if}}\n整体上下文：\n{{outline}}\n\n本次产出：\n{{draft}}\n\n请输出 JSON：{"ok": true/false, "score": 0~10, "issues": ["…"]}。只输出 JSON。',
  },
  media: {
    id: 'media', name: '媒体生成', icon: 'ri-film-line', output: 'media',
    description: '按类型声明的 media.capability 调用对应能力的 Provider（核心不区分图片/视频/语音）',
    system: '', task: '',
  },
};

export const DEFAULT_PIPELINE: PipelineDef = {
  steps: [
    { id: 'planner', role: 'planner' },
    { id: 'generator', role: 'generator', needs: ['planner'] },
    { id: 'critic', role: 'critic', needs: ['generator'] },
    { id: 'reviser', role: 'reviser', needs: ['critic'], when: 'critic.score < 8', loop: { with: 'critic', maxRounds: 2, until: 'critic.score >= 8', minGain: 0.3 } },
    { id: 'consistency', role: 'consistency', needs: ['reviser'] },
  ],
};

/** 默认三阶段：生成 → 细化 → 调整（自由度单调递减） */
export const DEFAULT_STAGES: StageDef[] = [
  {
    id: 'generate', name: '生成', description: '从一句话生成粗略的整体初稿，鼓励发散',
    freedom: { temperature: 1.0, scope: ['artifact'], ops: ['generate'], strictness: 'loose' },
  },
  {
    id: 'refine', name: '细化', description: '针对整体或选中的部分扩展、细化、重组',
    freedom: { temperature: 0.7, scope: ['artifact', 'subtree'], ops: ['expand', 'detail', 'restructure'], strictness: 'schema', maxNewNodes: 30 },
  },
  {
    id: 'adjust', name: '调整', description: '选中具体片段，按指令做精确的小范围修改',
    freedom: { temperature: 0.3, scope: ['subtree', 'node'], ops: ['rewrite', 'patch'], strictness: 'strict', maxNewNodes: 5, requireTarget: true },
    pipeline: {
      steps: [
        { id: 'generator', role: 'generator' },
        { id: 'consistency', role: 'consistency', needs: ['generator'] },
      ],
    },
  },
];

/** 多人设交叉设计的默认人设（发散阶段使用；类型可在 stage.fork.personas 中自定义） */
export const DEFAULT_PERSONAS = [
  { id: 'structure', name: '结构派', brief: '追求完整、层次清晰、MECE 的结构' },
  { id: 'creative', name: '创意派', brief: '从用户场景出发，大胆提出新颖角度' },
  { id: 'pragmatic', name: '落地派', brief: '只保留能马上执行的部分，强调资源与里程碑' },
];
