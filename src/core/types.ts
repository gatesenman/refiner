/**
 * 渐进 Refiner —— 核心契约（类型无关的渐进式精化引擎）
 * 所有内容类型（大纲、脑图、图片、视频……）都只是对这些契约的“声明式实例化”。
 * 核心代码不认识任何具体内容类型。
 */

/* ───────────── 1. 制品（Artifact）与片段（Node） ───────────── */

/** 可寻址的子部分：所有内容统一表示为一棵节点树（文本型内容 = 根节点 content） */
export interface ArtNode {
  id: string;
  title: string;
  content?: string;
  /** 由类型 schema 约束的结构化属性（优先级、状态、日期、图片 URL……） */
  props?: Record<string, unknown>;
  children?: ArtNode[];
  /** 锁定：后续任何阶段都不得修改（自由度收窄的显式手段） */
  locked?: boolean;
  /** 用户手动改过的字段（title / content / props.<key>）：成为后续 AI 运行的约束，由守卫强制 */
  pinned?: string[];
  /** 节点种类（通用）：open-question = 导入时识别出的“待澄清”问题 */
  kind?: string;
  /** 由程序从说明文字推断出的属性 key（显示“推断”标记） */
  inferred?: string[];
  /** v2.9 三方合并冲突：保留己方正文，这里记下上游的版本供对照 */
  conflict?: { theirsTitle: string; theirsContent?: string };
}

/** 固定事实：澄清 / 步骤间追问的回答，注入后续每一步 */
export interface Fact { id: string; q: string; a: string; from?: 'clarify' | 'review' | 'user'; at: number }

export interface Artifact {
  id: string;
  /** 来源模板 id；由流程规划师即时派生的流程为 bp-…（此时以 blueprint 为准） */
  typeId: string;
  /** 本制品自带的流程蓝图（即时派生或从模板复制后被用户改过）。存在时优先于注册表中的模板 */
  blueprint?: TypeManifest;
  title: string;
  /** 用户最初的一句话想法（种子） */
  seed: string;
  root: ArtNode;
  /** 当前所处阶段下标（对应 manifest.stages） */
  stageIndex: number;
  /** 当前版本指针 */
  head: string;
  versions: Version[];
  createdAt: number;
  updatedAt: number;
  /** 被用户跳过的阶段 id（简单模式步骤条显示“已跳过”） */
  skipped?: string[];
  /** 全部步骤完成的时间（显示完成卡） */
  finishedAt?: number;
  /** 参考资料（文件/文本/网址抽出的文字），每步作为上下文 */
  refs?: { id: string; name: string; kind: 'file' | 'text' | 'url'; text: string; addedAt: number; off?: boolean }[];
  /** 累计用量（tokens 与费用，元） */
  usage?: { input: number; output: number; cost: number; runs: number };
  /** 固定事实（澄清答案、步骤间追问的回答） */
  facts?: Fact[];
  /** v2.0 从撤回中学到的偏好（每步作为约束） */
  prefs?: import('./prefs').Pref[];
  /** AI 步骤间追问：待用户回答的问题（来自评审发现的缺失事实） */
  asks?: { id: string; q: string; options?: string[]; from?: string }[];
  /** 派生来源：以另一个作品为基础新建 */
  source?: { projectId: string; artifactId: string; title: string; versionId: string; refId?: string; dismissed?: string };
  /** v2.2 第一次铺整体前的多视角备忘 */
  survey?: import('./survey').Survey;
  /** v2.7 未提交的长任务检查点（崩溃或退出后可选择应用或丢弃） */
  runJournal?: import('./journal').RunCheckpoint;
}

/* ───────────── 2. 版本树 ───────────── */

export interface Version {
  id: string;
  parentId: string | null;
  stageId: string;
  op: OpKind | 'manual' | 'rollback' | 'init';
  targetId?: string;
  instruction?: string;
  label: string;
  root: ArtNode;
  log: AgentLogEntry[];
  createdAt: number;
  /** 该版本是在回到更早（自由度更高）的阶段后产生的：显式“放宽”分支 */
  loosened?: boolean;
  /** 多方案交叉设计：同一次运行产出的兄弟候选所属的组与人设 */
  fork?: { group: string; persona: string; score?: number };
  /** 用户已审阅（全部保留 / 之后又运行了新操作）：不再高亮改动 */
  reviewed?: boolean;
  /** 长任务中途停止或崩溃恢复：这一版只包含已完成的部分 */
  partial?: boolean;
  /** 撤回某一处 AI 改动而产生的版本（审阅中间态，仍以所属 AI 版本为基准高亮） */
  revert?: boolean;
  /** 审阅时逐条“保留”的节点 id */
  kept?: string[];
  /** 本步小结：评审分变化与评审指出的问题（用于“为什么改”） */
  /** 本次运行的用量 */
  usage?: { input: number; output: number; cost: number | null; estimated?: boolean; model?: string };
  summary?: { scoreFrom?: number; scoreTo?: number; issues?: string[]; rounds?: number; questions?: { q: string; options?: string[] }[]; kept?: string; drift?: number; whys?: Record<string, string> };
}

/* ───────────── 3. 操作与自由度 ───────────── */

/** 精化算子：内置 6 个（自由度从高到低）；可经 registerOp 注册新算子（声明权重与合并语义） */
export type OpKind = 'generate' | 'expand' | 'restructure' | 'detail' | 'rewrite' | 'patch';

/** 作用域：整份制品 / 选中子树 / 仅选中节点 */
export type Scope = 'artifact' | 'subtree' | 'node';

/** 约束严格度：宽松 / 遵守 schema / 严格（保持未选中部分逐字不变） */
export type Strictness = 'loose' | 'schema' | 'strict';

/** 自由度向量 —— 每个阶段声明一个，引擎保证其沿阶段单调收窄 */
export interface FreedomSpec {
  temperature: number;            // 0 ~ 1.5
  scope: Scope[];                 // 允许的作用域
  ops: OpKind[];                  // 允许的算子
  strictness: Strictness;
  /** 单次运行最多新增节点数（undefined = 不限） */
  maxNewNodes?: number;
  /** 不允许 AI 修改的属性键 */
  lockedProps?: string[];
  /** 是否必须选择目标片段才能运行 */
  requireTarget?: boolean;
  /** 冻结：内容不再变化，只产出衍生物（如出片、发布）。自由度记为 0 */
  frozen?: boolean;
}

export interface StageDef {
  id: string;
  name: string;
  description?: string;
  freedom: FreedomSpec;
  /** 阶段专属指导语（追加到提示词） */
  guidance?: string;
  /** 覆盖类型默认的智能体流水线 */
  pipeline?: PipelineDef;
  /** 多人设交叉设计：仅对 generate 生效，每个人设各出一份方案，互相评分，作为版本树上的兄弟分支 */
  fork?: { personas: { id: string; name: string; brief: string }[] };
}

/* ───────────── 4. 多智能体编排（可配置图） ───────────── */

export type RoleOutput = 'plan' | 'artifact' | 'review' | 'media';

export interface AgentRoleDef {
  id: string;
  name: string;
  /** 图标名（Remix Icon） */
  icon?: string;
  description?: string;
  output: RoleOutput;
  /** 系统提示词模板，支持 {{变量}} */
  system: string;
  /** 任务提示词模板 */
  task: string;
  /** 相对阶段温度的偏移（评审者通常更“冷”） */
  temperatureDelta?: number;
  /** output = media 时调用的能力（image / video / tts …），缺省取 manifest.media.capability */
  capability?: string;
}

/** 流水线中的一个节点。依赖 needs 构成 DAG；when 为条件边 */
export interface AgentStep {
  id: string;
  role: string;
  name?: string;
  enabled?: boolean;
  needs?: string[];
  /** 例如 "critic.score < 8"、"always"、"consistency.ok == false" */
  when?: string;
  /** media 步骤可单独指定能力 */
  capability?: string;
  /** 循环：本步骤完成后回到 with 指定的评审步骤，直到 until 成立 / 无提升 / 到达 maxRounds */
  loop?: { with: string; maxRounds?: number; until?: string; minGain?: number };
}

export interface PipelineDef {
  steps: AgentStep[];
}

/* ───────────── 5. 类型插件（纯声明式 Manifest） ───────────── */

export interface PropDef {
  key: string;
  label: string;
  type: 'string' | 'text' | 'number' | 'enum' | 'date' | 'url';
  options?: string[];
}

export interface TypeManifest {
  id: string;
  name: string;
  /** 图标名（Remix Icon，如 ri-file-list-3-line）；未知或旧式 emoji 值回退为默认图标 */
  icon?: string;
  category?: string;
  description?: string;
  version?: string;
  /** 模态标签（仅用于展示与分类，核心不据此分支） */
  modality?: string;
  /** 媒体能力声明：media 角色据此调用 Providers.media[capability]，读写哪个属性也由这里声明 */
  media?: MediaSpec;
  /** 程序化检查（注册表中的 id），发现的问题会回流给修订者，如 type-manifest */
  checks?: string[];
  /** 内容形态：tree = 节点树；text = 单一文本（代码/YAML/文章） */
  output: 'tree' | 'text';
  /** 文本形态的语言（yaml/json/markdown/plain） */
  language?: string;
  /** 渲染积木 id：tree | mindmap | table | board | timeline | code | gallery | doc */
  renderer: string;
  /** 额外可切换的视图 */
  views?: string[];
  rendererOptions?: Record<string, unknown>;
  /** levels：按深度推断出的节点种类（如 目标 / 工作包 / 任务），由流程规划师动态得出 */
  nodeSchema?: { props?: PropDef[]; maxDepth?: number; childLabel?: string; levels?: string[] };
  stages: StageDef[];
  pipeline: PipelineDef;
  /** 类型级提示词：领域知识、输出要求 */
  prompts?: { domain?: string; format?: string };
  /** 覆盖/新增智能体角色 */
  roles?: Record<string, Partial<AgentRoleDef>>;
  exporters?: string[];
  seedPlaceholder?: string;
  /** 演示模式样例数据（无 API Key 时使用） */
  demo?: { root?: ArtNode; text?: string };
  /** 可选的后置动作：例如 installAsType（元类型：生成的 YAML 可直接安装为新类型） */
  actions?: string[];
  /** 流程蓝图元信息：用户原始意图与蓝图来源（派生 / 模板 / 回退） */
  intent?: string;
  origin?: { kind: 'derived' | 'template' | 'fallback'; templateId?: string; templateName?: string };
}

/* ───────────── 6. Provider（多模态适配器） ───────────── */

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface ChatRequest {
  messages: ChatMessage[];
  temperature: number;
  /** 仅供演示 Provider 使用的结构化提示，真实 Provider 忽略 */
  meta?: Record<string, unknown>;
}

export interface TextProvider {
  id: string;
  chat(req: ChatRequest, onDelta?: (delta: string) => void, signal?: AbortSignal): Promise<string>;
}

export interface ImageProvider {
  id: string;
  generate(req: { prompt: string; size?: string; n?: number; meta?: Record<string, unknown> }): Promise<string[]>;
}

export interface VideoJob { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unconfigured'; url?: string; message?: string }

export interface VideoProvider {
  id: string;
  submit(req: { prompt: string; duration?: number; image?: string }): Promise<VideoJob>;
  poll(jobId: string): Promise<VideoJob>;
}

/** 媒体声明：核心只认识“能力 + 读写哪个字段”，不认识图片/视频 */
export interface MediaSpec {
  capability: string;
  /** 读取提示词的属性键（默认 prompt） */
  promptField?: string;
  /** 写入结果的属性键（默认 url）；异步任务另写 <outputField>Status / Job / Message */
  outputField?: string;
  /** nodes = 每个带提示词的节点各调用一次；root = 把整棵树合成一个请求（如整片） */
  scope?: 'nodes' | 'root';
  /** 固定参数（如 size） */
  params?: Record<string, unknown>;
  /** 从根节点属性读取的参数：参数名 → 属性键（如 duration: duration） */
  paramProps?: Record<string, string>;
}

export interface MediaResult {
  status: 'succeeded' | 'queued' | 'running' | 'failed' | 'unconfigured';
  urls?: string[];
  jobId?: string;
  message?: string;
}

/** 通用媒体 Provider：同步出结果，或提交异步任务后轮询 */
export interface MediaProvider {
  id: string;
  run(req: { prompt: string; params?: Record<string, unknown>; meta?: Record<string, unknown> }): Promise<MediaResult>;
  poll?(jobId: string): Promise<MediaResult>;
}

export interface Providers {
  text: TextProvider;
  /** 按能力注册：{ image: …, video: …, tts: … } */
  media?: Record<string, MediaProvider | undefined>;
}

/* ───────────── 7. 运行时事件 / 日志 ───────────── */

export interface AgentLogEntry {
  id: string;
  stepId: string;
  role: string;
  roleName: string;
  status: 'running' | 'done' | 'skipped' | 'error';
  startedAt: number;
  endedAt?: number;
  summary?: string;
  output?: string;
  score?: number;
}

export interface RunRequest {
  artifact: Artifact;
  manifest: TypeManifest;
  stageIndex: number;
  op: OpKind;
  targetId?: string;
  /** 文本型内容的选区 */
  selection?: { from: number; to: number; text: string };
  instruction?: string;
  /** 用户临时关闭的流水线步骤 */
  disabledSteps?: string[];
  providers: Providers;
  roles?: Record<string, AgentRoleDef>;
  signal?: AbortSignal;
  onLog?: (entry: AgentLogEntry) => void;
  onDelta?: (stepId: string, delta: string) => void;
  /** 参考资料（已按预算截断的文本），作为每个步骤的上下文 */
  references?: string;
  /** 全局偏好（设置里），与作品偏好合并后注入提示词 */
  globalPrefs?: import('./prefs').Pref[];
  /** 是否做多视角预写作（默认：第一次铺整体且树为空时做） */
  survey?: boolean;
  /** 多人设交叉设计时，本次运行所代表的人设 */
  persona?: { id: string; name: string; brief: string };
  /** v2.7 每完成一处就汇报当前已合并的树，供持久化检查点 */
  onCheckpoint?: (cp: import('./journal').RunCheckpoint) => void;
}

export interface RunResult {
  root: ArtNode;
  log: AgentLogEntry[];
  warnings: string[];
  version: Version;
  survey?: import('./survey').Survey;
}
