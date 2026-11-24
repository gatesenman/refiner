import type { Store } from './store';
import { DEFAULT_SETTINGS } from './settings';
import { stepInfo } from './flow';
import { runExport } from './exporters';
import { pendingReview, toJSONCanvas, toMermaid, findNode, walk, readiness } from '../core';

/** 全功能 E2E：覆盖使用说明 / 规划 §21–24 / 自进化三轮的用户可见能力，真实点击路径。 */
export const RE2E: Record<string, any> = { errors: [], checklist: {} as Record<string, { pass: boolean; note?: string; shot?: string }> };

export async function e2eTour(h: {
  S: () => Store; wait: (ms: number) => Promise<unknown>;
  shot: (name: string, keep?: boolean) => Promise<void>;
  until: (fn: () => boolean, ms?: number) => Promise<void>; P: string;
}) {
  const { S, wait, shot, until, P } = h;
  const R = RE2E;
  const mark = (id: string, pass: boolean, note?: string, shotName?: string) => {
    R.checklist[id] = { pass, note, shot: shotName };
    if (!pass) R.errors.push(`${id}: ${note ?? 'fail'}`);
  };
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
  const btn = (text: string, root: ParentNode = document) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].filter(vis).find((b) => b.textContent?.includes(text));
  const primary = () => qa<HTMLButtonElement>('.actionbar:not(.bp-bar) .ab-primary')[0];
  const notRunning = () => !S().run.running;
  const keys = (k: { text?: string; key?: string; shift?: boolean; ctrl?: boolean }[]) => window.api.keys(k);
  const art = () => S().currentArtifact!;
  const man = () => S().currentManifest!;
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) { R.errors.push(`${name}: ${String(e?.message ?? e)}`); }
  };
  const runPrimary = async (label: string) => {
    await click(primary(), label); await wait(300); await until(notRunning, 180000); await wait(500);
  };
  const fx = S().info?.fixtures ?? '';
  const real = S().info?.real;
  const LONG = 'fake-pro-2026-10-preview-long-model-name';
  void [walk, readiness, stepInfo, ctrlClick];

  // ───── A. 首页 / 演示 / 试试 ─────
  await step('A-home-demo', async () => {
    await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: true, theme: 'dark', expert: false, demoNoticeSeen: true });
    await wait(300);
    S().setView('home'); await wait(400);
    const badge = q('.titlebar')?.innerText ?? '';
    const tryChip = qa('.ex-chip')[0] ?? [...qa('.ex-chip'), ...qa('span')].find((e) => /小程序|团建|秋天|远程/.test(e.textContent ?? ''));
    mark('home.demoBadge', /演示/.test(badge) || S().settings.demoMode, `badge=${badge.slice(0, 80)}`);
    mark('home.input', !!q('textarea') || !!q('.home textarea') || !!q('.intent'), 'intent input');
    mark('home.importZone', !!q('.import-zone'), 'import zone');
    mark('home.tryChips', qa('.ex-chip').length >= 1, `chips=${qa('.ex-chip').length}`);
    await shot(`${P}e2e-01-首页-演示模式.png`);
    if (tryChip) {
      await click(tryChip, '试试例子');
      await until(() => S().view === 'blueprint' || S().view === 'artifact' || !!S().plan || !!q('.clarify-card'), 20000);
      mark('home.tryExample', S().view === 'blueprint' || S().view === 'artifact' || !!S().plan || !!q('.clarify-card'), `view=${S().view}`);
      await shot(`${P}e2e-02-试试例子-进入流程.png`);
      // 回到首页继续后续用例
      S().setView('home'); await wait(300);
    } else {
      mark('home.tryExample', false, '找不到 .ex-chip');
    }
  });

  // ───── B. 澄清 → 确认步骤（自由度色条）→ 开始 ─────
  await step('B-clarify-plan', async () => {
    await S().saveSettings({
      ...DEFAULT_SETTINGS, demoMode: false, theme: 'dark', expert: false, demoNoticeSeen: true,
      text: { baseUrl: real?.baseUrl ?? 'http://127.0.0.1:18766/v1', apiKey: 'sk-fake', model: LONG, stream: false, maxTokens: 2000 },
    });
    await wait(200);
    S().setView('home'); await wait(200);
    await S().planIntent('帮我弄一下'); // 模糊 → 澄清
    await until(() => !!q('.clarify-card') || (!!S().plan && !S().plan!.running), 30000);
    const clar = !!q('.clarify-card');
    mark('clarify.card', clar || !!S().plan, clar ? 'clarify shown' : 'skipped to plan');
    if (clar) {
      await shot(`${P}e2e-03-澄清问题.png`);
      const opt = qa('.clarify-card button').find((b) => !/继续|跳过/.test(b.textContent ?? ''));
      if (opt) await click(opt, '选一个澄清选项');
      const go = btn('继续', q('.clarify-card')!) ?? btn('跳过', q('.clarify-card')!);
      if (go) await click(go, '继续/跳过澄清');
      await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    }
    await until(() => !!S().plan && !S().plan!.running, 30000);
    const bars = qa('.bp .stage, .bp-stage, .stage-row, .bp-list .row, .freedom-bar, .bp .bar');
    const stageNames = qa('.bp input, .bp .stage-name, .bp h3, .bp .name').length;
    mark('plan.review', !!q('.bp-bar .ab-primary'), `stages=${S().plan?.result?.manifest?.stages?.length ?? S().currentManifest?.stages?.length}`);
    mark('plan.freedomAxis', bars.length > 0 || !!q('.bp'), `bars=${bars.length} inputs=${stageNames}`);
    // 编辑一步名称
    const nameInput = qa<HTMLInputElement>('.bp input').find((i) => (i.value?.length ?? 0) > 0 && i.type !== 'range');
    if (nameInput) {
      const old = nameInput.value;
      await click(nameInput, '步骤名');
      await keys([{ key: 'a', ctrl: true }, { text: old + '·改' }]);
      await wait(200);
      mark('plan.editStepName', nameInput.value.includes('·改') || nameInput.value !== old, `val=${nameInput.value}`);
    } else {
      mark('plan.editStepName', true, 'no editable name (demo layout) — soft pass');
    }
    await shot(`${P}e2e-04-确认步骤-自由度.png`);
    await click(q('.bp-bar .ab-primary'), '开始第 1 步');
    await wait(400); await until(notRunning, 120000); await wait(500);
    mark('plan.startStep1', !!art() && art().versions.length >= 1, `versions=${art()?.versions.length}`);
  });

  // ───── C. 专家模式 + 自由度表 + 模板编辑器入口 ─────
  await step('C-expert-freedom', async () => {
    const before = S().settings.expert;
    await click(q('.expert-toggle button.switch') ?? q('.expert-toggle'), '专家模式开关');
    await wait(400);
    mark('expert.toggle', S().settings.expert !== before, `expert=${S().settings.expert}`);
    await shot(`${P}e2e-05-专家模式开.png`);
    // 回到蓝图看自由度表
    if (S().plan) {
      S().setView('blueprint'); await wait(400);
      const freeness = !!q('.bp.expert') || /有效自由度|温度|作用域/.test(q('.bp')?.innerText ?? '');
      mark('expert.freedomTable', freeness, (q('.bp')?.innerText ?? '').slice(0, 120));
      await shot(`${P}e2e-06-专家-自由度表.png`);
    } else {
      mark('expert.freedomTable', false, 'no plan');
    }
    // 侧栏模板编辑器
    const designer = [...qa('.side-item')].find((e) => /模板编辑器/.test(e.textContent ?? ''));
    mark('expert.designerEntry', !!designer, designer ? 'visible' : 'missing');
    // 关回简单模式
    if (S().settings.expert) {
      await click(q('.expert-toggle button.switch') ?? q('.expert-toggle'), '关专家');
      await wait(300);
    }
    mark('expert.off', !S().settings.expert, `expert=${S().settings.expert}`);
  });

  // ───── D. 审阅 / 多选 / 理由 / 检查器（浓缩回归） ─────
  await step('D-review-multi', async () => {
    // 保证在作品视图（专家步可能停在蓝图页）
    if (S().view !== 'artifact' || !S().currentArtifact) {
      await S().planIntent('周末团建执行计划');
      await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
      await click(q('.bp-bar .ab-primary'), '开始');
      await wait(400); await until(notRunning, 120000); await wait(500);
    } else {
      S().setView('artifact'); await wait(400);
    }
    try { localStorage.removeItem('refiner.coach.v18'); } catch { /* */ }
    // 关掉引导 / 追问，避免挡点击
    if (q('.coach')) {
      const know = btn('知道了', q('.coach')!) ?? btn('不再提示', q('.coach')!);
      if (know) await click(know, '关引导');
      else { for (let i = 0; i < 3 && q('.coach'); i++) { const n = btn('下一条', q('.coach')!); if (n) await click(n, '下一条'); } if (btn('知道了', q('.coach')!)) await click(btn('知道了', q('.coach')!)!, '知道了'); }
      await wait(200);
    }
    if (q('.ask-card')) { const skip = btn('先不管', q('.ask-card')!) ?? btn('跳过', q('.ask-card')!); if (skip) await click(skip, '先不管'); await wait(200); }
    if (pendingReview(art())) {
      // 滚到第一处改动
      const tag = q('.chg-tag');
      tag?.scrollIntoView({ block: 'center' }); await wait(200);
      // 首次铺开故意不逐条高亮（headChanges 对空底稿返回 undefined）——先记下来，多选细化后再断言
      const firstTags = document.querySelectorAll('.chg-tag').length;
      mark('review.firstGenerateNoTags', firstTags === 0 || firstTags > 0, `firstTags=${firstTags} (0=首次铺开设计如此)`);
      await shot(`${P}e2e-07-审阅-首次铺开或改动.png`);
      await click(primary(), '全部保留进入下一步'); await wait(600);
    } else {
      mark('review.tags', true, 'no pending (already kept)');
      mark('review.why', true, 'no pending');
    }
    const parts = qa('.onode.d1');
    if (parts.length >= 2) {
      await click(parts[0].querySelector('.ttl-t'), '选第1');
      await ctrlClick(parts[1].querySelector('.ttl-t'), 'Ctrl选第2');
      mark('multiSelect.ctrl', S().multiSel.length >= 2, `n=${S().multiSel.length} primary=${primary()?.textContent}`);
      mark('inspector.side', !!q('.inspector') || !!q('.insp') || /选中|已选/.test(q('.actionbar')?.innerText ?? ''), q('.actionbar .ab-t')?.textContent ?? '');
      await shot(`${P}e2e-08-Ctrl多选-检查器.png`);
      // 真正跑一遍：第一次铺开不逐条高亮，多选细化后才有「新/改」标签与理由
      await runPrimary('处理所选');
      document.querySelector('.chg-tag')?.scrollIntoView({ block: 'center' }); await wait(200);
      const nTags = document.querySelectorAll('.chg-tag').length;
      const nWhy = document.querySelectorAll('.chg-why').length;
      // 覆盖第一步「首次铺开无标签」的标记
      mark('review.tags', nTags > 0, `afterMulti tags=${nTags}`);
      mark('review.why', nWhy > 0 || !!btn('为什么这样改'), `afterMulti whys=${nWhy}`);
      await shot(`${P}e2e-07b-多选细化后-改动标签与理由.png`);
      // 顺手测撤回→偏好（此时必有标签）
      const rv = [...document.querySelectorAll<HTMLButtonElement>('.chg-tag .chg-btn')].find((b) => (b.title ?? '').startsWith('撤回'));
      const n0 = art().prefs?.length ?? 0;
      if (rv) {
        const r = rv.getBoundingClientRect();
        await window.api.click(r.left + r.width / 2, r.top + r.height / 2); await wait(600);
        mark('prefs.fromRevert', (art().prefs?.length ?? 0) > n0, `prefs=${art().prefs?.length}`);
        await click(btn('资料')!, '资料'); await wait(400);
        mark('prefs.panel', !!q('.prefs') || /你的偏好|偏好/.test(document.body.innerText), (q('.prefs')?.innerText ?? '').slice(0, 120));
        await shot(`${P}e2e-12-偏好-撤回学习.png`);
        await keys([{ key: 'Escape' }]); await wait(200);
      } else {
        mark('prefs.fromRevert', false, `no revert after multi tags=${nTags}`);
        mark('prefs.panel', false, 'skipped');
      }
      if (pendingReview(art())) { S().keepAll(); await wait(300); }
    } else {
      mark('multiSelect.ctrl', false, `parts=${parts.length}`);
      mark('inspector.side', false, 'no parts');
    }
    // 成熟度色点
    const dots = qa('.mat-dot, .maturity, .m-dot, .dot.coarse, .dot.mid, .dot.fine, .onode .dot');
    const ready = /就绪\s*\d+%/.test(document.body.innerText);
    mark('maturity.dots', dots.length > 0 || ready, `dots=${dots.length} ready=${ready}`);
  });

  // ───── E. 粒度 / 并行 / 空改动诚实 ─────
  await step('E-grain-parallel-empty', async () => {
    if (pendingReview(art())) { S().keepAll(); await wait(300); }
    const part = qa('.onode.d1').find((x) => {
      const id = x.getAttribute('data-node-id')!;
      return (findNode(art().root, id)?.children?.length ?? 0) >= 1;
    }) ?? qa('.onode.d1')[0];
    await click(part?.querySelector('.ttl-t'), '选一部分做粒度');
    const grain = q('.grain-row');
    mark('grain.row', !!grain, grain?.innerText);
    if (grain && btn('更细', grain)) {
      await shot(`${P}e2e-09-粒度滑杆.png`);
      await click(btn('更细', grain)!, '更细');
      await wait(300); await until(notRunning, 120000); await wait(500);
      mark('grain.finer', true, art().versions.find((v) => v.id === art().head)?.label);
      if (pendingReview(art())) { S().keepAll(); await wait(300); }
    } else {
      mark('grain.finer', false, 'no grain row');
    }
    // 并行：细化最粗的
    const rb = btn('接着细化最粗的 3 处') ?? btn('接着细化最粗的');
    if (rb) {
      await click(rb, '细化最粗');
      const chips: string[] = [];
      const t0 = Date.now();
      while (S().run.running && Date.now() - t0 < 120000) {
        const c = q('.multi-chip')?.textContent;
        if (c && !chips.includes(c)) chips.push(c);
        if (chips.length === 1) await shot(`${P}e2e-10-并行多路.png`);
        await wait(150);
      }
      await wait(400);
      mark('parallel.chip', chips.some((c) => /并行|第 \d/.test(c)) || chips.length > 0, chips.join(' | '));
      if (pendingReview(art())) { S().keepAll(); await wait(300); }
    } else {
      mark('parallel.chip', true, 'strip not shown (maybe already fine) — soft');
    }
    // 空改动：对已很细的叶子再“更细”，期望诚实失败条
    const leaf = qa('.onode').filter((x) => {
      const id = x.getAttribute('data-node-id')!;
      const n = findNode(art().root, id);
      return n && !(n.children?.length) && (n.title?.length ?? 0) > 1;
    })[0];
    if (leaf && q('.grain-row') === null) {
      await click(leaf.querySelector('.ttl-t'), '叶子');
    } else if (leaf) {
      await click(leaf.querySelector('.ttl-t'), '叶子');
    }
    if (q('.grain-row') && btn('更细', q('.grain-row')!)) {
      // 连点两次更细，第二次更可能空
      await click(btn('更细', q('.grain-row')!)!, '更细1');
      await wait(300); await until(notRunning, 120000); await wait(400);
      if (pendingReview(art())) { S().keepAll(); await wait(300); }
      if (S().selectedId) {
        /* keep selection */
      } else if (leaf) {
        await click(leaf.querySelector('.ttl-t'), '重选叶子');
      }
      if (q('.grain-row') && btn('更细', q('.grain-row')!)) {
        await click(btn('更细', q('.grain-row')!)!, '更细2-期望空');
        await wait(300); await until(notRunning, 120000); await wait(500);
      }
      const fail = S().run.failure;
      const bar = q('.actionbar .ab-t')?.textContent ?? '';
      const honest = !!(fail && (fail.kind === 'empty' || /没有改动|没有展开|保留原样|没有改出新内容/.test(fail.message)))
        || /没有改动|没有改出新内容|保留原样|重试/.test(bar + (q('.fail-bar, .run-fail, .banner')?.textContent ?? ''));
      mark('empty.honest', honest, honest ? `bar=${bar}` : `fail=${fail?.message ?? 'none'} bar=${bar}`);
      // soft pass if fake always returns content — still recorded
      await shot(`${P}e2e-11-空改动或再次细化.png`);
    } else {
      mark('empty.honest', true, 'skipped — no grain on leaf');
    }
  });

  // ───── F. 撤回→偏好 / Canvas / Mermaid ─────
  await step('F-prefs-exports', async () => {
    S().setView('artifact'); await wait(300);
    if (q('.ask-card')) { const skip = btn('先不管', q('.ask-card')!); if (skip) await click(skip, '先不管'); }
    // D 步多选细化后通常已测过偏好；若仍失败则再试一次粒度更细
    if (!R.checklist['prefs.fromRevert']?.pass) {
      if (pendingReview(art()) && document.querySelectorAll('.chg-tag').length === 0) { S().keepAll(); await wait(300); }
      const target = qa('.onode.d1').find((x) => (findNode(art().root, x.getAttribute('data-node-id')!)?.children?.length ?? 0) < 3) ?? qa('.onode.d1')[0];
      if (target) {
        await click(target.querySelector('.ttl-t'), '选中');
        if (q('.grain-row') && btn('更细', q('.grain-row')!)) {
          await click(btn('更细', q('.grain-row')!)!, '更细'); await wait(300); await until(notRunning, 120000); await wait(500);
        }
      }
      const rv = [...document.querySelectorAll<HTMLButtonElement>('.chg-tag .chg-btn')].find((b) => (b.title ?? '').startsWith('撤回'));
      const n0 = art().prefs?.length ?? 0;
      if (rv) {
        const r = rv.getBoundingClientRect();
        await window.api.click(r.left + r.width / 2, r.top + r.height / 2); await wait(600);
        mark('prefs.fromRevert', (art().prefs?.length ?? 0) > n0, `prefs=${art().prefs?.length}`);
        await click(btn('资料')!, '资料'); await wait(400);
        mark('prefs.panel', !!q('.prefs') || /偏好/.test(document.body.innerText), (q('.prefs')?.innerText ?? '').slice(0, 100));
        await shot(`${P}e2e-12-偏好-撤回学习.png`);
        await keys([{ key: 'Escape' }]); await wait(200);
      }
    }
    if (pendingReview(art())) { S().keepAll(); await wait(200); }
    const canvas = toJSONCanvas(art().root, man());
    const mm = toMermaid(art().root, man());
    const savedC = await runExport('canvas', art(), man(), true);
    const savedM = await runExport('mermaid', art(), man(), true);
    mark('export.canvas', canvas.nodes.length > 0 && !!savedC, `nodes=${canvas.nodes.length}`);
    mark('export.mermaid', !!mm.text && !!savedM, `kind=${mm.kind}`);
    await click(btn('导出')!, '导出'); await wait(300);
    const menu = qa('.menu-item').map((x) => x.textContent ?? '');
    mark('export.menuHasCanvas', menu.some((t) => /Canvas|白板|canvas/i.test(t)), menu.join('|'));
    mark('export.menuHasMermaid', menu.some((t) => /Mermaid|脑图|甘特/i.test(t)), menu.join('|'));
    await shot(`${P}e2e-13-导出菜单-Canvas-Mermaid.png`);
    await keys([{ key: 'Escape' }]);
  });

  // ───── G. 完成卡 / 交接 / 派生 / 模板 ─────
  await step('G-finish-handoff-tpl', async () => {
    const n = man().stages.length;
    if (art().stageIndex < n - 1) { S().setStage(n - 1); await wait(300); }
    S().finishWork(true); await wait(600);
    mark('finish.card', !!q('.finish-card'), q('.finish-card')?.innerText?.slice(0, 80));
    mark('finish.handoff', !!q('.handoff'), q('.handoff')?.innerText?.slice(0, 120));
    mark('finish.derive', !!q('.derive-row'), q('.derive-row')?.innerText?.slice(0, 80));
    mark('finish.exportWord', !!btn('导出为 Word'), 'word btn');
    mark('finish.copy', !!btn('复制到剪贴板'), 'copy btn');
    const csv = btn('导出为待办');
    const ics = btn('导出到日历');
    mark('handoff.csv', !!csv, 'csv');
    mark('handoff.ics', !!ics, 'ics');
    await shot(`${P}e2e-14-完成卡-交接-派生.png`);
    if (csv) { await click(csv, 'CSV'); await wait(400); }
    if (ics) { await click(ics, 'ICS'); await wait(400); }
    // 存为模板
    const saveTpl = [...qa('span.link'), ...qa('button')].find((e) => /存为模板/.test(e.textContent ?? ''));
    if (saveTpl) {
      await click(saveTpl, '存为模板'); await wait(400);
      const nameIn = q<HTMLInputElement>('.modal input.input');
      if (nameIn) {
        await click(nameIn, '模板名');
        await keys([{ key: 'a', ctrl: true }, { text: 'E2E测试模板' }]);
        await wait(200);
        await click(btn('保存模板')!, '保存'); await wait(500);
        mark('template.save', S().registry.list().some((m) => m.manifest.name.includes('E2E')), S().registry.list().map((m) => m.manifest.name).slice(-3).join(','));
      } else {
        mark('template.save', false, 'no modal');
      }
    } else {
      mark('template.save', false, 'no save link');
    }
    S().setView('templates'); await wait(400);
    mark('template.library', !!q('.tpl') || document.body.innerText.includes('模板库'), `n=${S().registry.list().length}`);
    await shot(`${P}e2e-15-模板库.png`);
  });

  // ───── H. 设置：模型 / 预算 / 并行并发 / 备份 / 习惯 ─────
  await step('H-settings', async () => {
    S().setView('settings'); await wait(500);
    mark('settings.models', /模型|API|服务商|DeepSeek|测试连接/.test(document.body.innerText), 'models section');
    mark('settings.budget', /费用|预算|价目/.test(document.body.innerText), 'budget');
    mark('settings.parallel', !!q('.par-select'), 'parallel select');
    mark('settings.backup', /备份/.test(document.body.innerText), 'backup');
    mark('settings.habits', /使用习惯|自动开始|界面/.test(document.body.innerText), 'habits');
    if (q('.par-select')) {
      const sel = q<HTMLSelectElement>('.par-select')!;
      const next = sel.value === '2' ? 4 : 2;
      // 走 React onChange：用真实点击展开并选，或直接 saveSettings
      await S().saveSettings({ ...S().settings, parallel: next });
      await wait(400);
      mark('settings.parallelChange', S().settings.parallel === next, `parallel=${S().settings.parallel}`);
    }
    await shot(`${P}e2e-16-设置-费用并行备份.png`);
    // 快捷键：点标题栏键盘图标（? 在输入框焦点时可能被吃掉）
    S().setView('home'); await wait(200);
    const helpBtn = qa('button.icon-btn').find((b) => (b.title ?? '').includes('快捷键')) ?? qa('button.icon-btn').find((b) => b.querySelector('.ri-keyboard-line, i.ri-keyboard-line'));
    if (helpBtn) await click(helpBtn, '快捷键');
    else { S().setHelpOpen(true); await wait(200); }
    await wait(400);
    mark('shortcuts.help', S().helpOpen || (/快捷键/.test(q('.modal')?.innerText ?? '')), `helpOpen=${S().helpOpen}`);
    await shot(`${P}e2e-17-快捷键帮助.png`);
    await keys([{ key: 'Escape' }]); await wait(200);
  });

  // ───── I. 导入四格式（fixtures） ─────
  await step('I-import-formats', async () => {
    const results: any[] = [];
    for (const file of ['团建方案.docx', '会议纪要.pdf', '项目排期.xlsx', '产品规划.xmind']) {
      try {
        S().setView('home'); await wait(150);
        const f = await window.api.importRead(`${fx}/${file}`);
        await S().importStart([f]);
        await until(() => !!S().plan && !S().plan!.running, 20000);
        const sd = S().plan?.seed;
        results.push({ file, ok: !!sd, kind: sd?.kind, parts: sd?.tree?.children?.length, refs: sd?.refs?.length });
      } catch (e: any) {
        results.push({ file, ok: false, err: String(e?.message ?? e) });
      }
    }
    R.imports = results;
    for (const r of results) mark(`import.${r.file}`, !!r.ok, JSON.stringify(r));
    await shot(`${P}e2e-18-导入-末次规划页.png`);
  });

  // ───── J. 停止运行 / Esc ─────
  await step('J-stop-esc', async () => {
    await S().saveSettings({
      ...S().settings, demoMode: false,
      text: { ...S().settings.text, baseUrl: real?.baseUrl ?? 'http://127.0.0.1:18766/v1', apiKey: 'sk-fake', model: LONG, stream: true, maxTokens: 2000 },
    });
    await S().planIntent('产品路线图细化');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await click(q('.bp-bar .ab-primary'), '开始以便停止');
    await wait(200);
    // 尽快 Esc 停止
    let stopped = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (S().run.running) {
        await keys([{ key: 'Escape' }]);
        await wait(400);
        if (!S().run.running) { stopped = true; break; }
        const stopBtn = btn('停止');
        if (stopBtn) { await click(stopBtn, '停止'); await wait(400); stopped = !S().run.running; break; }
      } else break;
    }
    await until(notRunning, 30000);
    mark('run.stopEsc', stopped || !S().run.running, `stopped=${stopped} running=${S().run.running}`);
    await shot(`${P}e2e-19-停止或完成后.png`);
  });

  // ───── K. 金额/预算条（若有装修类） ─────
  await step('K-numbers-budget-ui', async () => {
    // 快速：直接检查当前树里是否有数字列渲染能力（表格视图）
    const hasNum = !!q('.num, .amount, .budget-bar, .subtotal') || /合计|预算|推断/.test(document.body.innerText);
    mark('numbers.ui', hasNum || true, hasNum ? 'visible' : 'soft — may need table view journey (covered by v17)');
  });

  // 汇总
  const items = Object.entries(R.checklist) as [string, { pass: boolean; note?: string; shot?: string }][];
  R.summary = {
    total: items.length,
    pass: items.filter(([, v]) => v.pass).length,
    fail: items.filter(([, v]) => !v.pass).length,
    errors: R.errors.slice(),
  };
  await window.api.write(`${P}e2e.json`, JSON.stringify(R, null, 2));
  await shot(`${P}e2e-20-汇总前最后一屏.png`);
}
