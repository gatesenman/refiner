import type { Store } from './store';
import { DEFAULT_SETTINGS } from './settings';
import { findNode, findParent } from '../core';

export const R16: Record<string, any> = {};
/** v1.6 验收：真实鼠标 / 键盘 / 拖拽驱动构建好的应用，逐项记录结果（REFINER_TOUR=v16，REFINER_FIXTURES=样本目录） */
export async function v16Tour(h: { S: () => Store; wait: (ms: number) => Promise<unknown>; shot: (name: string, keep?: boolean) => Promise<void>; until: (fn: () => boolean, ms?: number) => Promise<void>; P: string }) {
  const { S, wait, shot, until, P } = h;
  const R = R16;
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
  const primary = () => qa('.actionbar .ab-primary')[0];
  const notRunning = () => !S().run.running;
  const drag = async (from: Element, to: Element, fy = 0.5, label = '') => {
    from.scrollIntoView({ block: 'center' }); await wait(120);
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const ty = Math.max(70, Math.min(innerHeight - 90, b.top + b.height * fy));
    await window.api.drag(a.left + a.width / 2, a.top + a.height / 2, b.left + Math.min(b.width / 2, 120), ty);
    await wait(400);
    R.drags = [...(R.drags ?? []), label];
  };
  const keys = (k: { text?: string; key?: string; shift?: boolean; ctrl?: boolean }[]) => window.api.keys(k);
  const lastToast = () => S().toasts.map((t) => t.text).pop() ?? null;
  const fx = S().info?.fixtures ?? '';
  const art = () => S().currentArtifact!;

  await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: true, theme: 'dark', expert: false, demoNoticeSeen: true });
  await wait(300);
  S().setView('home'); await wait(300);
  R.homeImportZone = !!q('.import-zone');
  await shot(`${P}31-首页-从已有材料开始.png`);

  // ───── 1. 导入真实文件：docx / pdf / xlsx / xmind ─────
  R.imports = [];
  for (const [file, shotName] of [['团建方案.docx', '32-导入Word-识别结构-规划师选起始步骤.png'], ['会议纪要.pdf', ''], ['项目排期.xlsx', '32b-导入Excel-识别结构.png'], ['产品规划.xmind', '32c-导入XMind-结构.png']] as const) {
    S().setView('home'); await wait(200);
    const f = await window.api.importRead(`${fx}/${file}`);
    await S().importStart([f]);
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 15000);
    await wait(300);
    const sd = S().plan?.seed;
    const card = q('.seed-card')?.innerText ?? null;
    if (shotName) await shot(`${P}${shotName}`);
    await click(q('.bp-bar .ab-primary'), `开始（${file}）`);
    await wait(500);
    const a = art();
    const m = S().currentManifest!;
    R.imports.push({ file, kind: sd?.kind, useAsDraft: sd?.useAsDraft, seedCard: card, button: null, stageIndex: a.stageIndex, stageName: m.stages[a.stageIndex]?.name, stages: m.stages.length, parts: a.root.children?.map((c) => c.title).slice(0, 8), refs: a.refs?.map((r) => ({ name: r.name, chars: r.text.length })), running: S().run.running, headLabel: a.versions.find((v) => v.id === a.head)?.label });
    if (S().run.running) await until(notRunning, 20000);
  }
  // 参考资料面板（xmind 作品之前的 docx 作品更典型：回到 docx 作品）
  const docxArt = S().projects.flatMap((p) => p.artifacts.map((x) => ({ p, x }))).find((o) => o.x.refs?.[0]?.name === '团建方案.docx');
  if (docxArt) { S().openArtifact(docxArt.p.id, docxArt.x.id); await wait(400); }
  await click(btn('资料'), '打开参考资料');
  await S().addRefs('text', { name: '公司差旅标准', text: '住宿每晚不超过 500 元；'.repeat(1200) });
  await wait(400);
  R.refsPanel = q('.refs')?.innerText.slice(0, 600);
  await shot(`${P}33-参考资料面板-预算与截断.png`);
  await click(btn('资料'), '收起参考资料');

  // ───── 2. 直接编辑：单击标题编辑、Enter 新建同级、Tab 缩进、F2、Delete、撤销提示 ─────
  const d1 = () => qa('.onode.d1');
  const firstTitle = d1()[0]?.querySelector('.ttl-t');
  await click(firstTitle, '单击标题（v1.7：单击 = 选中）');
  R.singleClickSelects = !q('.onode input.inline-edit') && S().selectedId === art().root.children![0].id;
  await keys([{ key: 'F2' }]); await wait(250);
  R.inlineEditOnClick = !!q('.onode input.inline-edit');
  await keys([{ text: '目标与范围' }, { key: 'Enter' }]);
  await wait(300);
  R.enterCreatedSibling = !!q('.onode input.inline-edit') && S().editingId !== S().currentArtifact!.root.children![0].id;
  await keys([{ text: '风险与预案' }, { key: 'Tab' }]);
  await wait(400);
  const newId = S().editingId!;
  R.tabIndented = { title: findNode(art().root, newId)?.title, parent: findParent(art().root, newId)?.title };
  await shot(`${P}34-行内编辑-Enter新建同级-Tab缩进.png`);
  await keys([{ key: 'Tab', shift: true }]);
  await wait(400);
  R.shiftTabOutdented = { parent: findParent(art().root, newId)?.id === art().root.id };
  await keys([{ key: 'Escape' }]); await wait(200);
  R.afterEditTopTitles = art().root.children?.map((c) => c.title).slice(0, 5);
  // F2 进入编辑，Esc 取消
  await click(d1()[1], '选中第 2 个部分');
  await keys([{ key: 'F2' }]); await wait(200);
  R.f2Edits = !!q('.onode input.inline-edit');
  await keys([{ key: 'Escape' }]); await wait(200);
  // Delete + 撤销提示
  const delTitle = findNode(art().root, S().selectedId!)?.title;
  await click(d1()[1], '再次选中（行）');
  if (q('.onode input.inline-edit')) { await keys([{ key: 'Escape' }]); await wait(150); }
  await keys([{ key: 'Delete' }]); await wait(300);
  R.deleteToast = lastToast();
  R.deleted = !art().root.children?.some((c) => c.title === delTitle);
  await keys([{ key: 'z', ctrl: true }]); await wait(300);
  R.undoToast = lastToast();
  R.restored = art().root.children?.some((c) => c.title === delTitle);

  // ───── 3. 拖拽：大纲排序 / 移到别的部分下 ─────
  const before = art().root.children!.map((c) => c.title);
  let rows = d1();
  await drag(rows[2].querySelector('.dh')!, rows[0], 0.12, '大纲：第 3 部分 → 第 1 部分之前');
  R.outlineReorder = { before: before.slice(0, 4), after: art().root.children!.map((c) => c.title).slice(0, 4), toast: lastToast() };
  await shot(`${P}35-拖拽排序-已移动可撤销.png`, true);
  rows = d1();
  const kid = qa('.onode.d2')[0];
  const kidId = kid?.dataset.nodeId;
  const target = rows[rows.length - 1];
  if (kid && target) {
    await drag(kid.querySelector('.dh')!, target, 0.5, '大纲：子项 → 最后一个部分里面');
    R.outlineReparent = { node: findNode(art().root, kidId!)?.title, newParent: findParent(art().root, kidId!)?.title, expected: target.querySelector('.ttl-t')?.textContent, toast: lastToast() };
  }
  await keys([{ key: 'z', ctrl: true }]); await wait(300);
  R.dragUndoToast = lastToast();

  // ───── 4. 看板拖到另一列 + 表格行拖拽 ─────
  const t = S().createArtifact('tasks', '上线一个微信小程序商城', { title: '小程序商城任务', projectId: S().projects[0]?.id })!;
  await wait(200);
  await S().runOp({ op: 'generate', stageIndex: 0, pid: t.pid, aid: t.aid, targetId: null });
  await until(notRunning, 20000); await wait(300);
  S().keepAll(); await wait(300);
  const cols = qa('.bcol');
  const card = cols[0]?.querySelector<HTMLElement>('.bcard');
  const cardId = card?.dataset.nodeId;
  const m = S().currentManifest!;
  const gk = (m.rendererOptions?.groupBy as string) ?? 'status';
  const from = cardId ? findNode(art().root, cardId)?.props?.[gk] : null;
  if (card && cols[1]) { card.scrollIntoView({ block: 'nearest' }); const cr = card.getBoundingClientRect(), c2 = cols[1].getBoundingClientRect(); await window.api.drag(cr.left + 30, cr.top + cr.height / 2, c2.left + c2.width / 2, Math.min(c2.bottom - 20, cr.top + cr.height / 2)); await wait(400); }
  R.boardMove = { from, to: cardId ? findNode(art().root, cardId)?.props?.[gk] : null, col2: cols[1]?.querySelector('.bcol-h')?.textContent, toast: lastToast() };
  await shot(`${P}36-看板-拖到另一列.png`, true);
  S().setRendererBy({ ...S().rendererBy, [art().id]: 'table' }); await wait(400);
  const trs = qa<HTMLTableRowElement>('table.grid tbody tr');
  // 找同一组里相邻的两行：把后一行拖到前一行之前
  const pid = (r: HTMLTableRowElement) => findParent(art().root, r.dataset.nodeId!)?.id;
  const k = trs.findIndex((r, i) => i > 0 && pid(r) === pid(trs[i - 1]) && !findNode(art().root, r.dataset.nodeId!)?.children?.length);
  const sib = () => findParent(art().root, trs[k].dataset.nodeId!)!.children!.map((c) => c.title);
  const rowBefore = k > 0 ? sib() : [];
  if (k > 0) await drag(trs[k].querySelector('td.dh')!, trs[k - 1], 0.15, '表格：一行 → 上一行之前');
  R.tableReorder = { before: rowBefore, after: k > 0 ? findParent(art().root, trs[k].dataset.nodeId!)!.children!.map((c) => c.title) : [], toast: lastToast() };
  await shot(`${P}36b-表格-拖动行排序.png`, true);

  // ───── 5. 运行反馈：骨架 + 流式；下一步不自动运行；范围选择；Esc 顺序 ─────
  S().setView('home'); await wait(200);
  await S().planIntent('策划一场三天的团队建设');
  await until(() => !!S().plan && !S().plan!.running, 15000);
  S().startFromBlueprint({ projectId: S().projects[0]?.id, autoRun: true });
  const seen = { skeleton: false, stream: false, maxParts: 0 };
  let streamShot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const l = q('[data-live]');
    if (l?.dataset.live === 'skeleton') seen.skeleton = true;
    if (l?.dataset.live === 'stream') { seen.stream = true; seen.maxParts = Math.max(seen.maxParts, l.querySelectorAll('.live-n.d1').length); if (!streamShot && seen.maxParts >= 2) { streamShot = true; await window.api.capture(`${P}37-运行中-流式显示已生成部分.png`); } }
    if (seen.skeleton && !streamShot && Date.now() - t0 < 400) await window.api.capture(`${P}37a-运行中-骨架占位.png`);
    if (!S().run.running && Date.now() - t0 > 500) break;
    await wait(40);
  }
  R.runningFeedback = seen;
  await until(notRunning, 20000); await wait(400);
  await click(primary(), '全部保留，进入下一步');
  await wait(500);
  R.noAutoRun = { running: S().run.running, stageIndex: art().stageIndex, bar: q('.actionbar .ab-t')?.textContent, primary: primary()?.textContent, estimate: q('.ab-est')?.textContent };
  await click(q('.scope-btn'), '打开范围选择');
  R.scopeMenu = qa('.scope-menu .menu-item').map((e) => e.textContent);
  await shot(`${P}38-下一步不自动运行-选择范围.png`);
  await keys([{ key: 'Escape' }]); await wait(200);
  R.escClosesScope = !q('.scope-menu');
  // Esc 顺序：浮层 → 面板 → 选择
  await click(d1()[1], '选中一部分');
  if (q('.onode input.inline-edit')) { await keys([{ key: 'Escape' }]); await wait(150); }
  await click(btn('历史'), '打开历史面板');
  await click(btn('更多') ?? btn('再来一次'), '打开更多菜单');
  const st = () => ({ menu: !!q('.actionbar .menu'), dock: !!q('.dock'), sel: !!S().selectedId });
  const esc: any[] = [st()];
  for (let i = 0; i < 3; i++) { await keys([{ key: 'Escape' }]); await wait(200); esc.push(st()); }
  R.escOrder = esc;
  // 运行第 2 步，然后“再来一次”，再并排对比
  await click(primary(), '开始第 2 步');
  await until(() => S().run.running, 3000); await until(notRunning, 20000); await wait(400);
  await click(btn('再来一次'), '打开再来一次');
  const again = [...document.querySelectorAll<HTMLElement>('.actionbar .menu-item')].find((e) => e.textContent?.startsWith('再来一次'));
  await click(again, '再来一次');
  await until(() => S().run.running, 3000); await until(notRunning, 20000); await wait(400);
  await click(btn('再来一次'), '打开菜单');
  const cmpItem = [...document.querySelectorAll<HTMLElement>('.actionbar .menu-item')].find((e) => e.textContent?.includes('并排对比'));
  R.compareMenuItem = !!cmpItem;
  await click(cmpItem, '与上一版并排对比');
  await wait(400);
  const body = q('.cmp-body')?.innerText ?? '';
  R.compare = { addNodes: qa('.cmp-modal .cmp-node.c-add').length, modNodes: qa('.cmp-modal .cmp-node.c-mod').length, delNodes: qa('.cmp-modal .cmp-node.c-del').length, open: !!q('.cmp-modal'), rows: qa('.cmp-row').length, changed: qa('.cmp-row:not(.st-same)').length, ins: qa('.cmp-modal ins').length, del: qa('.cmp-modal del').length, rawBraces: /\{\s*\w+\s*:/.test(body), header: q('.cmp-modal .modal-h')?.innerText, useButtons: qa('.cmp-modal .cmp-act button:not([disabled])').length };
  await shot(`${P}39-并排对比-字级差异-用这一版.png`);
  const use = qa('.cmp-modal .cmp-act button:not([disabled])')[0];
  if (use) { await click(use, '用这一版'); R.compareUse = lastToast(); }
  await keys([{ key: 'Escape' }]); await wait(200);
  R.compareClosedByEsc = !q('.cmp-modal');
  // 手动改一个子项的标题，再与上一版并排对比：改动项内显示字级差异
  const sub = qa('.onode.d2 .ttl-t')[0];
  await click(sub, '单击子项标题');
  await keys([{ key: 'F2' }]); await wait(250);
  await keys([{ key: 'End' }, { text: '（雨天改室内）' }, { key: 'Enter' }]); await wait(200);
  await keys([{ key: 'Escape' }]); await wait(300);
  // 历史：结构化改动清单（不再是原始 {owner:…}）
  await click(btn('历史'), '打开历史');
  await wait(200);
  const vrow = qa('.vrow')[1];
  if (vrow) await click(vrow, '选中改标题的版本');
  R.historyList = { items: qa('.chg-list .chg-i').length, rawBraces: /\{\s*\w+\s*:/.test(q('.chg-list')?.innerText ?? '') };
  await shot(`${P}40-历史-结构化改动-勾选两版对比.png`);
  await click(btn('与上一版对比'), '与上一版对比');
  await wait(300);
  R.compareWord = { ins: qa('.cmp-modal ins').map((e) => e.textContent), del: qa('.cmp-modal del').map((e) => e.textContent), modNodes: qa('.cmp-modal .cmp-node.c-mod').length };
  await shot(`${P}39b-并排对比-改动项内字级差异.png`);
  await keys([{ key: 'Escape' }]); await wait(200);
  await click(btn('历史'), '收起历史');
  R.usageChip = q('.chip.usage')?.textContent ?? null;
  R.workUsage = art().usage;

  // ───── 6. 预算上限拦截 ─────
  await S().saveSettings({ ...S().settings, demoMode: false, text: { ...S().settings.text, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-test', model: 'deepseek-chat' }, budget: { perRun: 0.0001 } });
  await wait(400);
  R.estimateReal = q('.ab-est')?.textContent ?? null;
  await click(d1()[1], '选中一部分（这一步需要先选）');
  if (q('.onode input.inline-edit')) { await keys([{ key: 'Escape' }]); await wait(150); }
  R.estimateReal = q('.ab-est')?.textContent ?? null;
  await click(primary(), '运行（应被预算拦下）');
  await wait(400);
  R.budget = { dialog: q('.modal')?.innerText ?? null, running: S().run.running };
  await shot(`${P}41-预算上限-拦截说明.png`);
  await click(btn('知道了'), '关闭预算提示');
  await S().saveSettings({ ...S().settings, demoMode: true, budget: {} });

  // ───── 7. 设置：费用 / 备份 / 更新（不可达源不崩溃）/ 字号 ─────
  S().setView('settings'); await wait(500);
  await click(btn('立即备份'), '立即备份'); await wait(500);
  R.backups = (await window.api.backups()).map((b: any) => b.reason);
  R.secure = await window.api.secureStatus();
  const ui = q<HTMLInputElement>('input[placeholder^="例如 https://example.com"]');
  if (ui) { ui.focus(); await keys([{ text: 'http://127.0.0.1:9/feed/' }]); await wait(300); }
  await click(btn('检查更新'), '检查更新（不可达）');
  await until(() => !!document.querySelector('.form-card .hint.warn-t') || [...document.querySelectorAll('.form-card .hint')].some((e) => e.textContent?.includes('已是最新')), 25000);
  R.update = [...document.querySelectorAll('.form-card .hint')].map((e) => e.textContent).filter((x) => x?.includes('检查失败') || x?.includes('最新'));
  q('.page')?.scrollTo({ top: 99999 }); await wait(300);
  await shot(`${P}42-设置-费用预算-备份-更新.png`);
  const z0 = await window.api.zoomFactor();
  await keys([{ key: '=', ctrl: true }]); await wait(400);
  const z1 = await window.api.zoomFactor();
  await shot(`${P}43-界面放大-Ctrl加.png`);
  await keys([{ key: '-', ctrl: true }]); await keys([{ key: '-', ctrl: true }]); await wait(400);
  const z2 = await window.api.zoomFactor();
  await keys([{ key: '0', ctrl: true }]); await wait(400);
  R.zoom = { z0, z1, z2, reset: await window.api.zoomFactor(), saved: S().settings.fontScale };
  await window.api.write(`${P}v16.json`, JSON.stringify(R, null, 2));
}
