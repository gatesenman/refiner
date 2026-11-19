import { load as yamlLoad } from 'js-yaml';
import type { ArtNode, TypeManifest } from './types';
import { normalizeNode, uid, walk } from './tree';
import { readiness } from './maturity';

/**
 * 从已有材料开始：把各种格式解析成通用节点树（与场景无关）。
 * 二进制格式（docx/pdf/xlsx/xmind）先由渲染层抽成文本/行/JSON，再交给这里。
 */
export type ImportKind = 'structure' | 'content';
export interface ImportResult {
  /** structure：本身就是结构（大纲/脑图/JSON），直接作为初稿；content：文档内容，作为参考资料并可作为初稿 */
  kind: ImportKind;
  /** 抽取出的纯文本（作参考资料用） */
  text: string;
  /** 解析出的结构（可能为空） */
  tree?: ArtNode;
  title: string;
  /** 解析时的提示（如“PDF 没有可提取的文字”） */
  notes?: string[];
}

const n = (title: string, children: ArtNode[] = [], content?: string, props?: Record<string, unknown>): ArtNode =>
  ({ id: uid('n'), title: title.trim(), ...(content?.trim() ? { content: content.trim() } : {}), ...(props && Object.keys(props).length ? { props } : {}), ...(children.length ? { children } : {}) });

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

/** Markdown/纯文本：标题层级 + 列表缩进 → 树；同时兼容本应用的 Markdown 导出（> 属性行、- **标题**：说明） */
export function markdownToTree(md: string, fallbackTitle = '导入的内容', schema?: TypeManifest['nodeSchema']): ArtNode {
  const labelToKey = new Map((schema?.props ?? []).map((p) => [p.label, p.key]));
  const lines = md.replace(/\r/g, '').split('\n');
  const root = n(fallbackTitle);
  root.children = [];
  // 栈：[层级, 节点]；标题层级 h1=0（根）、h2=1…；列表在最近标题之下按缩进加深
  const stack: { lvl: number; node: ArtNode }[] = [{ lvl: 0, node: root }];
  let headLvl = 0;
  let sawH1 = false;
  const push = (lvl: number, node: ArtNode) => {
    while (stack.length > 1 && stack[stack.length - 1].lvl >= lvl) stack.pop();
    const p = stack[stack.length - 1].node;
    (p.children ??= []).push(node);
    stack.push({ lvl, node });
  };
  const addContent = (t: string) => { const cur = stack[stack.length - 1].node; cur.content = cur.content ? `${cur.content}\n${t}` : t; };
  let inCode = false;
  // 表格（Word 表格 / Markdown 表格）：每行一项，列名映射到属性
  let table: string[][] = [];
  let lastWasHead = false;
  const flushTable = () => {
    if (table.length < 2) { table.forEach((r) => addContent(r.filter(Boolean).join(' | '))); table = []; return; }
    const [head, ...rows] = table;
    table = [];
    const items = rows.filter((r) => r.some((c) => c.trim())).map((r) => tableRowToNode(head, r, schema));
    if (!items.length) return;
    if (lastWasHead) { const cur = stack[stack.length - 1].node; (cur.children ??= []).push(...items); return; }
    const part = n(`${head[0] || '表格'}清单`, items);
    push(Math.max(10, headLvl * 10), part);
    stack.pop();
  };
  // 只有一个一级标题时它是总标题；多个一级标题时它们就是各部分（如 Word 导出的“标题 1”）
  const singleH1 = (md.match(/^# /gm) ?? []).length === 1;
  let preamble = true;
  for (const raw of lines) {
    if (!inCode && /^\s*\|.*\|\s*$/.test(raw)) {
      if (/^\s*\|?\s*:?-{2,}/.test(raw.replace(/\|/g, '|'))) continue; // 分隔行
      table.push(raw.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      continue;
    }
    if (table.length) { flushTable(); lastWasHead = false; }
    if (raw.trim()) lastWasHead = /^#{1,6}\s/.test(raw);
    if (/^\s*```/.test(raw)) { inCode = !inCode; continue; }
    if (inCode) { if (raw.trim()) addContent(raw); continue; }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      if (lv === 1 && singleH1 && !sawH1 && !root.children!.length) { root.title = h[2].trim(); sawH1 = true; headLvl = 0; stack.length = 1; preamble = false; continue; }
      if (preamble && !sawH1 && root.content) {
        const [first, ...more] = root.content.split('\n');
        if (first.length <= 40 && !/[：:]/.test(first)) { root.title = first; if (more.length) root.content = more.join('\n'); else delete root.content; }
      }
      preamble = false;
      const lvl = sawH1 ? lv - 1 : lv;
      headLvl = lvl;
      push(lvl * 10, n(h[2]));
      continue;
    }
    const li = raw.match(/^(\s*)(?:[-*+]|\d+[.)、])\s+(.*)$/);
    if (li) {
      const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2);
      let body = li[2].trim();
      let title = body, content: string | undefined;
      const bold = body.match(/^\*\*(.+?)\*\*(?:[：:]\s*(.*))?$/);
      if (bold) { title = bold[1]; content = bold[2]; }
      else { const kv = body.match(/^([^：:]{1,40})[：:]\s*(.+)$/); if (kv && body.length > 50) { title = kv[1]; content = kv[2]; } }
      let props: Record<string, unknown> | undefined;
      const pm = (content ?? title).match(/（([^（）]*：[^（）]*)）$/);
      if (pm && labelToKey.size) {
        const kv = Object.fromEntries(pm[1].split(' · ').map((x) => x.split('：')).filter(([k]) => labelToKey.has(k)).map(([k, v]) => [labelToKey.get(k)!, v]));
        if (Object.keys(kv).length) { props = kv; if (content) content = content.replace(pm[0], ''); else title = title.replace(pm[0], ''); }
      }
      push(headLvl * 10 + 1 + depth, n(title.replace(/\*\*/g, ''), [], content, props));
      continue;
    }
    const q = raw.match(/^>\s*(.*)$/);
    if (q && labelToKey.size) {
      const cur = stack[stack.length - 1].node;
      const kv = q[1].split(' · ').map((x) => x.split('：'));
      if (kv.every(([k]) => labelToKey.has(k))) { cur.props = { ...(cur.props ?? {}), ...Object.fromEntries(kv.map(([k, v]) => [labelToKey.get(k)!, v])) }; continue; }
    }
    if (raw.trim()) addContent(raw.trim());
  }
  if (table.length) flushTable();
  return root;
}

/** 表格的一行 → 一项：第一列为标题；列名与属性名（去掉单位）相同则写入属性，其余列写进说明 */
export function tableRowToNode(head: string[], row: string[], schema?: TypeManifest['nodeSchema']): ArtNode {
  const props: Record<string, unknown> = {};
  const rest: string[] = [];
  const bare = (x: string) => x.replace(/[（(].*?[)）]/g, '').trim();
  const ti = row.findIndex((c) => c.trim());
  for (let j = 0; j < head.length; j++) {
    if (j === ti) continue;
    const label = head[j]?.trim(); const v = (row[j] ?? '').trim();
    if (!label) continue;
    const p = (schema?.props ?? []).find((x) => bare(x.label) === bare(label) || x.key === label);
    if (p && v && !/^[?？]+$/.test(v)) props[p.key] = p.type === 'number' && !Number.isNaN(parseFloat(v.replace(/[,，]/g, ''))) ? parseFloat(v.replace(/[,，]/g, '')) : v;
    else rest.push(`${label}：${v || '（空）'}`);
  }
  return n(row[ti] ?? '', [], rest.join('；'), props);
}

/** Word（mammoth 输出的 HTML）→ Markdown：标题、段落、列表、表格（表格保留为 | 行） */
export function htmlToMarkdown(html: string): string {
  const strip = (x: string) => unesc(x.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  let out = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, body: string) => {
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]).replace(/\|/g, '/')));
    return '\n' + rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n';
  });
  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, l, t) => `\n${'#'.repeat(+l)} ${strip(t)}\n`);
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${strip(t)}\n`);
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, t) => `\n${strip(t)}\n`);
  out = out.replace(/<\/?(ul|ol|div|span|strong|em|b|i|a)[^>]*>/gi, '');
  return out.split('\n').map((l) => l.trimEnd()).filter((l, i, a) => l || (a[i - 1] ?? '') !== '').join('\n').trim();
}

/** 含糊标记（与成熟度规则同源） */
const OPEN_RE = /待定|待确认|待讨论|待补充|不确定|未定|没定|TBD|TODO|FIXME|[?？]/i;
/**
 * 导入理解：把草稿里“还没定”的句子抽出来，作为“待澄清的问题”部分（kind: open-question）。
 * 原句保留在原处（因此原处也会被标为“粗”），问题部分便于逐条回答或交给 AI 细化。
 */
export function extractOpenQuestions(tree: ArtNode, max = 8): { tree: ArtNode; questions: ArtNode[] } {
  const qs: ArtNode[] = [];
  const seen = new Set<string>();
  const add = (title: string, from: string) => {
    const t = title.replace(/^(TODO|TBD|FIXME)\s*[:：]\s*/i, '').replace(/[—–-]{1,2}\s*(待讨论|待定)\s*$/, '（$1）').trim().slice(0, 60);
    const k = t.replace(/\s+/g, '');
    if (!t || seen.has(k) || qs.length >= max) return;
    seen.add(k);
    qs.push({ ...n(t, [], `来自「${from}」`), kind: 'open-question' });
  };
  walk(tree, (x, _p, d) => {
    if (x.kind === 'open-question') return;
    if (d > 0 && OPEN_RE.test(x.title) && !x.content) add(x.title, x.title);
    for (const sent of (x.content ?? '').split(/[。；;\n]/)) {
      const t = sent.trim();
      if (!t || !OPEN_RE.test(t)) continue;
      // 表格单元格：“负责人：?” → “「模板市场」的负责人还没定”
      const cell = /^([^：:]{1,12})[：:]\s*[?？（空）]*$/.exec(t);
      if (cell) { add(`「${x.title}」的${cell[1]}还没定`, x.title); continue; }
      add(t, d === 0 ? '开头' : x.title);
    }
  });
  if (!qs.length) return { tree, questions: [] };
  return { tree: { ...tree, children: [...(tree.children ?? []), n('待澄清的问题', qs, `导入时发现 ${qs.length} 处还没定的地方`)] }, questions: qs };
}

/** 没有任何结构的长文：按空行分段，每段一个节点（标题取首句） */
export function paragraphsToTree(text: string, title: string): ArtNode {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return n(title, paras.slice(0, 200).map((p) => {
    const first = p.split(/(?<=[。！？.!?])\s*|\n/)[0].slice(0, 40);
    return n(first, [], p.length > first.length ? p : undefined);
  }));
}

/** 文档文本 → 树：有 Markdown 结构就用结构，否则按段落 */
export function textToTree(text: string, title: string, schema?: TypeManifest['nodeSchema']): ArtNode {
  const structured = /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)、]\s)/m.test(text);
  return structured ? markdownToTree(text, title, schema) : paragraphsToTree(text, title);
}

/** OPML（含本应用导出）：<outline text= _note=> 嵌套 */
export function opmlToTree(xml: string, fallbackTitle = '导入的大纲'): ArtNode {
  const body = xml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? xml;
  const attr = (tag: string, k: string) => { const m = tag.match(new RegExp(`\\s${k}\\s*=\\s*"([^"]*)"`, 'i')) ?? tag.match(new RegExp(`\\s${k}\\s*=\\s*'([^']*)'`, 'i')); return m ? unesc(m[1]) : undefined; };
  const top: ArtNode[] = [];
  const stack: ArtNode[] = [];
  const re = /<outline\b([^>]*?)(\/?)>|<\/outline\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[0].startsWith('</')) { stack.pop(); continue; }
    const tag = ' ' + m[1];
    const node = n(attr(tag, 'text') ?? attr(tag, 'title') ?? '', [], attr(tag, '_note'));
    const p = stack[stack.length - 1];
    if (p) (p.children ??= []).push(node); else top.push(node);
    if (!m[2]) stack.push(node);
  }
  const title = xml.match(/<title>([^<]*)<\/title>/i)?.[1];
  if (top.length === 1) return top[0];
  return n(title ? unesc(title) : fallbackTitle, top);
}

/** XMind（Zen/2020+）content.json：[{ rootTopic: { title, notes, children: { attached: [...] } } }] */
export function xmindJsonToTree(json: string | unknown): ArtNode {
  const data: any = typeof json === 'string' ? JSON.parse(json) : json;
  const sheet = Array.isArray(data) ? data[0] : data;
  const rec = (t: any): ArtNode => n(String(t?.title ?? ''), (t?.children?.attached ?? []).map(rec), t?.notes?.plain?.content ?? t?.notes?.realHTML?.content?.replace(/<[^>]+>/g, ''));
  return rec(sheet?.rootTopic ?? sheet);
}

/** 旧版 XMind 8 content.xml：<topic><title/><children><topics><topic>… */
export function xmindXmlToTree(xml: string): ArtNode {
  const tokens = xml.match(/<topic\b[^>]*>|<\/topic>|<title[^>]*>[^<]*<\/title>|<plain>[^<]*<\/plain>/g) ?? [];
  const stack: ArtNode[] = [];
  let root: ArtNode | null = null;
  for (const t of tokens) {
    if (t.startsWith('<topic')) { const node = n(''); const p = stack[stack.length - 1]; if (p) (p.children ??= []).push(node); else if (!root) root = node; stack.push(node); }
    else if (t === '</topic>') stack.pop();
    else if (t.startsWith('<title')) { const cur = stack[stack.length - 1]; if (cur && !cur.title) cur.title = unesc(t.replace(/<[^>]+>/g, '')).trim(); }
    else { const cur = stack[stack.length - 1]; if (cur) cur.content = unesc(t.replace(/<[^>]+>/g, '')).trim(); }
  }
  return root ?? n('导入的脑图');
}

/** JSON/YAML：兼容本应用导出（{type, seed, root} 或直接节点）以及任意 {title|name, children|items} 结构 */
export function dataToTree(text: string, fallbackTitle = '导入的数据'): ArtNode {
  let data: any;
  try { data = JSON.parse(text); } catch { data = yamlLoad(text); }
  if (data && typeof data === 'object' && data.root && typeof data.root === 'object') data = data.root;
  const looksNode = (o: any) => o && typeof o === 'object' && !Array.isArray(o) && ('title' in o || 'name' in o) && (!('children' in o) || Array.isArray(o.children) || Array.isArray(o.items));
  const conv = (o: any, key?: string): ArtNode => {
    if (looksNode(o)) {
      const kids = o.children ?? o.items ?? [];
      return { ...normalizeNode({ ...o, title: o.title ?? o.name, children: [] }), children: kids.map((c: any) => conv(c)) } as ArtNode;
    }
    if (Array.isArray(o)) return n(key ?? fallbackTitle, o.map((x, i) => conv(x, `${key ?? '项'} ${i + 1}`)));
    if (o && typeof o === 'object') return n(key ?? fallbackTitle, Object.entries(o).map(([k, v]) => conv(v, k)));
    return n(key ?? String(o), [], key != null ? String(o) : undefined);
  };
  const t = conv(data);
  if (!t.children?.length && t.children) delete t.children;
  return t;
}

/** 表格行（xlsx/csv）→ 树：兼容本应用 CSV 导出（层级/标题/说明）；否则首列有重复值时按首列分组 */
export function rowsToTree(rows: unknown[][], title: string, schema?: TypeManifest['nodeSchema']): ArtNode {
  const clean = rows.map((r) => r.map((c) => (c == null ? '' : String(c).trim()))).filter((r) => r.some(Boolean));
  if (!clean.length) return n(title);
  const head = clean[0];
  const body = clean.slice(1);
  const idx = (k: string) => head.indexOf(k);
  const labelToKey = new Map((schema?.props ?? []).map((p) => [p.label, p.key]));
  if (idx('层级') >= 0 && idx('标题') >= 0) {
    const root = n(title, []);
    const stack: ArtNode[] = [root];
    for (const r of body) {
      const d = Math.max(1, Number(r[idx('层级')]) || 1);
      const props = Object.fromEntries(head.map((h, i) => [labelToKey.get(h), r[i]]).filter(([k, v]) => k && v));
      const node = n(r[idx('标题')], [], idx('说明') >= 0 ? r[idx('说明')] : undefined, props);
      stack.length = Math.min(stack.length, d);
      const p = stack[stack.length - 1];
      (p.children ??= []).push(node);
      stack.push(node);
    }
    return root;
  }
  const rowNode = (r: string[], skip: number) => {
    const t = r.find((c, i) => i >= skip && c) ?? '';
    const rest = head.map((h, i) => (i >= skip && r[i] && r[i] !== t ? `${h || `列${i + 1}`}：${r[i]}` : '')).filter(Boolean).join('；');
    return n(t, [], rest);
  };
  const firstVals = body.map((r) => r[0]).filter(Boolean);
  const uniq = new Set(firstVals);
  if (head.length > 2 && uniq.size > 0 && uniq.size <= body.length / 2) {
    const groups = new Map<string, ArtNode>();
    let last = '';
    for (const r of body) {
      const g = r[0] || last; last = g;
      if (!groups.has(g)) groups.set(g, { ...n(g), children: [] });
      groups.get(g)!.children!.push(rowNode(r, 1));
    }
    return n(title, [...groups.values()]);
  }
  return n(title, body.map((r) => rowNode(r, 0)));
}

export function treeDepth(root: ArtNode): number {
  let d = 0;
  walk(root, (_x, _p, depth) => { if (depth > d) d = depth; });
  return d;
}

/**
 * “规划师”为导入的初稿挑选从第几步开始：按结构的细化程度（深度、节点数、有说明/属性的比例）
 * 对应到流程中自由度相当的步骤。总是至少留一步可做（不会直接跳到完成）。
 */
export function pickStartStage(root: ArtNode, m: TypeManifest): { index: number; reason: string } {
  const total = m.stages.length;
  if (total <= 1) return { index: 0, reason: '只有一步' };
  let nodes = 0;
  walk(root, (_x, _p, d) => { if (d > 0) nodes++; });
  const depth = treeDepth(root);
  if (!nodes) return { index: 0, reason: '内容里没有可识别的结构，从第一步开始' };
  // 细化程度用成熟度规则（与界面上的“粗 / 中 / 细”同一套），不再把“有说明”当成“具体”
  const r = readiness(root, m);
  const ready = r.percent / 100;
  const level = Math.min(1, 0.35 * Math.min(1, (depth - 1) / 2) + 0.25 * Math.min(1, nodes / 30) + 0.4 * ready);
  const index = Math.min(total - 1, Math.max(1, Math.round(level * (total - 1))));
  const why = `${depth} 层、${nodes} 项，就绪 ${r.percent}%${r.rough ? `（${r.rough} 项还比较粗）` : ''}`;
  return { index, reason: `已有 ${why}，从「${m.stages[index].name}」接着做` };
}

/** 参考资料：按预算拼进提示词，超出部分截断并说明 */
export interface RefItem { id: string; name: string; kind: 'file' | 'text' | 'url'; text: string; addedAt: number; off?: boolean }
export const REF_BUDGET = 12000;
export function refContext(refs: RefItem[] | undefined, budget = REF_BUDGET): { text: string; used: number; total: number; truncated: { id: string; kept: number; total: number }[] } {
  const on = (refs ?? []).filter((r) => !r.off && r.text.trim());
  const total = on.reduce((s, r) => s + r.text.length, 0);
  let left = budget;
  const parts: string[] = [];
  const truncated: { id: string; kept: number; total: number }[] = [];
  for (const r of on) {
    const kept = Math.max(0, Math.min(r.text.length, left));
    if (kept < r.text.length) truncated.push({ id: r.id, kept, total: r.text.length });
    if (kept > 0) parts.push(`### ${r.name}${r.kind === 'url' ? '（网页）' : ''}\n${r.text.slice(0, kept)}${kept < r.text.length ? '\n…（已截断）' : ''}`);
    left -= kept;
  }
  return { text: parts.join('\n\n'), used: budget - left, total, truncated };
}
