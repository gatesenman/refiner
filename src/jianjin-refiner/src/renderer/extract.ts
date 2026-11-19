import { dataToTree, htmlToMarkdown, markdownToTree, opmlToTree, rowsToTree, textToTree, xmindJsonToTree, xmindXmlToTree, type ImportResult, type TypeManifest } from '../core';

/** 二进制解析库：渲染进程传浏览器版本，单元测试传 Node 版本（全部纯 JS，离线可用） */
export interface ExtractLibs {
  mammoth: { convertToHtml?: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>; convertToMarkdown?: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>; extractRawText: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
  pdf: { getDocument: (src: any) => { promise: Promise<any> } };
  XLSX: { read: (d: any, o: any) => any; utils: { sheet_to_json: (s: any, o: any) => any[][] } };
  JSZip: { loadAsync: (d: any) => Promise<any> };
}

export const IMPORT_EXT = ['docx', 'pdf', 'md', 'markdown', 'txt', 'xlsx', 'xls', 'csv', 'opml', 'xmind', 'yaml', 'yml', 'json'];
const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';
const base = (name: string) => name.replace(/\.[^.]+$/, '');
const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b).replace(/^\ufeff/, '');

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rowsText = (rows: string[][]) => rows.map((r) => r.join(' | ')).join('\n');

export async function extractFile(name: string, bytes: Uint8Array, libs: ExtractLibs, schema?: TypeManifest['nodeSchema']): Promise<ImportResult> {
  const e = ext(name), title = base(name);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  switch (e) {
    case 'md': case 'markdown': case 'txt': {
      const text = decode(bytes);
      return { kind: 'content', text, tree: textToTree(text, title, schema), title };
    }
    case 'docx': {
      // 浏览器版 mammoth 读 arrayBuffer，Node 版读 buffer
      const input: any = { arrayBuffer: ab };
      if (typeof (globalThis as any).Buffer !== 'undefined') input.buffer = (globalThis as any).Buffer.from(ab);
      // 优先 HTML（保留表格），没有 convertToHtml 时退回 Markdown
      const md = libs.mammoth.convertToHtml ? htmlToMarkdown((await libs.mammoth.convertToHtml(input)).value) : libs.mammoth.convertToMarkdown ? (await libs.mammoth.convertToMarkdown(input)).value : '';
      const raw = (await libs.mammoth.extractRawText(input)).value;
      // mammoth 的 Markdown 会转义标点（\. \-），还原后再解析结构
      const clean = md.replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1').replace(/__(.+?)__/g, '**$1**').replace(/<a id="[^"]*"><\/a>/g, '');
      const hasHeads = /^#{1,6}\s/m.test(clean) || /^\|.*\|$/m.test(clean);
      return { kind: 'content', text: raw.trim(), tree: hasHeads ? markdownToTree(clean, title, schema) : textToTree(raw, title, schema), title };
    }
    case 'pdf': {
      const doc = await libs.pdf.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        let line = '', out = '', lastY: number | null = null;
        for (const it of tc.items as any[]) {
          const y = it.transform?.[5];
          if (lastY != null && y != null && Math.abs(y - lastY) > 2) { out += line.trimEnd() + '\n'; line = ''; }
          line += it.str; if (it.hasEOL) { out += line.trimEnd() + '\n'; line = ''; }
          lastY = y ?? lastY;
        }
        pages.push((out + line).trim());
      }
      const text = pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
      return { kind: 'content', text, tree: text ? textToTree(text, title, schema) : undefined, title, notes: text ? [] : ['这个 PDF 没有可提取的文字（可能是扫描件），只能作为空白参考'] };
    }
    case 'xlsx': case 'xls': {
      const wb = libs.XLSX.read(bytes, { type: 'array' });
      const sheets = (wb.SheetNames as string[]).map((sn) => ({ sn, rows: libs.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false }) as string[][] })).filter((s) => s.rows.length);
      const text = sheets.map((s) => `【${s.sn}】\n${rowsText(s.rows)}`).join('\n\n');
      const tree = sheets.length === 1 ? rowsToTree(sheets[0].rows, title, schema) : { ...rowsToTree([], title), children: sheets.map((s) => rowsToTree(s.rows, s.sn, schema)) };
      return { kind: 'content', text, tree, title };
    }
    case 'csv': {
      const rows = parseCsv(decode(bytes));
      return { kind: 'content', text: rowsText(rows), tree: rowsToTree(rows, title, schema), title };
    }
    case 'opml': { const tree = opmlToTree(decode(bytes), title); return { kind: 'structure', text: '', tree, title: tree.title || title }; }
    case 'xmind': {
      const zip = await libs.JSZip.loadAsync(bytes);
      const cj = zip.file('content.json');
      const tree = cj ? xmindJsonToTree(await cj.async('string')) : zip.file('content.xml') ? xmindXmlToTree(await zip.file('content.xml').async('string')) : null;
      if (!tree) throw new Error('不是有效的 XMind 文件（缺少 content.json / content.xml）');
      return { kind: 'structure', text: '', tree, title: tree.title || title };
    }
    case 'yaml': case 'yml': case 'json': { const tree = dataToTree(decode(bytes), title); return { kind: 'structure', text: '', tree, title: tree.title || title }; }
  }
  throw new Error(`暂不支持 .${e} 文件。支持：${IMPORT_EXT.map((x) => '.' + x).join(' ')}`);
}

/** 把结构树写成参考资料用的大纲文字 */
export function treeAsText(tree: { title: string; content?: string; children?: any[] }, d = 0): string {
  const line = `${'  '.repeat(d)}- ${tree.title}${tree.content ? '：' + tree.content.replace(/\n/g, ' ') : ''}`;
  return [line, ...(tree.children ?? []).map((c) => treeAsText(c, d + 1))].join('\n');
}

let libsP: Promise<ExtractLibs> | null = null;
/** 渲染进程：按需加载（首次导入时才加载 pdf.js 等，不拖慢启动） */
export function browserLibs(): Promise<ExtractLibs> {
  return (libsP ??= (async () => {
    const [mammoth, pdf, XLSX, JSZip, worker] = await Promise.all([
      import('mammoth/mammoth.browser.js' as any), import('pdfjs-dist'), import('xlsx'), import('jszip'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url' as any),
    ]);
    (pdf as any).GlobalWorkerOptions.workerSrc = (worker as any).default;
    return { mammoth: (mammoth as any).default ?? mammoth, pdf: pdf as any, XLSX: ((XLSX as any).default?.read ? (XLSX as any).default : XLSX) as any, JSZip: ((JSZip as any).default ?? JSZip) as any };
  })());
}
