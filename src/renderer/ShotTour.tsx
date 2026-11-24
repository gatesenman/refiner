import { v17Tour, R17 } from './ShotTour17';
import { v18Tour, R18 } from './ShotTour18';
import { e2eTour, RE2E } from './ShotTourE2E';
import { v21Tour, R21 } from './ShotTour21';
import { v22Tour, R22 } from './ShotTour22';
import { v23Tour, R23 } from './ShotTour23';
import { useEffect, useRef } from 'react';
import { useStore, type Store } from './store';
import { DEFAULT_SETTINGS } from './settings';
import { v16Tour, R16 } from './ShotTour16';

/** 截图模式（仅当主进程设置 REFINER_SHOT_DIR 时启用）：自动演示并截图。REFINER_TOUR=errors 走错误场景（本地坏模型服务） */
export function ShotTour() {
  const s = useStore();
  const ref = useRef<Store>(s);
  ref.current = s;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const S = () => ref.current;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const shot = async (name: string, keepToasts = false) => {
      await wait(700);
      const t = document.querySelector<HTMLElement>('.toasts');
      if (t && !keepToasts) t.style.visibility = 'hidden';
      await wait(60);
      await window.api.capture(name);
      if (t) t.style.visibility = '';
    };
    const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
    const click = async (text: string) => { const b = btn(text); b?.click(); await wait(250); return !!b; };
    const typeInto = (el: HTMLTextAreaElement | HTMLInputElement | null, text: string) => {
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const until = async (fn: () => boolean, ms = 15000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await wait(100); };
    const setExpert = async (on: boolean) => { await S().saveSettings({ ...S().settings, expert: on }); await wait(200); };
    (async () => {
      const real = S().info?.real;
      const tour = S().info?.tour;
      const P = `${innerWidth}x${innerHeight}-`;
      if (tour === 'errors' && real) {
        // 错误场景回归：垃圾输出 / 401 / 网络不通 / 能连通但不能结构化 / 规划回退
        const base = real.baseUrl.replace(/\/(junk|auth|ok|slow)\/v1$/, '');
        const cfg = (path: string, key = 'sk-test') => ({ ...DEFAULT_SETTINGS, demoMode: false, theme: 'dark' as const, text: { baseUrl: `${base}/${path}/v1`, apiKey: key, model: 'fake-model', stream: false } });
        await S().saveSettings(cfg('junk'));
        S().newProject('错误场景验证');
        await wait(300);
        const r = S().createArtifact('outline', '面向新员工的信息安全培训', { title: '信息安全培训（坏模型）', projectId: S().projects[0]?.id })!;
        await wait(200);
        await S().runOp({ op: 'generate', stageIndex: 0, pid: r.pid, aid: r.aid, targetId: null });
        await wait(300);
        await click('查看原始回复');
        await shot('21-垃圾输出-运行失败-红色恢复条.png');
        await S().planIntent('策划一次部门年会');
        await wait(400);
        await shot('25-规划回退-黄色提示条.png');
        const testWith = async (c: ReturnType<typeof cfg>, name: string) => {
          S().setView('home'); await wait(150);
          await S().saveSettings(c); await wait(150);
          S().setView('settings'); await wait(300);
          await click('测试连接');
          await until(() => !!document.querySelector('.test-res'));
          await click('详情');
          await shot(name);
        };
        await testWith(cfg('auth', 'sk-bad'), '22-测试连接-401-人话提示.png');
        await testWith({ ...cfg('x'), text: { ...cfg('x').text, baseUrl: 'http://127.0.0.1:9/v1' } }, '23-测试连接-网络不通.png');
        await testWith({ ...cfg('x', ''), text: { ...cfg('x', '').text, baseUrl: 'https://api.deepseek.com/v1', apiKey: '' } }, '23b-测试连接-未填Key本地拦截.png');
        await testWith({ ...cfg('junk'), demoMode: true }, '24-测试连接-勉强可用-切换提示.png');
        await testWith({ ...cfg('ok'), demoMode: true }, '24b-测试连接-可用-切换到真实模型.png');
        window.api.quit();
        return;
      }
      if (tour === 'v23') { try { await v23Tour({ S, wait, shot, until, P }); } catch (e) { R23.errors.push(String((e as any)?.stack ?? e)); await window.api.write(`${P}v23.json`, JSON.stringify(R23, null, 2)); } window.api.quit(); return; }
      if (tour === 'v22') { try { await v22Tour({ S, wait, shot, until, P }); } catch (e) { R22.errors.push(String((e as any)?.stack ?? e)); await window.api.write(`${P}v22.json`, JSON.stringify(R22, null, 2)); } window.api.quit(); return; }
      if (tour === 'v21') { try { await v21Tour({ S, wait, shot, until, P }); } catch (e) { R21.errors.push(String((e as any)?.stack ?? e)); await window.api.write(`${P}v21.json`, JSON.stringify(R21, null, 2)); } window.api.quit(); return; }
      if (tour === 'e2e') { try { await e2eTour({ S, wait, shot, until, P }); } catch (e) { RE2E.errors.push(String((e as any)?.stack ?? e)); await window.api.write(`${P}e2e.json`, JSON.stringify(RE2E, null, 2)); } window.api.quit(); return; }
      if (tour === 'v18') { try { await v18Tour({ S, wait, shot, until, P }); } catch (e) { R18.errors.push(String((e as any)?.stack ?? e)); await window.api.write(`${P}v18.json`, JSON.stringify(R18, null, 2)); } window.api.quit(); return; }
      if (tour === 'v17') { try { await v17Tour({ S, wait, shot, until, P }); } catch (e) { R17.errors.push(String((e as any)?.stack ?? e)); await window.api.write(`${P}v17.json`, JSON.stringify(R17, null, 2)); } window.api.quit(); return; }
      if (tour === 'v16') { try { await v16Tour({ S, wait, shot, until, P }); } catch (e) { await window.api.write(`${P}v16-error.txt`, String((e as any)?.stack ?? e)); await window.api.write(`${P}v16.json`, JSON.stringify(R16, null, 2)); } window.api.quit(); return; }
      if (real) {
        await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: false, theme: 'dark', text: { baseUrl: real.baseUrl, apiKey: '', model: real.model, stream: true, maxTokens: 1500 } });
        S().newProject('真实模型验证');
        await wait(400);
        await S().planIntent('设计一个微信小程序的数据库');
        await wait(600);
        await shot('26-真实模型-确认流程-小程序数据库.png');
        const tb = S().startFromBlueprint({ projectId: S().projects[0]?.id, autoRun: false })!;
        await wait(300);
        await S().runOp({ op: 'generate', stageIndex: 0, pid: tb.pid, aid: tb.aid, targetId: null });
        await wait(600);
        await shot('27-真实模型-第一步结果.png');
        window.api.quit();
        return;
      }
      if (tour === 'reopen') {
        await wait(1200);
        await shot(`${P}18-重开应用-直接回到上次作品.png`, true);
        await window.api.write(`${P}reopen.json`, JSON.stringify({ view: S().view, title: S().currentArtifact?.title ?? null, toast: S().toasts.map((t) => t.text) }, null, 2));
        window.api.quit();
        return;
      }
      try {
        await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: true, theme: 'dark', expert: false });
        await wait(400);
        // ───── 验收：真实鼠标点击（经 Chromium 输入管线），逐屏测量 ─────
        let clicks = 0;
        const acc: any[] = [];
        const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden'; };
        const real = async (el: Element | null | undefined, label: string) => {
          if (!el) throw new Error('找不到可点击的元素：' + label);
          el.scrollIntoView({ block: 'nearest' });
          await wait(80);
          const r = el.getBoundingClientRect();
          await window.api.click(r.left + r.width / 2, r.top + r.height / 2);
          clicks++;
          acc.push({ click: clicks, label });
          await wait(350);
        };
        const overflow = () => Object.fromEntries(['.titlebar', '.toolbar', '.stepbar', '.actionbar', '.sidebar'].map((q) => { const e = document.querySelector<HTMLElement>(q); return [q, e ? e.scrollWidth - e.clientWidth : null]; }));
        const overlaps = () => {
          const out: string[] = [];
          for (const q of ['.toolbar', '.actionbar', '.titlebar']) {
            const kids = [...(document.querySelector(q)?.children ?? [])].filter((k) => vis(k) && !k.classList.contains('spacer')).map((k) => ({ k, r: k.getBoundingClientRect() }));
            for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
              const A = kids[i].r, B = kids[j].r;
              if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) out.push(`${q}: ${(kids[i].k as HTMLElement).className || kids[i].k.tagName} × ${(kids[j].k as HTMLElement).className || kids[j].k.tagName}`);
            }
          }
          return out;
        };
        const measure = (state: string) => {
          const prim = [...document.querySelectorAll('.btn.primary')].filter(vis);
          const r = prim[0]?.getBoundingClientRect();
          const text = document.body.innerText;
          const stepMentions = document.querySelectorAll('.sb-step.on').length + (text.match(/当前步骤|第 \d+\/\d+ 步 ·/g)?.length ?? 0) + document.querySelectorAll('.toolbar .badge').length;
          const canvas = document.querySelector('.canvas')?.getBoundingClientRect();
          const firstChg = document.querySelector('.canvas .chg')?.getBoundingClientRect();
          const m = {
            state, clicksSoFar: clicks, win: `${innerWidth}×${innerHeight}`,
            bluePrimaries: prim.length, primaryLabels: prim.map((p) => (p as HTMLElement).innerText.trim()),
            primaryRect: r ? { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width) } : null,
            stepIndicators: stepMentions,
            bar: document.querySelector('.actionbar .ab-t, .actionbar .ab-run b')?.textContent?.trim() ?? null,
            firstChangeVisible: firstChg && canvas ? firstChg.top >= canvas.top && firstChg.bottom <= canvas.bottom : null,
            overflowPx: overflow(), overlaps: overlaps(),
          };
          acc.push(m);
          return m;
        };
        const until2 = async (fn: () => boolean, ms = 20000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await wait(80); };
        const notRunning = () => !S().run.running;
        const primary = () => [...document.querySelectorAll('.btn.primary')].filter(vis)[0] as HTMLElement | undefined;

        measure('首页');
        await shot(`${P}01-首页.png`);
        // 澄清：含糊意图 → 选项必须真的能点、真的记录答案
        const ta = document.querySelector<HTMLTextAreaElement>('.intent-box textarea');
        ta?.focus();
        typeInto(ta, '帮我弄一下');
        await wait(120);
        const c0 = clicks;
        await real(primary(), '首页：开始（含糊意图）');
        await until(() => !!document.querySelector('.opt-btn'));
        await real(document.querySelectorAll('.clar-q')[0]?.querySelectorAll('.opt-btn')[0], '澄清：选“活动或计划”');
        await real(document.querySelectorAll('.clar-q')[1]?.querySelectorAll('.opt-btn')[1], '澄清：选“团队”');
        await real(document.querySelectorAll('.clar-q')[2]?.querySelectorAll('.opt-btn')[1], '澄清：选“可执行清单”');
        const clarM = { ...measure('澄清'), selected: [...document.querySelectorAll('.opt-btn.on')].map((e) => (e as HTMLElement).innerText.trim()), preview: document.querySelector('.clar-preview b')?.textContent, startButtonHidden: !document.querySelector('.intent-box') };
        acc.push({ clarify: clarM });
        await shot(`${P}02-澄清-选项可点并已记录.png`);
        await real(primary(), '澄清：继续');
        await until(() => !!S().plan && !S().plan!.running);
        acc.push({ clarifyPlannedIntent: S().plan?.intent });
        clicks = c0; // 澄清是可选分支，不计入主流程点击数

        // 主流程：首页 → 完成
        S().setView('home');
        await wait(300);
        await real([...document.querySelectorAll('.ex-chip')].find((e) => e.textContent?.includes('三天的团队建设')), '首页：点示例“策划一场三天的团队建设”');
        await until(() => !!S().plan && !S().plan!.running && !!document.querySelector('.bp-bar .ab-primary:not([disabled])'));
        await wait(300);
        measure('确认步骤');
        await shot(`${P}03-确认步骤.png`);
        await real(document.querySelector('.bp-bar .ab-primary'), '确认步骤：开始第 1 步');
        await wait(150);
        measure('运行中');
        await shot(`${P}04-运行中-操作栏进度与停止.png`);
        await until2(notRunning); await wait(500);
        measure('第 1 步完成（审阅）');
        await shot(`${P}05-第1步完成-全部保留进入下一步.png`);
        await real(primary(), '审阅：全部保留，进入下一步（v1.6：停在准备态，不自动运行）');
        await wait(400);
        acc.push({ noAutoRun: !S().run.running, bar: document.querySelector('.actionbar .ab-t')?.textContent });
        await real(primary(), '开始第 2 步（范围：全部）');
        await until2(() => S().run.running, 3000); await until2(notRunning); await wait(600);
        measure('第 2 步完成（审阅，带改动高亮）');
        await shot(`${P}06-审阅改动-自动定位到第一处.png`);
        await real(primary(), '审阅：全部保留，进入下一步：细节安排');
        await wait(400);
        measure('第 3 步（需先点选）');
        await shot(`${P}07-工作屏-需要点选.png`);
        const node = [...document.querySelectorAll<HTMLElement>('.onode.d1')][2];
        await real(node, '点选“第 2 天”');
        measure('第 3 步：已选中（检查器浮出）');
        await shot(`${P}08-选中即范围-检查器浮出.png`);
        await real(primary(), '运行：补充细节「第 2 天」');
        await until2(() => S().run.running, 3000); await until2(notRunning); await wait(500);
        measure('第 3 步完成（审阅）');
        await real(primary(), '审阅：全部保留，进入下一步：执行清单');
        await wait(400);
        const sel0 = S().selectedId;
        measure('第 4 步（选中已清除）');
        acc.push({ selectionClearedOnStepChange: sel0 === undefined });
        await real(primary(), '完成');
        await wait(400);
        measure('完成卡');
        await shot(`${P}09-完成卡.png`);
        const toFinish = clicks;
        acc.push({ clicksHomeToFinishCard: toFinish, plusExportWord: toFinish + 1, note: '第 4 步“精修”需先点选一项，此路径选择直接完成；若再精修一项需 +3 次（点选/运行/保留）' });
        // 专家模式：同一个底部操作栏
        await real(document.querySelector('.fc-next .link'), '完成卡：继续修改');
        await setExpert(true);
        await wait(300);
        measure('专家模式');
        await shot(`${P}10-专家模式-同一操作栏.png`);
        await setExpert(false);
        // 视图下拉
        acc.push({ viewSelect: [...document.querySelectorAll('.view-sel option')].map((o) => o.textContent) });
        await window.api.write(`${P}acceptance.json`, JSON.stringify(acc, null, 2));
      } catch (e) {
        console.error('截图流程失败', e);
        await window.api.write(`${P}acceptance-error.txt`, String((e as any)?.stack ?? e));
      }
      await wait(300);
      window.api.quit();
    })();
  }, []);
  return null;
}
