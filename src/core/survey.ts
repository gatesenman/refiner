/**
 * v2.2 STORM 式多视角预写作（抽象、与场景无关）：
 * 在第一次「铺整体」之前，先用 2–3 个过程角色（执行者 / 审查者 / 使用者）各写一段短备忘，
 * 再交给生成者。不联网检索；只基于意图、已有大纲和参考资料。失败则跳过，不挡主流程。
 */
import { extractJSON } from './parse';
import { uid } from './tree';

export interface Perspective { id: string; name: string; notes: string }
export interface Survey { perspectives: Perspective[]; at: number }

export function surveyPrompt(intent: string, outline?: string, refs?: string): string {
  return `你是过程引擎里的「多视角预写作」步骤。不要生成最终成果，只从三个过程角色各写一段简短备忘（每段 2–4 句，具体、可执行、与领域无关的结构要求也可以），帮助下一步铺整体时少漏关键约束。

意图：${intent.slice(0, 400)}
${outline?.trim() ? `已有提纲：\n${outline.trim().slice(0, 800)}\n` : ''}${refs?.trim() ? `参考资料摘录：\n${refs.trim().slice(0, 800)}\n` : ''}
三个角色固定为：执行者（怎么落地）、审查者（风险、遗漏、可验证性）、使用者（接受标准与体验）。
只输出 JSON：{"perspectives":[{"name":"执行者","notes":"……"},{"name":"审查者","notes":"……"},{"name":"使用者","notes":"……"}]}`;
}

export function parseSurvey(text: string): Perspective[] {
  const obj = extractJSON(text) as any;
  const arr = obj?.perspectives ?? obj?.views ?? (Array.isArray(obj) ? obj : null);
  if (!Array.isArray(arr) || !arr.length) throw new Error('没有解析到视角');
  const out: Perspective[] = [];
  for (const x of arr) {
    const name = String(x?.name ?? x?.role ?? '').trim().slice(0, 16);
    const notes = String(x?.notes ?? x?.text ?? x?.content ?? '').trim().slice(0, 400);
    if (name && notes) out.push({ id: uid('pv'), name, notes });
  }
  if (out.length < 2) throw new Error('有效视角不足 2 个');
  return out.slice(0, 4);
}

export function surveyBlock(s?: Survey): string {
  const ps = s?.perspectives?.filter((p) => p.notes.trim()) ?? [];
  if (!ps.length) return '';
  return `\n\n【多视角备忘】铺整体前，几个过程角色已经各自看过一遍，生成时请吸收这些约束，不要当成要抄的正文：\n${ps.map((p) => `- ${p.name}：${p.notes}`).join('\n')}`;
}
