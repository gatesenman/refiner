import type { Store } from './store';
import { DEFAULT_SETTINGS } from './settings';
import { findNode, walk, readiness } from '../core';
import type { ArtNode } from '../core';

export const R17: Record<string, any> = { errors: [] };
/**
 * v1.7 验收：评审者的模拟模型服务（fake.py）+ 乱 Word 草稿，在构建好的应用里用真实鼠标 / 键盘跑三条旅程：
 * (a) 导入乱 Word → 可执行计划；(b) 模糊想法 → 概念 → 功能清单 → 任务（跨作品链）；(c) 陌生领域：家庭装修预算。
 */
export async function v17Tour(h: { S: () => Store; wait: (ms: number) => Promise<unknown>; shot: (name: string, keep?: boolean) => Promise<void>; until: (fn: () => boolean, ms?: number) => Promise<void>; P: string }) {
  const { S, wait, shot, until, P } = h;
  const R = R17;
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

  // ───── 设置：模型下拉 + 标题栏徽标不溢出 ─────
  await step('设置', async () => {
    S().setView('settings'); await wait(400);
    await click(btn('获取模型列表'), '获取模型列表');
    await until(() => !!q('.form-card select.mono'), 8000);
    R.modelList = [...(q<HTMLSelectElement>('.form-card select.mono')?.options ?? [])].map((o) => o.value);
    await shot(`${P}50-设置-模型列表下拉.png`);
    const tb = q('.titlebar')!.getBoundingClientRect(); const badge = q('.tb-model')!.getBoundingClientRect(); const saved = q('.titlebar .saved')?.getBoundingClientRect();
    R.titlebar = { badgeRight: Math.round(badge.right), titlebarRight: Math.round(tb.right), badgeW: Math.round(badge.width), inside: badge.bottom <= tb.bottom + 1 && badge.top >= tb.top - 1, overlapSaved: saved ? !(saved.right <= badge.left || badge.right <= saved.left) : false, overflowPx: q('.titlebar')!.scrollWidth - q('.titlebar')!.clientWidth };
  });

  // ═════ (a) 导入乱 Word → 可执行计划 ═════
  await step('a-导入', async () => {
    S().setView('home'); await wait(200);
    const f = await window.api.importRead(`${fx}/产品计划-草稿.docx`);
    await S().importStart([f]);
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await wait(400);
    R.a = { seedCard: q('.seed-card')?.innerText, button1: q('.bp-bar .ab-primary')?.textContent, questions: S().plan?.seed?.questions };
    await shot(`${P}51-导入乱草稿-如实统计-待澄清.png`);
    // 重新规划：导入的初稿必须保留
    const re = btn('重新规划');
    if (re) { await click(re, '重新规划'); await until(() => !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000); await wait(300); }
    R.a.replan = { clicked: !!re, seedKept: !!S().plan?.seed?.tree, seedCard: !!q('.seed-card'), button: q('.bp-bar .ab-primary')?.textContent };
    await shot(`${P}52-重新规划后仍保留导入初稿.png`);
    await click(q('.bp-bar .ab-primary'), '打开初稿');
    await wait(600);
    const a = art();
    R.a.opened = { stage: a.stageIndex, stageName: man().stages[a.stageIndex]?.name, parts: a.root.children?.map((c) => c.title), ready: readiness(a.root, man()).percent, matDots: qa('.onode .mat').length, oqTags: qa('.oq-tag').length, readyChip: q('.ready-chip')?.textContent, strip: q('.rough-strip')?.innerText };
    await shot(`${P}53-成熟度色点-就绪度-最粗的3处.png`);
    // 悬停色点：显示原因
    R.a.dotTip = q('.onode.d1 .mat')?.getAttribute('title');
    // 一键：接着细化最粗的 3 处
    const before = readiness(art().root, man()).percent;
    const roughBtn = btn('接着细化最粗的');
    R.a.roughTargets = [...document.querySelectorAll('.rough-strip .rs-item')].map((x) => x.textContent);
    await click(roughBtn, '接着细化最粗的 3 处');
    await wait(500);
    R.a.multiRunning = { multiChip: q('.ab-run .chip')?.textContent ?? null };
    await shot(`${P}54-多目标运行中-第1-3处.png`);
    await until(notRunning, 240000); await wait(600);
    const head = art().versions.find((v) => v.id === art().head)!;
    R.a.afterRough = { label: head.label, bar: q('.actionbar .ab-t')?.textContent, readyBefore: before, readyAfter: readiness(art().root, man()).percent, warnings: S().run.warnings, failure: S().run.failure?.message ?? null };
    await shot(`${P}55-细化后-就绪度变化-每步价值.png`);
  });

  // ═════ (a2) 范围漂移回归：评审者的原路径（第 1 步生成 → 第 2 步只展开「工作分解」） ═════
  await step('a2-范围漂移', async () => {
    await S().planIntent('产品发布执行计划');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await click(q('.bp-bar .ab-primary'), '开始第 1 步');
    await wait(500); await until(notRunning, 120000); await wait(500);
    R.drift = { step1: art().root.children?.map((c) => c.title), step1Bar: q('.actionbar .ab-t')?.textContent };
    await click(primary(), '全部保留，进入下一步'); await wait(600);
    R.drift.step2Primary = primary()?.textContent;
    R.drift.step2Hint = q('.ab-hint')?.textContent ?? null;
    await click(btn(R.drift.step2Primary?.includes('更多') ? '更多' : '更多') ?? null, '打开更多'); await wait(200);
    R.drift.skipInMore = !!item('跳过这一步');
    R.drift.deriveInMore = !!item('拆成功能清单');
    await shot(`${P}56-第2步-主按钮往下展开全部-跳过在更多里.png`);
    await keys([{ key: 'Escape' }]); await wait(200);
    // 单击“工作分解”= 选中（不进入编辑）；检查器标题与选中一致
    const wb = qa('.onode.d1').find((x) => x.querySelector('.ttl-t')?.textContent === '工作分解')!;
    await click(wb.querySelector('.ttl-t'), '单击「工作分解」');
    const wid = S().selectedId!;
    R.drift.singleClick = { selected: findNode(art().root, wid)?.title, editing: !!q('.onode input.inline-edit'), inspector: q('.inspector-float .sec-h span')?.textContent, matLine: q('.inspector-float .mat-line')?.textContent };
    await shot(`${P}57-单击选中-检查器显示所选部分.png`);
    const otherBefore = JSON.stringify(art().root.children!.filter((c) => c.id !== wid));
    await runPrimary('往下展开「工作分解」');
    const w = findNode(art().root, wid)!;
    R.drift.after = { title: w.title, content: w.content, inside: titles(w), rootTitleInside: titles(w).slice(1).includes(art().root.title), otherPartsInside: titles(w).filter((t) => ['目标与成功标准', '北极星指标', '里程碑', '风险与对策', '角色与分工'].includes(t)), othersUnchanged: JSON.stringify(art().root.children!.filter((c) => c.id !== wid)) === otherBefore, bar: q('.actionbar .ab-t')?.textContent, log: S().run.log.filter((l) => /越界|目标部分|择优|数字/.test(l.summary ?? '')).map((l) => l.summary) };
    await shot(`${P}58-范围守卫-只改了工作分解.png`);
    // 追问卡（评审发现“缺少依据”时出现）
    R.drift.ask = q('.ask-card')?.innerText ?? null;
    if (q('.ask-card')) {
      await shot(`${P}59-步骤间追问-AI想先确认.png`);
      const inp = q<HTMLInputElement>('.ask-card input');
      if (inp) { await click(inp, '回答追问'); await keys([{ text: '按单价×数量写明，单价参考上季度采购价' }, { key: 'Enter' }]); await wait(300); }
      R.drift.factsAfterAnswer = art().facts?.map((f) => `${f.q} → ${f.a}`);
    }
  });

  // ═════ (c) 陌生领域：家庭装修预算 ═════
  await step('c-装修', async () => {
    S().setView('home'); await wait(300);
    const ta = q<HTMLTextAreaElement>('.page textarea');
    await click(ta, '输入框');
    await keys([{ text: '家庭装修预算' }]); await wait(200);
    await click(btn('开始'), '开始');
    await until(() => !!q('.clarify-card .opt-btn'), 20000); await wait(300);
    const opts = qa('.clarify-card .opt-btn');
    // 每题选第 3 个选项：90–140㎡、20 万以上 → 用第 2 个：10–20 万
    const groups = qa('.clarify-card .clar-q, .clarify-card [role=radiogroup]');
    R.c = { questions: q('.clarify-card')?.innerText.slice(0, 200), opts: opts.length, groups: groups.length };
    const byText = (t: string) => opts.find((o) => o.textContent?.includes(t));
    await click(byText('90–140'), '选 90–140㎡'); await click(byText('10–20 万'), '选 10–20 万');
    await shot(`${P}60-装修-澄清问题.png`);
    await click(btn('继续'), '继续');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000); await wait(300);
    await click(q('.bp-bar .ab-primary'), '开始第 1 步');
    await wait(500); await until(notRunning, 120000); await wait(500);
    const a = art();
    R.c.title = a.title; R.c.facts = a.facts?.map((f) => `${f.q} → ${f.a}`);
    const sys = S().run.log.length;
    R.c.logN = sys;
    // 表格视图：金额从说明里整理到数字列，合计 / 小计 / 与总预算对比
    S().setRendererBy({ ...S().rendererBy, [a.id]: 'table' }); await wait(500);
    const tfoot = q('.grid tfoot')?.innerText ?? null;
    let inferred = 0, total = 0; walk(art().root, (n) => { if (n.props?.amount != null) total++; if (n.inferred?.includes('amount')) inferred++; });
    R.c.table = { tfoot, amounts: total, inferred, subRows: qa('.grid td.num.sub').length, subSample: qa('.grid td.num.sub').slice(0, 3).map((x) => x.textContent), inferTags: qa('.grid .inf').length };
    await shot(`${P}61-装修-表格-金额整理-合计小计-预算对比.png`);
    S().setRendererBy({ ...S().rendererBy, [a.id]: 'tree' }); await wait(400);
    R.c.treeSubtotals = qa('.subtotal').slice(0, 4).map((x) => x.textContent);
    await shot(`${P}62-装修-大纲-小计灰字-成熟度.png`);
    // 继续到最后一步并完成 → 交接清单
    await click(primary(), '全部保留，进入下一步'); await wait(500);
    R.c.step2Primary = primary()?.textContent;
    if (/全部/.test(R.c.step2Primary ?? '')) { await runPrimary('逐项展开全部'); R.c.step2Done = { label: art().versions.find((v) => v.id === art().head)?.label, ready: readiness(art().root, man()).percent, bar: q('.actionbar .ab-t')?.textContent }; }
    if (q('.ask-card')) { await click(btn('先不管'), '先不管'); }
    await shot(`${P}63-装修-逐项展开全部之后.png`);
    for (let i = 0; i < 4 && !art().finishedAt; i++) {
      const p = primary();
      if (!p) break;
      const t = p.textContent ?? '';
      if (/保留|进入下一步|完成/.test(t) && !p.disabled) await click(p, t);
      else { await click(btn('更多') ?? btn('再来一次'), '更多'); await wait(200); const sk = item('跳过这一步'); if (sk) await click(sk, '跳过'); else { await keys([{ key: 'Escape' }]); S().finishWork(true); } }
      await wait(500);
    }
    if (!art().finishedAt) S().finishWork(true);
    await wait(500);
    R.c.finish = { card: !!q('.finish-card'), handoff: q('.handoff')?.innerText.slice(0, 500), derive: q('.derive-row')?.innerText };
    await shot(`${P}64-完成卡-交接清单-以此为基础新建.png`);
    const csvBtn = btn('导出为待办');
    if (csvBtn) { await click(csvBtn, '导出 CSV'); await wait(500); R.c.csvToast = S().toasts.map((t) => t.text).pop(); }
  });

  // ═════ (b) 模糊想法 → 概念 → 功能清单 → 任务（跨作品链） ═════
  await step('b-派生', async () => {
    await S().planIntent('一个帮新手做家常菜的 App 概念', { templateId: 'concept' });
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await click(q('.bp-bar .ab-primary'), '开始概念第 1 步');
    await wait(500); await until(notRunning, 120000); await wait(400);
    const concept = { pid: S().current!.projectId, aid: art().id, title: art().title };
    await finishNow();
    R.b = { concept: concept.title, finishDerive: q('.derive-row')?.innerText };
    await click(btn('拆成功能清单'), '以此为基础新建：功能清单');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000); await wait(300);
    R.b.planIntent = S().plan?.intent; R.b.planTemplate = S().plan?.result?.source;
    await click(q('.bp-bar .ab-primary'), '开始功能清单');
    await wait(500); await until(notRunning, 120000); await wait(400);
    const feat = art();
    R.b.features = { title: feat.title, source: feat.source?.title, refs: feat.refs?.map((r) => r.name), link: q('.src-link')?.textContent, parts: feat.root.children?.length };
    await shot(`${P}65-派生-功能清单-来自概念.png`);
    // 上游改动 → 下游提示
    const featIds = { pid: S().current!.projectId, aid: feat.id };
    await click(q('.src-link'), '来自：概念（跳回上游）'); await wait(400);
    R.b.backToConcept = art().id === concept.aid;
    S().finishWork(false); await wait(200);
    { const r = JSON.parse(JSON.stringify(art().root)); if (r.children?.[0]) r.children[0].title += '（面向独居年轻人）'; else r.title += '（面向独居年轻人）'; S().manualEdit(r, '手动修改'); }
    await wait(500);
    S().openArtifact(featIds.pid, featIds.aid); await wait(500);
    R.b.upstreamBanner = q('.banner.info')?.innerText ?? null;
    await shot(`${P}66-上游有更新-提示下游.png`);
    if (btn('更新参考资料')) { await click(btn('更新参考资料'), '更新参考资料'); await wait(300); R.b.refUpdated = art().refs?.find((r) => r.id === art().source?.refId)?.text.includes('面向独居年轻人'); R.b.bannerGone = !q('.banner.info'); }
    // 功能清单 → 任务
    await finishNow();
    await click(btn('排成可分配的任务'), '以此为基础新建：任务');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000); await wait(300);
    await click(q('.bp-bar .ab-primary'), '开始任务');
    await wait(500); await until(notRunning, 120000); await wait(400);
    R.b.tasks = { title: art().title, source: art().source?.title, parts: art().root.children?.length };
    R.b.chain = [concept.title, feat.title, art().title];
  });
  await window.api.write(`${P}v17.json`, JSON.stringify(R, null, 2));
}
