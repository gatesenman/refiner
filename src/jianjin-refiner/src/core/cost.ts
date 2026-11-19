/** Token 与费用：估算、按模型价目表计价、预算检查。价格单位：元 / 百万 tokens。 */
export interface Price { input: number; output: number }
export interface Usage { input: number; output: number; estimated?: boolean }
export interface UsageTotal { input: number; output: number; cost: number; runs: number }

/** 预置价目（2026 年公开价的近似值，用户可在设置中修改；美元价已按 1:7.2 折算） */
export const DEFAULT_PRICES: Record<string, Price> = {
  'deepseek-chat': { input: 2, output: 8 },
  'deepseek-reasoner': { input: 4, output: 16 },
  'qwen-turbo': { input: 0.3, output: 0.6 },
  'qwen-plus': { input: 0.8, output: 2 },
  'qwen-max': { input: 2.4, output: 9.6 },
  'moonshot-v1-8k': { input: 12, output: 12 },
  'kimi-k2': { input: 4, output: 16 },
  'glm-4-flash': { input: 0, output: 0 },
  'glm-4-plus': { input: 5, output: 5 },
  'doubao-pro-32k': { input: 0.8, output: 2 },
  'hunyuan-turbo': { input: 15, output: 50 },
  'gpt-4o-mini': { input: 1.08, output: 4.32 },
  'gpt-4o': { input: 18, output: 72 },
  'gpt-4.1': { input: 14.4, output: 57.6 },
  'claude-sonnet-4': { input: 21.6, output: 108 },
  'gemini-2.5-flash': { input: 2.16, output: 18 },
  demo: { input: 0, output: 0 },
};

/** 粗略估算：中日韩字符 ≈ 1 token/字，其余 ≈ 4 字符/token */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) ?? []).length;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

/** 找价：精确匹配，否则按最长前缀（如 qwen-plus-latest → qwen-plus）；本地模型（ollama 等）没有价视为 0 */
export function priceFor(model: string, table: Record<string, Price> = DEFAULT_PRICES): Price | null {
  const m = (model || '').toLowerCase();
  if (table[m]) return table[m];
  const keys = Object.keys(table).filter((k) => m.startsWith(k.toLowerCase())).sort((a, b) => b.length - a.length);
  return keys[0] ? table[keys[0]] : null;
}

export function costOf(u: Usage, model: string, table?: Record<string, Price>): number | null {
  const p = priceFor(model, table);
  if (!p) return null;
  return (u.input * p.input + u.output * p.output) / 1e6;
}

export function addUsage(t: UsageTotal | undefined, u: Usage, cost: number | null): UsageTotal {
  const b = t ?? { input: 0, output: 0, cost: 0, runs: 0 };
  return { input: b.input + u.input, output: b.output + u.output, cost: b.cost + (cost ?? 0), runs: b.runs + 1 };
}

/**
 * 运行前预估：每个调用模型的步骤都会带上当前内容 + 参考资料作为输入，
 * 输出约为当前内容大小（至少 600 tokens）。calls 为流水线调用次数（含评审循环上限）。
 */
export function estimateRun(opts: { calls: number; contextChars: string | number; refChars?: number; promptOverhead?: number }): Usage {
  const ctx = typeof opts.contextChars === 'string' ? estimateTokens(opts.contextChars) : Math.ceil(opts.contextChars * 0.8);
  const refs = Math.ceil((opts.refChars ?? 0) * 0.8);
  const per = (opts.promptOverhead ?? 700) + ctx + refs;
  const out = Math.max(600, ctx);
  return { input: per * opts.calls, output: out * opts.calls, estimated: true };
}

export interface Budget { perRun?: number; perWork?: number }

/** 预算检查：返回 null 表示放行，否则返回给用户看的说明 */
export function checkBudget(budget: Budget | undefined, estCost: number | null, workCost: number): string | null {
  if (!budget || estCost == null) return null;
  if (budget.perRun && budget.perRun > 0 && estCost > budget.perRun) return `预计本次费用 ${fmtCost(estCost)}，超过单次预算 ${fmtCost(budget.perRun)}。可以先选中一部分只改那里，或到「设置 → 费用与预算」调高上限。`;
  if (budget.perWork && budget.perWork > 0 && workCost + estCost > budget.perWork) return `这个作品已花费 ${fmtCost(workCost)}，加上本次预计 ${fmtCost(estCost)} 会超过作品预算 ${fmtCost(budget.perWork)}。可到「设置 → 费用与预算」调高上限。`;
  return null;
}

export function fmtTokens(n: number): string { return n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
export function fmtCost(c: number): string { return c === 0 ? '¥0' : c < 0.01 ? `¥${c.toFixed(4)}` : `¥${c.toFixed(2)}`; }
