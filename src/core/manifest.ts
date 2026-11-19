import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { checkMonotonic, checkMonotonicStrict, listOps } from './freedom';
import { registerCheck } from './checks';
import { DEFAULT_PIPELINE, DEFAULT_STAGES } from './roles';
import type { TypeManifest } from './types';

/**
 * 渲染积木注册表：核心不写死渲染器清单。界面层启动时注册自己提供的积木；
 * 未注册任何积木时（如纯核心脚本）跳过该项校验。
 */
const RENDERER_IDS = new Set<string>();

/** 图标是“图标名”而不是字符：界面用离线图标字体渲染，保证各平台一致 */
export const DEFAULT_TYPE_ICON = 'ri-file-list-3-line';
export function isIconName(v: unknown): boolean { return typeof v === 'string' && /^ri-[a-z0-9]+(-[a-z0-9]+)*$/.test(v); }
export function registerRenderers(ids: string[]) { for (const id of ids) RENDERER_IDS.add(id); }
export function listRenderers() { return [...RENDERER_IDS]; }

export interface ParseResult { manifest: TypeManifest | null; errors: string[]; warnings: string[] }

function isObj(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** 深合并（数组整体替换），用于 extends 继承 */
export function deepMerge<T>(base: T, over: any): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj((base as any)[k]) ? deepMerge((base as any)[k], v) : v;
  return out;
}

/**
 * 解析并校验一个类型插件（YAML 或 JSON 文本）。
 * resolveBase 用于 extends：继承另一个类型，只覆盖差异部分。
 */
export function parseManifest(text: string, resolveBase?: (id: string) => TypeManifest | undefined): ParseResult {
  const warnings: string[] = [];
  let raw: any;
  try { raw = yamlLoad(text); } catch (e: any) { return { manifest: null, errors: ['YAML 语法错误：' + (e?.message ?? e)], warnings }; }
  if (!isObj(raw)) return { manifest: null, errors: ['插件必须是一个对象'], warnings };
  return validateManifest(raw, resolveBase);
}

export function validateManifest(raw0: any, resolveBase?: (id: string) => TypeManifest | undefined): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw = raw0;
  if (raw.extends) {
    const base = resolveBase?.(raw.extends);
    if (!base) errors.push(`extends 指向的类型「${raw.extends}」不存在`);
    else { const { demo: _d, ...rest } = base; raw = deepMerge({ ...rest, demo: raw.demo ? undefined : base.demo }, { ...raw, extends: undefined }); }
  }
  if (!raw.id || !/^[a-z0-9][\w.-]*$/i.test(String(raw.id))) errors.push('id 必填，仅限字母数字 . _ -');
  if (!raw.name) errors.push('name 必填');
  const output = raw.output ?? (raw.renderer === 'code' ? 'text' : 'tree');
  if (!['tree', 'text'].includes(output)) errors.push('output 只能是 tree 或 text');
  const renderer = raw.renderer ?? (output === 'text' ? 'code' : 'tree');
  if (RENDERER_IDS.size) {
    if (!RENDERER_IDS.has(renderer)) errors.push(`renderer「${renderer}」未注册，可选：${listRenderers().join(', ')}`);
    for (const v of raw.views ?? []) if (!RENDERER_IDS.has(v)) errors.push(`views 中的「${v}」未注册`);
  }
  if (raw.media != null) {
    if (!isObj(raw.media) || typeof raw.media.capability !== 'string' || !raw.media.capability) errors.push('media 需要 capability（如 image / video）');
    else if (raw.media.scope && !['nodes', 'root'].includes(raw.media.scope)) errors.push('media.scope 只能是 nodes 或 root');
  }

  let stages = raw.stages;
  if (stages === undefined || stages === 'default') stages = DEFAULT_STAGES;
  if (!Array.isArray(stages) || !stages.length) errors.push('stages 必须是非空数组（或写 default）');
  else {
    stages = stages.map((s: any, i: number) => {
      const base = DEFAULT_STAGES.find((d) => d.id === s?.id);
      // 阶段级合并：同名默认阶段提供缺省值；一旦声明了 freedom 则整体替换（避免隐式继承约束）
      const st: any = base ? { ...base, ...s, freedom: s.freedom ?? base.freedom, pipeline: s.pipeline ?? base.pipeline } : { ...s };
      if (!st.name) st.name = st.id;
      if (!st.freedom) { errors.push(`阶段「${st.name ?? i + 1}」缺少 freedom 定义`); return st; }
      if (!st.id) errors.push(`第 ${i + 1} 个阶段缺少 id`);
      for (const op of st.freedom?.ops ?? []) if (!listOps().includes(op)) errors.push(`阶段「${st.name}」包含未注册的算子 ${op}`);
      if (typeof st.freedom?.temperature !== 'number') errors.push(`阶段「${st.name}」freedom.temperature 必须是数字`);
      return st;
    });
    if (!stages[0].freedom.ops.includes('generate')) warnings.push('第一个阶段通常应包含 generate 算子');
    if (!errors.length) warnings.push(...checkMonotonic(stages).map((w) => w + '（运行时将按逐维取严自动收紧）'));
  }
  const pipeline = raw.pipeline ?? DEFAULT_PIPELINE;
  if (!Array.isArray(pipeline.steps)) errors.push('pipeline.steps 必须是数组');
  else {
    const ids = new Set<string>();
    for (const s of pipeline.steps) {
      if (!s.id || !s.role) errors.push('pipeline 步骤需要 id 与 role');
      if (ids.has(s.id)) errors.push(`pipeline 步骤 id 重复：${s.id}`);
      ids.add(s.id);
    }
    for (const s of pipeline.steps) for (const n of s.needs ?? []) if (!ids.has(n)) warnings.push(`步骤 ${s.id} 依赖的 ${n} 不存在`);
  }
  if (output === 'tree' && renderer === 'code') errors.push('code 渲染器需要 output: text');
  if (isObj(raw.roles)) for (const [rid, r] of Object.entries<any>(raw.roles)) if (r?.icon != null && !isIconName(r.icon)) { warnings.push(`角色「${rid}」的 icon 不是图标名，将显示默认图标`); raw = { ...raw, roles: { ...raw.roles, [rid]: { ...r, icon: undefined } } }; }
  if (raw.icon != null && !isIconName(raw.icon)) { warnings.push(`icon「${String(raw.icon)}」不是图标名（应形如 ri-book-open-line），将显示默认图标`); raw = { ...raw, icon: DEFAULT_TYPE_ICON }; }
  if (errors.length) return { manifest: null, errors, warnings };
  const manifest: TypeManifest = {
    icon: DEFAULT_TYPE_ICON, category: '自定义', exporters: output === 'text' ? ['text', 'json'] : ['markdown', 'json'],
    ...raw, output, renderer, stages, pipeline,
  };
  return { manifest, errors, warnings };
}

export function dumpManifest(m: TypeManifest): string {
  return yamlDump(m, { lineWidth: 120, noRefs: true });
}

/** 类型注册表：内置 + 用户插件，后注册者覆盖同 id */
export class TypeRegistry {
  private map = new Map<string, { manifest: TypeManifest; source: 'builtin' | 'user'; raw: string; order: number; warnings: string[] }>();
  private seq = 0;
  readonly problems: { source: string; errors: string[] }[] = [];

  /** 两遍加载以支持 extends 任意顺序 */
  loadAll(entries: { text: string; source: 'builtin' | 'user'; file: string }[]) {
    const pending = [...entries];
    const base = this.seq;
    this.seq += entries.length;
    for (let pass = 0; pass < 3 && pending.length; pass++) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const e = pending[i];
        const r = parseManifest(e.text, (id) => this.get(id));
        if (r.manifest) { this.map.set(r.manifest.id, { manifest: r.manifest, source: e.source, raw: e.text, order: base + entries.indexOf(e), warnings: r.warnings }); pending.splice(i, 1); }
        else if (pass === 2 || !r.errors.some((x) => x.includes('extends'))) { this.problems.push({ source: e.file, errors: r.errors }); pending.splice(i, 1); }
      }
    }
  }
  register(m: TypeManifest, source: 'builtin' | 'user', raw = '', warnings: string[] = []) {
    const prev = this.map.get(m.id);
    this.map.set(m.id, { manifest: m, source, raw, order: prev?.order ?? this.seq++, warnings });
  }
  unregister(id: string) { this.map.delete(id); }
  get(id: string) { return this.map.get(id)?.manifest; }
  entry(id: string) { return this.map.get(id); }
  list() { return [...this.map.values()].sort((a, b) => a.order - b.order); }
}

/** 内置检查：草稿文本必须是合法的类型插件，且阶段自由度逐维递减（元类型使用） */
registerCheck('type-manifest', '类型校验', (d) => {
  if (!d.text) return ['没有可校验的文本'];
  const r = parseManifest(d.text);
  if (!r.manifest) return r.errors;
  return checkMonotonicStrict(r.manifest.stages);
});
