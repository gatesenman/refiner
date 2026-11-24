import type { Store } from './store';
import { DEFAULT_SETTINGS } from './settings';
import { draftItems, pendingReview } from '../core';

export const R21: Record<string, any> = { errors: [] };

/** v2.1 验收：草稿层侧栏 + 多处逐处确认 */
export async function v21Tour(h: { S: () => Store; wait: (ms: number) => Promise<unknown>; shot: (name: string, keep?: boolean) => Promise<void>; until: (fn: () => boolean, ms?: number) => Promise<void>; P: string }) {
  const { S, wait, shot, until, P } = h;
  const R = R21;
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const qa = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)].filter(vis);
  const click = async (el: Element | null | undefined, label: string) => {
    if (!el) throw new Error('找不到：' + label);
    el.scrollIntoView({ block: 'nearest' }); await wait(80);
    const r = el.getBoundingClientRect();
    await window.api.click(r.left + r.width / 2, r.top + r.height / 2); await wait(300);
  };
  const ctrlClick = async (el: Element | null | undefined, label: string) => {
    if (!el) throw new Error('找不到：' + label);
    el.scrollIntoView({ block: 'nearest' }); await wait(80);
    const r = el.getBoundingClientRect();
    await window.api.click(r.left + r.width / 2, r.top + r.height / 2, ['control']); await wait(300);
  };
  const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].filter(vis).find((b) => b.textContent?.includes(text));
  const primary = () => qa<HTMLButtonElement>('.actionbar:not(.bp-bar) .ab-primary')[0];
  const notRunning = () => !S().run.running;
  const art = () => S().currentArtifact!;
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { R.errors.push(`${name}: ${String(e?.message ?? e)}`); } };
  const real = S().info?.real;
  const LONG = 'fake-pro-2026-10-preview-long-model-name';

  await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: false, theme: 'dark', expert: false, demoNoticeSeen: true, confirmEach: false,
    text: { baseUrl: real?.baseUrl ?? 'http://127.0.0.1:18766/v1', apiKey: 'sk-fake', model: LONG, stream: false, maxTokens: 2000 } });
  await wait(300);

  await step('草稿层侧栏', async () => {
    await S().planIntent('产品发布执行计划');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await click(q('.bp-bar .ab-primary'), '开始第 1 步');
    await wait(400); await until(notRunning, 120000); await wait(500);
    if (q('.coach')) { const b = btn('知道了', q('.coach')!) ?? btn('不再提示', q('.coach')!); if (b) await click(b, '关引导'); }
    if (q('.ask-card:not(.confirm-card)')) { const sk = btn('先不管', q('.ask-card')!); if (sk) await click(sk, '先不管'); }
    if (primary() && /保留/.test(primary()!.textContent ?? '')) { await click(primary(), '全部保留进入下一步'); await wait(600); }
    const parts = qa('.onode.d1');
    if (parts.length < 2) throw new Error('部分不足 2');
    await click(parts[0].querySelector('.ttl-t'), '选1');
    await ctrlClick(parts[1].querySelector('.ttl-t'), '选2');
    await click(primary(), '处理所选'); await wait(300); await until(notRunning, 180000); await wait(600);
    const side = q('.draft-side');
    const items = qa('.draft-item');
    R.draft = { open: !!side && side.classList.contains('open'), n: items.length, core: draftItems(art()).length, header: q('.draft-h')?.textContent, first: items[0]?.textContent?.slice(0, 80) };
    if (!side || items.length < 1) throw new Error(`草稿侧栏未出现 side=${!!side} items=${items.length}`);
    await shot(`${P}90-草稿层侧栏-改动清单.png`);
    const first = items[0];
    first.scrollIntoView({ block: 'center' }); await wait(200);
    await click(first, '点清单第一项');
    R.draft.jumped = S().selectedId != null;
    await shot(`${P}91-草稿层-点击跳转.png`);
  });

  await step('逐处确认', async () => {
    if (pendingReview(art())) { S().keepAll(); await wait(300); }
    if (q('.ask-card:not(.confirm-card)')) { const sk = btn('先不管', q('.ask-card')!); if (sk) await click(sk, '先不管'); }
    await S().saveSettings({ ...S().settings, confirmEach: true });
    await wait(200);
    const parts = qa('.onode.d1').slice(0, 2);
    if (parts.length < 2) throw new Error('部分不足 2');
    await click(parts[0].querySelector('.ttl-t'), '选1');
    await ctrlClick(parts[1].querySelector('.ttl-t'), '选2');
    await click(primary(), '开始逐处确认');
    await until(() => !!S().run.confirm || !!q('.confirm-card'), 180000);
    await wait(400);
    R.confirm = { shown: !!q('.confirm-card'), text: q('.confirm-card')?.innerText?.slice(0, 200), i: S().run.confirm?.i, n: S().run.confirm?.n, title: S().run.confirm?.title, draftN: qa('.draft-item').length };
    await shot(`${P}92-逐处确认-第1处.png`);
    const keep = btn('保留并继续', q('.confirm-card')!);
    if (!keep) throw new Error('没有保留并继续');
    await click(keep, '保留并继续');
    await until(() => (S().run.confirm?.i === 1) || (!S().run.running && !S().run.confirm), 180000);
    await wait(400);
    R.confirm.second = { shown: !!q('.confirm-card'), text: q('.confirm-card')?.innerText?.slice(0, 160), i: S().run.confirm?.i, title: S().run.confirm?.title };
    if (q('.confirm-card')) await shot(`${P}93-逐处确认-第2处.png`);
    const keep2 = btn('保留并继续', q('.confirm-card')!);
    if (keep2) { await click(keep2, '保留第2处'); await until(() => !S().run.confirm && notRunning(), 180000); await wait(400); }
    R.confirm.after = { running: S().run.running, confirm: !!S().run.confirm, label: art().versions.find((v) => v.id === art().head)?.label, reviewed: art().versions.find((v) => v.id === art().head)?.reviewed, toast: S().toasts.map((x) => x.text).pop() };
    await shot(`${P}94-逐处确认-全部保留后.png`);
  });

  await window.api.write(`${P}v21.json`, JSON.stringify(R, null, 2));
}
