import type { Store } from './store';
import { DEFAULT_SETTINGS } from './settings';
import { stepInfo } from './flow';
import { runExport } from './exporters';
import { pendingReview, toJSONCanvas, toMermaid } from '../core';
import { findNode, walk, readiness } from '../core';
import type { ArtNode } from '../core';

export const R18: Record<string, any> = { errors: [] };
/**
 * v1.8 验收（自进化第 1 轮）：首次引导、Ctrl+单击多选、逐条改动理由。
 * 以下沿用 v1.7 验收：评审者的模拟模型服务（fake.py）+ 乱 Word 草稿，在构建好的应用里用真实鼠标 / 键盘跑三条旅程：
 * (a) 导入乱 Word → 可执行计划；(b) 模糊想法 → 概念 → 功能清单 → 任务（跨作品链）；(c) 陌生领域：家庭装修预算。
 */
export async function v18Tour(h: { S: () => Store; wait: (ms: number) => Promise<unknown>; shot: (name: string, keep?: boolean) => Promise<void>; until: (fn: () => boolean, ms?: number) => Promise<void>; P: string }) {
  const { S, wait, shot, until, P } = h;
  const R = R18;
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const qa = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)].filter(vis);
  const click = async (el: Element | null | undefined, label: string) => {
    if (!el) throw new Error('找不到：' + label);
    el.scrollIntoView({ block: 'nearest' }); await wait(80);
    const r = el.getBoundingClientRect();
    await window.api.click(r.left + r.width / 2, r.top + r.height / 2); await wait(300);
  };
  const ctrlClick = async (el: Element | null | undefined, label: string) => { if (!el) throw new Error('找不到：' + label); el.scrollIntoView({ block: 'nearest' }); await wait(80); const r = el.getBoundingClientRect(); await window.api.click(r.left + r.width / 2, r.top + r.height / 2, ['control']); await wait(300); };
  const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].filter(vis).find((b) => b.textContent?.includes(text));
  const item = (text: string) => [...document.querySelectorAll<HTMLElement>('.menu-item')].filter(vis).find((b) => b.textContent?.includes(text));
  const primary = () => qa<HTMLButtonElement>('.actionbar:not(.bp-bar) .ab-primary')[0];
  const notRunning = () => !S().run.running;
  const keys = (k: { text?: string; key?: string; shift?: boolean; ctrl?: boolean }[]) => window.api.keys(k);
  const art = () => S().currentArtifact!;
  const man = () => S().currentManifest!;
  const titles = (n: ArtNode) => { const t: string[] = []; walk(n, (x) => t.push(x.title)); return t; };
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { R.errors.push(`${name}: ${String(e?.message ?? e)}`); } };
  const runPrimary = async (label: string) => { await click(primary(), label); await wait(300); await until(notRunning, 180000); await wait(500); };
  const fx = S().info?.fixtures ?? '';
  const finishNow = async () => { const n = man().stages.length; if (art().stageIndex < n - 1) { S().setStage(n - 1); await wait(300); } S().finishWork(true); await wait(500); };
  const real = S().info?.real;
  const LONG = 'fake-pro-2026-10-preview-long-model-name';

  await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: false, theme: 'dark', expert: false, demoNoticeSeen: true, text: { baseUrl: real?.baseUrl ?? 'http://127.0.0.1:18766/v1', apiKey: 'sk-fake', model: LONG, stream: false, maxTokens: 2000 } });
  await wait(300);


  const pendingOK = () => !!pendingReview(art());
  void [readiness, item, keys, titles, fx, finishNow];
  await step('r1-引导与多选', async () => {
    try { localStorage.removeItem('refiner.coach.v18'); } catch { /* */ }
    await S().planIntent('产品发布执行计划');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await click(q('.bp-bar .ab-primary'), '开始第 1 步');
    await wait(500); await until(notRunning, 120000); await wait(600);
    R.coach = { shown: !!q('.coach'), tip1: q('.coach')?.innerText };
    await shot(`${P}70-首次引导-先粗后细.png`);
    await click(btn('下一条', q('.coach')!), '下一条'); R.coach.tip2 = q('.coach .coach-h b')?.textContent;
    await shot(`${P}71-首次引导-点哪改哪-Ctrl多选.png`);
    await click(btn('下一条', q('.coach')!), '下一条'); R.coach.tip3 = q('.coach .coach-h b')?.textContent;
    await click(btn('知道了', q('.coach')!), '知道了'); R.coach.closed = !q('.coach'); R.coach.persisted = localStorage.getItem('refiner.coach.v18');
    await click(primary(), '全部保留，进入下一步'); await wait(600);
    const parts = qa('.onode.d1');
    const pick = [parts[2], parts[3]].filter(Boolean);
    await click(pick[0].querySelector('.ttl-t'), '单击第 3 部分');
    await ctrlClick(pick[1].querySelector('.ttl-t'), 'Ctrl+单击第 4 部分');
    const ids = [...S().multiSel];
    R.multi = { ids: ids.map((id) => findNode(art().root, id)?.title), mselRows: qa('.onode.msel').length, primary: primary()?.textContent, target: q('.actionbar .ab-t')?.textContent, hint: q('.ab-hint')?.textContent ?? null };
    await shot(`${P}72-Ctrl多选两处-主按钮处理所选2处.png`);
    const before = JSON.stringify(art().root.children!.filter((c) => !ids.includes(c.id)));
    await runPrimary('处理所选 2 处');
    const whys = qa('.chg-why').map((e) => e.textContent ?? '');
    R.multi.after = { label: art().versions.find((v) => v.id === art().head)?.label, othersUnchanged: JSON.stringify(art().root.children!.filter((c) => !ids.includes(c.id))) === before, multiCleared: S().multiSel.length === 0, bar: q('.actionbar .ab-t')?.textContent };
    R.reasons = { n: whys.length, distinct: new Set(whys).size, sample: whys.slice(0, 6), tags: qa('.chg-tag').length };
    await shot(`${P}73-逐条改动理由-每处一句为什么.png`);
    const firstWhy = qa('.chg-why')[0];
    if (firstWhy) { firstWhy.scrollIntoView({ block: 'center' }); await wait(200); await shot(`${P}74-逐条理由-特写.png`); }
    const rv = qa<HTMLButtonElement>('.chg-tag .chg-btn').find((b) => b.title.startsWith('撤回'));
    if (rv) { const n0 = qa('.chg-tag').length; await click(rv, '撤回一处'); await wait(400); R.reasons.revertOne = { before: n0, after: qa('.chg-tag').length, primary: primary()?.textContent }; }
  });
  await step('r2-并行与粒度', async () => {
    // 先保留上一轮改动，回到“就绪”态
    if (btn('全部保留') || btn('保留其余')) { S().keepAll(); await wait(400); }
    R.ask = { mini: !!q('.ask-card.ask-mini'), h: window.innerHeight, text: q('.ask-card')?.innerText ?? null };
    if (q('.ask-card')) await shot(`${P}75-追问卡-窗口矮时收成一行.png`);
    if (q('.ask-card')) { await click(btn('先不管', q('.ask-card')!), '先不管'); await wait(300); }
    const rb = btn('接着细化最粗的 3 处');
    R.par = { strip: !!rb };
    if (rb) {
      await click(rb, '接着细化最粗的 3 处');
      const chips: string[] = [];
      const t0 = Date.now();
      while (S().run.running && Date.now() - t0 < 120000) { const c = q('.multi-chip')?.textContent; if (c && !chips.includes(c)) chips.push(c); if (chips.length === 1) await shot(`${P}76-并行3路-同时细化最粗的3处.png`); await wait(150); }
      await wait(500);
      R.par.chips = chips; R.par.ms = Date.now() - t0; R.par.label = art().versions.find((v) => v.id === art().head)?.label; R.par.bar = q('.actionbar .ab-t')?.textContent;
      S().keepAll(); await wait(300);
    }
    // 粒度：选一项有 ≥2 个子项的部分
    const part = qa('.onode.d1').find((x) => { const id = x.getAttribute('data-node-id')!; return (findNode(art().root, id)?.children?.length ?? 0) >= 2; });
    await click(part?.querySelector('.ttl-t'), '单击一个有子项的部分');
    const pid = S().selectedId!;
    const k0 = findNode(art().root, pid)?.children?.length;
    R.grain = { title: findNode(art().root, pid)?.title, before: k0, row: q('.grain-row')?.innerText };
    await shot(`${P}77-检查器-粒度-更粗更细.png`);
    await click(btn('更细', q('.grain-row')!), '更细'); await wait(300); await until(notRunning, 120000); await wait(500);
    R.grain.afterFiner = findNode(art().root, pid)?.children?.length; R.grain.finerLabel = art().versions.find((v) => v.id === art().head)?.label; R.grain.instr = art().versions.find((v) => v.id === art().head)?.instruction;
    await shot(`${P}78-粒度-更细之后.png`);
    S().keepAll(); await wait(300);
    if (S().selectedId !== pid) { S().setSelectedId(pid); await wait(300); }
    R.grain.coarserDisabled = btn('更粗', q('.grain-row')!)?.disabled; R.grain.coarserTip = btn('更粗', q('.grain-row')!)?.title; R.grain.ops = stepInfo(art(), man()).ops;
    await click(btn('更粗', q('.grain-row')!), '更粗'); await wait(300); await until(notRunning, 120000); await wait(500);
    R.grain.afterCoarser = findNode(art().root, pid)?.children?.length; R.grain.coarserLabel = art().versions.find((v) => v.id === art().head)?.label;
  });
  await step('r3-偏好与导出', async () => {
    // 优先用当前未审阅的改动（粒度“更粗”之后通常还挂着）；没有则对一个叶子“更细”制造改动
    let tags = qa('.chg-tag').length;
    R.r3dbg = { tags0: tags, pending: pendingOK(), prefs0: art().prefs?.length ?? 0 };
    if (!tags) {
      if (pendingOK()) { S().keepAll(); await wait(300); }
      const leaf = qa('.onode').filter((x) => { const d = +(x.className.match(/\bd(\d+)/)?.[1] ?? 0); const id = x.getAttribute('data-node-id')!; const n = findNode(art().root, id); return d >= 2 && n && !(n.children?.length); })[0]
        ?? qa('.onode.d1')[0];
      await click(leaf?.querySelector('.ttl-t'), '单击一个叶子');
      if (!q('.grain-row')) throw new Error('检查器没有粒度行');
      await click(btn('更细', q('.grain-row')!), '更细以制造改动'); await wait(300); await until(notRunning, 120000); await wait(500);
      tags = qa('.chg-tag').length;
      R.r3dbg.afterMake = { label: art().versions.find((v) => v.id === art().head)?.label, tags, bar: q('.actionbar .ab-t')?.textContent };
    }
    if (!tags) throw new Error('找不到可撤回的改动（tags=0）');
    const rv = qa<HTMLButtonElement>('.chg-tag .chg-btn').find((b) => (b.title ?? '').startsWith('撤回'));
    if (!rv) throw new Error('找不到撤回按钮');
    const why = qa('.chg-why')[0]?.textContent;
    const n0 = art().prefs?.length ?? 0;
    await click(rv, '撤回一处'); await wait(500);
    R.prefs = { why, toast: q('.toast')?.textContent ?? null, grew: (art().prefs?.length ?? 0) > n0, saved: art().prefs?.map((p) => ({ text: p.text, on: p.on, from: p.from })) };
    await shot(`${P}79-撤回一处-记下偏好.png`);
    await click(btn('资料'), '资料'); await wait(400);
    q('.prefs')?.scrollIntoView({ block: 'center' }); await wait(200);
    R.prefs.panel = q('.prefs')?.innerText;
    await shot(`${P}80-资料-你的偏好-可停用.png`);
    if (btn('停用', q('.prefs')!)) { await click(btn('停用', q('.prefs')!), '停用'); await wait(200); R.prefs.offAfterToggle = art().prefs?.find((p) => !p.on) != null; if (btn('启用', q('.prefs')!)) { await click(btn('启用', q('.prefs')!), '启用'); await wait(200); } }
    await keys([{ key: 'Escape' }]); await wait(200);
    if (pendingOK()) { S().keepAll(); await wait(200); }
    const canvas = toJSONCanvas(art().root, man());
    const mm = toMermaid(art().root, man());
    const saved = await runExport('canvas', art(), man(), true);
    R.exports = { nodes: canvas.nodes.length, edges: canvas.edges.length, mermaidKind: mm.kind, mermaidHead: mm.text.split('\n').slice(0, 4), saved, menu: [] as string[] };
    await click(btn('导出'), '导出菜单'); await wait(300);
    R.exports.menu = qa('.menu-item').map((x) => x.textContent ?? '');
    await shot(`${P}81-导出-JSON-Canvas-Mermaid.png`);
    await keys([{ key: 'Escape' }]);
  });
  await window.api.write(`${P}v18.json`, JSON.stringify(R, null, 2));
}
