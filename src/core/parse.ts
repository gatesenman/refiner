import { jsonrepair } from 'jsonrepair';
/** 从模型输出中稳健地提取 JSON / 代码块 */
export function extractJSON(text: string): any {
  const t = text.trim();
  const fence = t.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1]);
  candidates.push(t);
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* next */ }
    try { return JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); } catch { /* next */ }
  }
  // 兜底：修复小模型常见的 JSON 错误（未转义引号、尾逗号、截断、注释等）
  for (const c of candidates) {
    try { return JSON.parse(jsonrepair(c)); } catch { /* next */ }
  }
  throw new Error('模型输出不是合法 JSON：' + t.slice(0, 120));
}

export function extractText(text: string): string {
  const m = text.match(/```[\w-]*\s*\n([\s\S]*?)```/);
  if (m) return m[1].replace(/\n$/, '');
  return text.trim();
}
