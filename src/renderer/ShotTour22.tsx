import type { Store } from './store';
import { DEFAULT_SETTINGS } from './settings';

export const R22: Record<string, any> = { errors: [] };

/** v2.2：多视角预写作 + 偏好作用域/导入导出 */
export async function v22Tour(h: { S: () => Store; wait: (ms: number) => Promise<unknown>; shot: (name: string, keep?: boolean) => Promise<void>; until: (fn: () => boolean, ms?: number) => Promise<void>; P: string }) {
  const { S, wait, shot, until, P } = h;
  const R = R22;
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
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { R.errors.push(`${name}: ${String(e?.message ?? e)}`); } };
  const real = S().info?.real;
  const LONG = 'fake-pro-2026-10-preview-long-model-name';

  await S().saveSettings({ ...DEFAULT_SETTINGS, demoMode: false, theme: 'dark', expert: false, demoNoticeSeen: true, confirmEach: false, survey: true,
    text: { baseUrl: real?.baseUrl ?? 'http://127.0.0.1:18766/v1', apiKey: 'sk-fake', model: LONG, stream: false, maxTokens: 2000 } });
  await wait(300);

  await step('多视角预写作', async () => {
    const surveySeen: string[] = [];
    const t0 = Date.now();
    await S().planIntent('产品发布执行计划');
    await until(() => !!S().plan && !S().plan!.running && !!q('.bp-bar .ab-primary:not([disabled])'), 30000);
    await click(q('.bp-bar .ab-primary'), '开始第 1 步');
    while (S().run.running && Date.now() - t0 < 180000) {
      const log = S().run.log.find((e) => e.stepId === 'survey' || e.roleName?.includes('多视角'));
      if (log?.summary && !surveySeen.includes(log.summary)) surveySeen.push(log.summary);
      if (log && qa('.survey-card').length === 0 && S().run.running) { /* mid */ }
      await wait(150);
    }
    await until(notRunning, 180000); await wait(700);
    if (q('.coach')) { const b = btn('知道了', q('.coach')!) ?? btn('不再提示', q('.coach')!); if (b) await click(b, '关引导'); }
    R.survey = { saved: art().survey?.perspectives?.map((p) => p.name), card: q('.survey-card')?.innerText?.slice(0, 240), log: surveySeen, logHas: S().run.log.some((e) => e.stepId === 'survey' || e.roleName?.includes('多视角')) };
    if (!art().survey?.perspectives?.length && !q('.survey-card')) throw new Error('作品上没有多视角备忘且没有备忘卡');
    q('.survey-card')?.scrollIntoView({ block: 'center' }); await wait(200);
    await shot(`${P}95-多视角备忘-铺整体后.png`);
  });

  await step('偏好作用域', async () => {
    if (!art().prefs?.length) {
      S().addUserPref('不要虚构没有来源的数字');
      await wait(200);
    }
    await click(btn('资料')!, '资料'); await wait(400);
    q('.prefs')?.scrollIntoView({ block: 'center' }); await wait(200);
    R.prefs = { panel: q('.prefs')?.innerText?.slice(0, 200), n: art().prefs?.length };
    await shot(`${P}96-偏好-本作品-导出导入.png`);
    const promo = btn('用于所有作品', q('.prefs')!);
    if (promo) { await click(promo, '用于所有作品'); await wait(400); }
    R.prefs.after = { global: S().settings.globalPrefs?.map((p) => p.text), text: q('.prefs')?.innerText?.slice(0, 200) };
    if (!S().settings.globalPrefs?.length) throw new Error('没有提升为全局偏好');
    await shot(`${P}97-偏好-用于所有作品.png`);
    const json = S().exportPrefsJson();
    R.prefs.json = json.slice(0, 240);
    expectPrefJson(json);
  });

  await window.api.write(`${P}v22.json`, JSON.stringify(R, null, 2));
}
function expectPrefJson(json: string) {
  const o = JSON.parse(json);
  if (!Array.isArray(o.prefs) || !o.prefs.length) throw new Error('导出 JSON 无偏好');
}
