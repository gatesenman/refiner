import type { ArtNode, ImageProvider, MediaProvider, PropDef, TextProvider } from '../types';
import { imageMedia } from './media';
import { clone, walk } from '../tree';
import { sampleFor } from './demo-samples';

/**
 * 演示模式 Provider：不联网、不需要 Key。
 * 它读取引擎附带的结构化 meta，生成“看起来合理”的输出，并像真实模型一样以 JSON/代码块文本返回、流式吐字，
 * 因而走的是与真实模型完全相同的解析与合并路径。
 */
const ASPECTS = ['目标与范围', '关键要素', '实施路径', '风险与对策', '衡量指标', '资源与依赖', '用户场景', '里程碑'];
const DETAIL_SENT = [
  '明确输入、输出与验收标准，避免歧义。',
  '拆分为若干可在一周内完成的小步骤。',
  '列出关键假设，并给出最快的验证方式。',
  '与上下游部分保持一致，沿用已有术语。',
  '补充一个具体例子，帮助读者快速理解。',
  '标注主要风险及对应的缓解措施。',
  '给出可量化的衡量指标与目标值。',
  '说明它与整体目标之间的因果关系。',
  '指出常见误区，以及如何规避。',
  '列出所需资源、工具与前置条件。',
];

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function stripIds(n: ArtNode): any {
  const o: any = { title: n.title };
  if (n.content) o.content = n.content;
  if (n.props) o.props = n.props;
  if (n.children?.length) o.children = n.children.map(stripIds);
  return o;
}

function subst(n: any, seed: string): any {
  const s = (v: any) => (typeof v === 'string' ? v.replace(/\{\{seed\}\}/g, seed) : v);
  const o: any = { ...n, title: s(n.title), content: s(n.content) };
  if (n.props) o.props = Object.fromEntries(Object.entries(n.props).map(([k, v]) => [k, s(v)]));
  if (n.children) o.children = n.children.map((c: any) => subst(c, seed));
  return o;
}

function addDays(base: string, d: number) {
  const t = new Date(base + 'T00:00:00');
  t.setDate(t.getDate() + d);
  return t.toISOString().slice(0, 10);
}

function fillProps(props: PropDef[] = [], i: number, title: string, existing: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  const today = new Date().toISOString().slice(0, 10);
  for (const p of props) {
    if (out[p.key] != null && out[p.key] !== '') continue;
    if (p.type === 'enum' && p.options?.length) out[p.key] = p.options[(hash(title) + i) % p.options.length];
    else if (p.type === 'date') out[p.key] = addDays(today, p.key.includes('end') ? 7 + i * 5 : i * 5);
    else if (p.type === 'number') out[p.key] = ((hash(title) % 5) + 1) * (p.key.includes('hour') ? 4 : 1);
    else if (p.key === 'prompt') out[p.key] = `${title}，电影感光影，细节丰富，高清`;
    else if (p.type === 'text' || p.type === 'string') out[p.key] = `${title}的${p.label}`;
  }
  return out;
}

function mockTree(meta: any): any {
  const op = meta.op as string;
  const props: PropDef[] = meta.nodeSchema?.props ?? [];
  const label = meta.nodeSchema?.childLabel ?? '要点';
  const seed = String(meta.seed ?? '');
  const instr = String(meta.instruction ?? '');
  const sample = sampleFor(seed);
  if (meta.role === 'reviser' && meta.draft && typeof meta.draft === 'object' && sample) return stripIds(meta.draft as ArtNode);
  if (op === 'generate' && sample && !meta.persona) return clone(sample.root);
  if (op === 'expand' && sample) {
    const t: ArtNode = clone(meta.target ?? meta.root);
    const add = (/雨/.test(instr) && sample.rain) ? sample.rain : sample.expand?.[t.title];
    if (add) return { ...t, children: [...(t.children ?? []), ...clone(add as any)] };
    // 展开“全部”：把样例里为各部分准备的补充内容挂到对应部分下面
    if (sample.expand && t.children?.some((c) => sample.expand![c.title])) {
      return { ...t, children: t.children!.map((c) => (sample.expand![c.title] ? { ...c, children: [...(c.children ?? []), ...clone(sample.expand![c.title] as any)] } : c)) };
    }
  }
  if (meta.role === 'reviser' && meta.draft && typeof meta.draft === 'object') {
    const d = clone(meta.draft as ArtNode);
    let fixed = 0;
    walk(d, (n, _p, depth) => {
      if (depth > 0 && !n.content && fixed < 3) { n.content = `${DETAIL_SENT[(hash(n.title) + fixed) % DETAIL_SENT.length]}`; fixed++; }
    });
    return d;
  }
  if (op === 'generate' && meta.persona) {
    // 多人设交叉设计：不同人设给出结构不同的方案
    const P: Record<string, string[]> = {
      structure: ['目标与范围', '关键要素', '实施路径', '衡量指标'],
      creative: ['用户场景', '关键要素', '风险与对策', '里程碑', '资源与依赖'],
      pragmatic: ['实施路径', '资源与依赖', '里程碑'],
    };
    const asp = P[meta.persona] ?? ASPECTS.slice(hash(meta.persona) % 4, (hash(meta.persona) % 4) + 4);
    const base = meta.demo?.root ? subst(stripIds(meta.demo.root), seed) : { title: seed || '新主题' };
    return { ...base, children: asp.map((a, i) => ({ title: a, content: DETAIL_SENT[(i + hash(meta.persona)) % DETAIL_SENT.length], props: fillProps(props, i, a), children: [{ title: `${a} · ${label}1`, props: fillProps(props, i + 1, a + 1) }] })) };
  }
  if (op === 'generate') {
    if (meta.demo?.root && meta.nodeSchema?.levels?.length) {
      // 流程蓝图：一级结构来自规划师，向下按推断出的层级各铺两项
      const r = subst(stripIds(meta.demo.root), seed);
      const lv: string[] = meta.nodeSchema.levels;
      r.children = (r.children ?? []).map((c: any, i: number) => ({ ...c, content: c.content ?? DETAIL_SENT[(i + hash(c.title)) % DETAIL_SENT.length], props: fillProps(props, i, c.title, c.props),
        children: c.children ?? (lv.length > 2 ? [0, 1].map((j) => ({ title: `${c.title} · ${lv[2] ?? label}${j + 1}`, props: fillProps(props, i + j + 1, c.title + j) })) : undefined) }));
      return r;
    }
    if (meta.demo?.root) return subst(stripIds(meta.demo.root), seed);
    return {
      title: seed || '新主题',
      children: ASPECTS.slice(0, 5).map((a, i) => ({ title: a, props: fillProps(props, i, a), children: [0, 1].map((j) => ({ title: `${a} · ${label}${j + 1}`, props: fillProps(props, i + j, a + j) })) })),
    };
  }
  const target: ArtNode = clone(meta.target ?? meta.root);
  if (op === 'expand') {
    const base = target.children?.length ?? 0;
    const add = [0, 1, 2].map((i) => {
      const t = `${ASPECTS[(base + i + hash(target.title)) % ASPECTS.length]}`;
      const title = target.id === meta.root?.id ? `${t}` : `${target.title} · ${t}`;
      return { title, content: DETAIL_SENT[(i + base) % DETAIL_SENT.length], props: fillProps(props, base + i, title) };
    });
    return { ...target, children: [...(target.children ?? []), ...add] };
  }
  if (op === 'detail') {
    let i = 0;
    walk(target, (n) => {
      if (!n.content || n.content.length < 40) n.content = `${n.content ? n.content + '\n' : ''}${n.title}：${DETAIL_SENT[i % DETAIL_SENT.length]}${DETAIL_SENT[(i + 2) % DETAIL_SENT.length]}`;
      if (props.length) n.props = fillProps(props, i, n.title, n.props);
      i++;
    });
    return target;
  }
  if (op === 'restructure') {
    const kids = target.children ?? [];
    if (kids.length >= 4) {
      const half = Math.ceil(kids.length / 2);
      target.children = [
        { id: '', title: '核心部分', children: kids.slice(0, half) } as any,
        { id: '', title: '扩展部分', children: kids.slice(half) } as any,
      ].map(({ id: _i, ...r }) => r) as any;
    } else target.children = [...kids].reverse();
    return target;
  }
  if (op === 'rewrite') {
    target.content = `${target.title}——${instr ? `按“${instr}”改写：` : '更清晰的表述：'}${DETAIL_SENT[hash(target.title) % DETAIL_SENT.length]}`;
    return target;
  }
  // patch：最小改动
  const opt = props.flatMap((p) => (p.options ?? []).map((o) => ({ p, o }))).find(({ o }) => instr.includes(o));
  if (opt) target.props = { ...(target.props ?? {}), [opt.p.key]: opt.o };
  const rename = opt ? null : instr.match(/(?:改为|改成|重命名为)[「“"]?([^」”"]+)[」”"]?/);
  if (rename) target.title = rename[1].trim();
  else if (!opt) target.content = `${target.content ? target.content + '\n' : ''}【调整】${instr || '已微调措辞'}`;
  if (target.props?.prompt && instr) target.props = { ...target.props, prompt: `${target.props.prompt}，${instr}` };
  return target;
}

function mockText(meta: any): string {
  const lang = meta.language ?? 'text';
  const seed = String(meta.seed ?? '');
  const cur = String(meta.root?.content ?? '');
  const instr = String(meta.instruction ?? '');
  const c = lang === 'yaml' ? '#' : lang === 'markdown' ? '>' : '//';
  if (meta.role === 'reviser') return String(meta.draft ?? cur);
  if (meta.op === 'generate') return String(meta.demo?.text ?? `${c} ${seed}\n`).replace(/\{\{seed\}\}/g, seed);
  if (meta.selection) {
    const t = String(meta.selection.text);
    if (/大写|upper/i.test(instr)) return t.toUpperCase();
    return `${t.replace(/\s+$/, '')} ${c} 已调整：${instr || '优化'}${t.endsWith('\n') ? '\n' : ''}`;
  }
  if (meta.op === 'expand' || meta.op === 'detail') {
    if (lang === 'yaml') return `${cur.replace(/\s+$/, '')}\n\n${c} ── 细化补充 ──\nmeta:\n  generatedBy: 渐进 Refiner\n  stage: ${meta.stageId}\n  notes:\n    - 补充了默认值与注释\n    - 所有字段已按 schema 校验\n`;
    return `${cur.replace(/\s+$/, '')}\n\n${c} 细化补充：${DETAIL_SENT.slice(0, 3).join(' ')}\n`;
  }
  return `${cur.replace(/\s+$/, '')}\n${c} 调整：${instr || '整体润色'}\n`;
}

/* ───── 演示版“流程规划师”：没有模型时，用意图里的形态线索（时间 / 数据结构 / 执行 / 创作 / 决策）推断蓝图 ─────
 * 这只是演示 Provider 的启发式（相当于一个很小的“模型”），引擎本身不包含这些知识；
 * 任何没有线索的意图都会得到通用的大纲形态 + 按复杂度推断的检查点数量，从不失败。 */
interface Cue { id: string; re: RegExp; icon: string; noun: string; renderer: string; views: string[]; levels: string[]; props: PropDef[]; names: string[]; parts: (intent: string) => string[] }
const CN_NUM: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };
const CUES: Cue[] = [
  {
    id: 'time', re: /[一两二三四五六七八九十\d]+\s*(天|日|周|个月)|周末|行程|日程|旅行|旅游|假期|活动|会议|婚礼|典礼|团建|\bdays?\b|\bweeks?\b|trip|schedule|event|wedding/i, icon: 'ri-calendar-event-line', noun: '日程方案',
    renderer: 'tree', views: ['timeline', 'table', 'board'], levels: ['整体安排', '时段', '具体事项'],
    props: [{ key: 'start', label: '开始', type: 'date' }, { key: 'end', label: '结束', type: 'date' }, { key: 'owner', label: '负责人', type: 'string' }, { key: 'status', label: '状态', type: 'enum', options: ['待定', '已确认', '完成'] }],
    names: ['整体构想', '日程骨架', '细节安排', '执行清单'],
    parts: (t) => { const m = t.match(/([一两二三四五六七1-7])\s*[天日]/); const n = m ? (CN_NUM[m[1]] ?? Number(m[1])) : 0; return n ? ['目标与预算', ...Array.from({ length: n }, (_, i) => `第 ${i + 1} 天`), '物料与后勤'] : ['目标与预算', '前期准备', '当天流程', '物料与后勤', '复盘']; },
  },
  {
    id: 'data', re: /数据|字段|表结构|schema|模型|实体|接口|配置|参数|规格|清单|database|table/i, icon: 'ri-database-2-line', noun: '结构定义',
    renderer: 'table', views: ['tree', 'mindmap'], levels: ['整体', '实体', '字段'],
    props: [{ key: 'type', label: '类型', type: 'string' }, { key: 'required', label: '必需', type: 'enum', options: ['是', '否'] }, { key: 'note', label: '备注', type: 'text' }],
    names: ['概念建模', '结构细化', '字段校准'],
    parts: () => ['核心实体', '业务实体', '关联关系', '索引与约束', '权限与安全'],
  },
  {
    id: 'exec', re: /任务|待办|执行|落地|推进|上线|项目|改造|迁移|launch|project|todo/i, icon: 'ri-task-line', noun: '执行方案',
    renderer: 'tree', views: ['board', 'table'], levels: ['目标', '工作包', '任务'],
    props: [{ key: 'owner', label: '负责人', type: 'string' }, { key: 'status', label: '状态', type: 'enum', options: ['待办', '进行中', '完成'] }],
    names: ['目标拆解', '工作包细化', '任务调整'],
    parts: () => ['目标与范围', '准备', '执行', '验收与复盘'],
  },
  {
    id: 'create', re: /歌|诗|故事|文案|小说|剧本|散文|演讲|作文|创作|写|song|poem|story|lyric/i, icon: 'ri-quill-pen-line', noun: '作品',
    renderer: 'doc', views: ['tree', 'mindmap'], levels: ['整体构思', '段落', '细节'],
    props: [{ key: 'mood', label: '情绪', type: 'string' }],
    names: ['发散构思', '成形', '打磨', '定稿'],
    parts: () => ['主题与情绪', '开头', '展开', '高潮', '收尾'],
  },
  {
    id: 'decide', re: /决定|选择|是否|该不该|策略|战略|评估|研究|问题|方向|分析|对比|decide|strategy|research/i, icon: 'ri-scales-3-line', noun: '决策分析',
    renderer: 'mindmap', views: ['tree', 'table', 'doc'], levels: ['问题', '选项', '论据'],
    props: [{ key: 'evidence', label: '依据', type: 'text' }, { key: 'risk', label: '风险', type: 'enum', options: ['高', '中', '低'] }],
    names: ['发散选项', '收敛比较', '论证', '决策定稿'],
    parts: () => ['问题定义', '可选方向', '评估标准', '关键证据', '建议与下一步'],
  },
];
function cueOf(intent: string) { return CUES.find((c) => c.id === 'create' && c.re.test(intent)) ?? CUES.find((c) => c.re.test(intent)); }
function nounPhrase(intent: string) {
  return intent.replace(/^(帮我|请|我想|我要|想要)?\s*(策划|设计|制定|写|做|规划|准备|搭建|打造|组织|研究|决定|分析)?\s*(一场|一个|一份|一款|一首|一次|一套|一部|一篇)?/, '').replace(/^[：:，,、\s]+/, '').replace(/[。.!！?？]+$/, '').slice(0, 12) || intent.slice(0, 12);
}
function mockPlanner(meta: any): string {
  const intent = String(meta.intent ?? '');
  const cue = cueOf(intent);
  if (meta.role === 'process-shape') {
    const best = (meta.candidates ?? [])[0];
    if (best && best.score >= 0.45) return '```json\n' + JSON.stringify({ template: best.id }) + '\n```';
    const shape = cue
      ? { name: nounPhrase(intent), icon: cue.icon, summary: `「${intent}」的${cue.noun}`, levels: cue.levels, props: cue.props, parts: cue.parts(intent), renderer: cue.renderer, views: cue.views }
      : { name: nounPhrase(intent), icon: 'ri-node-tree', summary: `「${intent}」的结构化方案`, levels: ['主题', '部分', '要点'], props: [], parts: ['目标与范围', '关键要素', '实施路径', '风险与对策'], renderer: 'tree', views: ['mindmap', 'table', 'doc'] };
    return '```json\n' + JSON.stringify(shape, null, 2) + '\n```';
  }
  if (meta.role === 'process-schedule') {
    const base = cue ? cue.names.length : 3;
    const n = Math.min(cue ? cue.names.length : 5, base + (intent.length > 40 ? 1 : 0));
    const names = cue ? cue.names.slice(0, n) : (n === 4 ? ['发散', '成形', '细化', '定稿'] : ['生成', '细化', '调整']);
    const stages = names.map((name, i) => {
      const t = n === 1 ? 0 : i / (n - 1);
      return i === 0 ? { name, description: '从意图出发铺开整体', temperature: 1.0, scope: ['artifact'], ops: ['generate'], strictness: 'loose' }
        : t < 0.5 ? { name, description: '扩展与重组主要部分', temperature: 0.75, scope: ['artifact', 'subtree'], ops: ['expand', 'detail', 'restructure'], strictness: 'schema', maxNewNodes: 20 }
          : t < 0.9 ? { name, description: '补足细节与属性', temperature: 0.5, scope: ['subtree', 'node'], ops: ['detail', 'rewrite'], strictness: 'schema', maxNewNodes: 6 }
            : { name, description: '选中片段精确修改', temperature: 0.3, scope: ['subtree', 'node'], ops: ['rewrite', 'patch'], strictness: 'strict', maxNewNodes: 2, requireTarget: true };
    });
    return '```json\n' + JSON.stringify({ stages }, null, 2) + '\n```';
  }
  // process-reviser：逐维取严修正
  const st = (meta.stages ?? []) as any[];
  let prevT = Infinity, prevN = Infinity;
  const fixed = st.map((s) => { const temperature = Math.min(s.temperature ?? 1, prevT); prevT = temperature; const maxNewNodes = s.maxNewNodes == null ? (prevN === Infinity ? undefined : prevN) : Math.min(s.maxNewNodes, prevN); if (maxNewNodes != null) prevN = maxNewNodes; return { ...s, temperature, maxNewNodes }; });
  return '```json\n' + JSON.stringify({ stages: fixed }, null, 2) + '\n```';
}

export function mockRespond(meta: any): string {
  const role = meta.role;
  if (role === 'process-clarify') {
    // 演示：明显含糊才追问（真实模型会自己判断）
    return '```json\n' + JSON.stringify({ questions: meta.vague ? [
      { q: '你想做的是？', options: ['活动或计划', '文档或文章', '方案或决策', '设计或结构', '其他'] },
      { q: '给谁看？', options: ['自己', '团队', '客户或老板'] },
      { q: '要多细？', options: ['一页概要', '可执行清单', '详细方案'] },
    ] : [] }) + '\n```';
  }
  if (typeof role === 'string' && role.startsWith('process-')) return mockPlanner(meta);
  if (meta.output === 'plan' || role === 'planner') {
    const t = meta.target?.title ?? meta.seed;
    return [
      `1. 明确「${t}」在本阶段要达成的结果与边界`,
      `2. 以${meta.op === 'generate' ? '广度优先的方式铺开 4~6 个主要部分' : '选中部分为中心，只在范围内操作'}`,
      '3. 保持已有结构与术语一致，复用已有节点 id',
      meta.instruction ? `4. 落实用户指令：${meta.instruction}` : '4. 每个新增部分给出一句可执行的说明',
      '5. 交给评审者检查完整性与具体性',
    ].join('\n');
  }
  if (meta.output === 'review') {
    if (role === 'critic' && meta.crossOf) {
      const score = 6.5 + (hash(String(meta.crossOf) + String(meta.persona)) % 30) / 10;
      return JSON.stringify({ score: Math.round(score * 10) / 10, issues: score < 8 ? ['与评审者视角相比，可执行细节不足'] : [], suggestions: [] });
    }
    if (role === 'critic') {
      const first = !(meta.reviews?.length);
      const score = first && meta.op !== 'patch' ? 6.5 : 8.5;
      return JSON.stringify({
        score,
        issues: score < 8 ? ['部分子项缺少具体说明，难以直接执行', '个别标题过于笼统'] : [],
        suggestions: score < 8 ? ['为缺少说明的节点补充一句可执行描述', '标题使用“动词+对象”的形式'] : [],
      });
    }
    return JSON.stringify({ ok: true, score: 9, issues: [] });
  }
  if (meta.manifestOutput === 'text') return '```' + (meta.language ?? '') + '\n' + mockText(meta) + '\n```';
  return '```json\n' + JSON.stringify(mockTree(meta), null, 2) + '\n```';
}

export function createMockText(delayMs = 12): TextProvider {
  return {
    id: 'demo',
    async chat(req, onDelta, signal) {
      const text = mockRespond(req.meta ?? {});
      if (delayMs > 0) {
        const chunk = Math.max(8, Math.ceil(text.length / 40));
        for (let i = 0; i < text.length; i += chunk) {
          if (signal?.aborted) throw new Error('已取消');
          onDelta?.(text.slice(i, i + chunk));
          await sleep(delayMs);
        }
      } else onDelta?.(text);
      return text;
    },
  };
}

/** 演示图像：根据提示词哈希生成抽象 SVG（明确标注“演示图像”） */
export function demoImage(prompt: string, title = ''): string {
  const h = hash(prompt);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h >> 8) % 120) % 360;
  const shapes: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = (h >> (i * 3)) % 512; const y = (h >> (i * 2 + 5)) % 512; const r = 30 + ((h >> i) % 110);
    shapes.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="hsla(${(hue + i * 37) % 360},70%,${55 + (i % 3) * 8}%,0.35)"/>`);
  }
  const mountains = `<path d="M0 400 L${90 + (h % 60)} ${280 + (h % 40)} L200 360 L${300 + (h % 50)} ${250 + (h % 30)} L512 390 L512 512 L0 512Z" fill="hsla(${hue2},40%,18%,0.75)"/>`;
  const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]!));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,62%)"/><stop offset="1" stop-color="hsl(${hue2},60%,30%)"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/>${shapes.join('')}${mountains}<rect x="0" y="452" width="512" height="60" fill="rgba(0,0,0,0.45)"/><text x="16" y="478" font-family="sans-serif" font-size="18" fill="#fff">${esc((title || prompt).slice(0, 22))}</text><text x="16" y="500" font-family="sans-serif" font-size="12" fill="rgba(255,255,255,0.75)">演示图像 · 配置图像 API 后生成真实图片</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function createMockImage(): ImageProvider {
  return {
    id: 'demo-image',
    async generate(req) { await sleep(120); return [demoImage(req.prompt, String(req.meta?.title ?? ''))]; },
  };
}

/** 演示模式的媒体能力表：只有 image（明确标注“演示图像”）；不提供 video —— 不伪造视频 */
export function createMockMedia(): Record<string, MediaProvider> {
  return { image: imageMedia(createMockImage()) };
}
