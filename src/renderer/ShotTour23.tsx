import type { Store } from './store';
import { DEFAULT_SETTINGS } from './settings';
import { runExport } from './exporters';
import { toHtml, toMdTable, packFiles } from '../core';

export const R23: Record<string, any> = { errors: [] };

/** v2.3：HTML / Markdown 表 / 交接包 */
export async function v23Tour(h: { S: () => Store; wait: (ms: number) => Promise<unknown>; shot: (name: string, keep?: boolean) => Promise<void>; until: (fn: () => boolean, ms?: number) => Promise<void>; P: string }) {
  const { S, wait, shot, until, P } = h;
  const R = R23;
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const qa = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)].filter(vis);
  const click = async (el: Element | null | undefined, label: string) => {
    if (!el) throw new Error('找不到：' + label);
    el.scrollIntoView({ block: 'nearest' }); await wait(80);
    const r = el.getBoundingClientRect();
    await window.api.click(r.left + r.width / 2, r.top + r.height / 2); await wait(300);
  };
  const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].filter(vis).find((b) => b.textContent?.includes(text));
  const notRunning = () => !S().run.running;
  const art = () => S().currentArtifact!;
  const man = () => S().currentManifest!;
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { R.errors.push(`${name}: ${String(e?.message ?? e)}`); } };
  const keys = (k: { text?: string; key?: string; shift?: boolean; ctrl?: boolean }[]) => window.api.keys(k);
  const real = S().info?.real;
  const LONG = 'fake-pro-2026-10-preview-long-model-name';

  await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: false, theme: 'dark', expert: false, demoNoticeSeen: true, confirmEach: false, survey: false,
    text: { baseUrl: real?.baseUrl ?? 'http://127.0.0.1:18766/v1', apiKey: 'sk-fake', model: LONG, stream: false, maxTokens: 2000 } });
  await wait(300);
  await step('导出新格式', async () => {
    await S().planIntent('产品发布执行计划');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await click(q('.bp-bar .ab-primary'), '开始');
    await wait(400); await until(notRunning, 180000); await wait(500);
    if (q('.coach')) { const b = btn('知道了', q('.coach')!) ?? btn('不再提示', q('.coach')!); if (b) await click(b, '关'); }
    const html = toHtml(art().root, man(), art());
    const table = toMdTable(art().root, man());
    const pack = packFiles(art(), man(), 'md', 'csv');
    const savedH = await runExport('html', art(), man(), true);
    const savedT = await runExport('mdtable', art(), man(), true);
    const savedP = await runExport('pack', art(), man(), true);
    R.exports = { htmlHas: /<!DOCTYPE html>/.test(html) && html.includes(art().root.title.slice(0, 4)), tableHas: table.includes('|'), pack: pack.map((f) => f.name), savedH, savedT, savedP };
    if (!savedH || !savedT || !savedP) throw new Error(`保存失败 h=${savedH} t=${savedT} p=${savedP}`);
    await click(btn('导出')!, '导出菜单'); await wait(300);
    R.exports.menu = qa('.menu-item').map((x) => x.textContent ?? '');
    if (!R.exports.menu.some((t: string) => /HTML/.test(t)) || !R.exports.menu.some((t: string) => /交接包/.test(t)) || !R.exports.menu.some((t: string) => /表格/.test(t))) {
      throw new Error('导出菜单缺新格式：' + R.exports.menu.join('|'));
    }
    await shot(`${P}98-导出菜单-HTML-表格-交接包.png`);
    await keys([{ key: 'Escape' }]);
  });
  await window.api.write(`${P}v23.json`, JSON.stringify(R, null, 2));
}
