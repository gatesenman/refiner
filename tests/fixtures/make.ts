/** 测试 / 验收用的真实样本文件：docx（本应用导出器）、pdf（手写最小 PDF）、xlsx（SheetJS）、xmind（JSZip） */
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { toDocx } from '../../src/renderer/docx';
import type { ArtNode, TypeManifest } from '../../src/core';

export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const content = `BT /F1 14 Tf 72 740 Td 18 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export function makeXlsx(rows: unknown[][], sheet = 'Sheet1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

export async function makeXmind(root: { title: string; children?: any[] }): Promise<Uint8Array> {
  const conv = (n: any): any => ({ id: Math.random().toString(36).slice(2), title: n.title, ...(n.note ? { notes: { plain: { content: n.note } } } : {}), ...(n.children?.length ? { children: { attached: n.children.map(conv) } } : {}) });
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([{ id: 's1', class: 'sheet', title: 'Sheet 1', rootTopic: conv(root) }]));
  zip.file('metadata.json', '{}');
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
  return zip.generateAsync({ type: 'uint8array' });
}

export function makeDocx(root: ArtNode, m: TypeManifest): Uint8Array { return toDocx(root, m); }
