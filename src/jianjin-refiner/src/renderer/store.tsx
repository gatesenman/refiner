import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  TypeRegistry, createArtifact as coreCreate, runStage, runFork, commitVersion, commitManual, rollback as coreRollback, uid, parseManifest,
  unpin as coreUnpin, DEFAULT_PERSONAS, planProcess, listRenderers, blueprintToTemplate, dumpManifest,
  RunFailedError, runStageMulti, fillNumbers, extractOpenQuestions, toOutlineText, splitDetail, markReviewed, undo as coreUndo, redo as coreRedo, revertChange as coreRevert, keepChange as coreKeep, pendingReview,
  headChanges, findNode, changeReasons, prefFromRevert, prefFromUndoAll, addPref,
} from '../core';
import type { AgentLogEntry, Artifact, ArtNode, OpKind, TypeManifest, RunResult, PlanResult, Fact } from '../core';
import { changeStage, keepAndAdvance, skipStage, stepInfo, runEstimate, budgetBlock, priceTable, deriveAsks } from './flow';
import { effectiveFreedom, costOf, addUsage, refContext, pickStartStage, type ImportResult, type RefItem } from '../core';
import { buildProviders, createMeter, DEFAULT_SETTINGS, mergeSettings, type Settings } from './settings';

const builtinFiles = import.meta.glob('../../plugins/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Project { id: string; name: string; artifacts: Artifact[]; createdAt: number; updatedAt: number }
export type View = 'home' | 'artifact' | 'designer' | 'settings' | 'blueprint' | 'templates';
/** 流程规划会话：意图 → 规划师派生蓝图 → 用户编辑 → 开始 */
export interface PlanState { intent: string; templateId?: string; title?: string; running: boolean; log: AgentLogEntry[]; live: Record<string, string>; result?: PlanResult; draft?: TypeManifest; error?: string;
  /** 从已有材料开始：导入的结构 / 参考资料 */
  seed?: { name: string; kind: 'structure' | 'content'; tree?: ArtNode; refs: RefItem[]; useAsDraft: boolean; notes?: string[]; questions?: number };
  /** 澄清答案（不进标题，作为固定事实挂到作品上） */
  facts?: Fact[];
  /** 以另一个作品为基础新建 */
  source?: Artifact['source'] }
export interface TextSel { from: number; to: number; text: string }
export interface RunFailure { message: string; detail?: string; raw?: string; kind: 'junk' | 'empty' | 'error' }
export interface RunState { multi?: { i: number; n: number; title: string; done?: number; active?: string[]; par?: number }; running: boolean; artifactId?: string; log: AgentLogEntry[]; live: Record<string, string>; error?: string; warnings?: string[]; failure?: RunFailure; startedAt?: number; total?: number; lastOp?: { op: OpKind; instruction?: string; stageIndex?: number; targetIds?: string[] } }
export interface DialogSpec { title: string; body?: ReactNode; ok?: string; cancel?: string | null; danger?: boolean; resolve: (ok: boolean) => void }
export interface Toast { id: string; kind: 'info' | 'error' | 'success'; text: string; action?: { label: string; fn: () => void } }

function useStoreImpl() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [regVersion, setRegVersion] = useState(0);
  const registryRef = useRef<TypeRegistry>(new TypeRegistry());
  const [view, setView] = useState<View>('home');
  const [current, setCurrent] = useState<{ projectId: string; artifactId: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  /** v1.8 多选：Ctrl/Cmd+单击加入或移出；普通单击清空 */
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const toggleMulti = useCallback((id: string) => {
    setMultiSel((cur) => {
      const base = cur.length ? cur : (selectedIdRef.current ? [selectedIdRef.current] : []);
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
    setSelectedId(id);
  }, []);
  const clearMulti = useCallback(() => setMultiSel([]), []);
  useEffect(() => { setMultiSel([]); }, [current?.artifactId]); // eslint-disable-line
  const selectedIdRef = useRef<string | undefined>();
  selectedIdRef.current = selectedId;
  const [textSel, setTextSel] = useState<TextSel | undefined>();
  const [rendererBy, setRendererBy] = useState<Record<string, string>>({});
  const [disabledSteps, setDisabledSteps] = useState<Record<string, string[]>>({});
  const [run, setRun] = useState<RunState>({ running: false, log: [], live: {} });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [newDialog, setNewDialog] = useState<{ typeId: string; seed?: string } | null>(null);
  const [designerSel, setDesignerSel] = useState<string | undefined>();
  /** 多人设交叉设计开关（仅对“生成”生效） */
  const [crossDesign, setCrossDesign] = useState(false);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const planAbort = useRef<AbortController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const dirty = useRef(new Set<string>());
  const [info, setInfo] = useState<{ userData: string; version: string; shot: boolean; tour?: string; fixtures?: string; real?: { baseUrl: string; model: string } | null } | null>(null);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms?: number) => {
    const id = uid('t');
    const act = action ? { ...action, fn: () => { action.fn(); setToasts((t) => t.filter((x) => x.id !== id)); } } : undefined;
    setToasts((t) => [...t, { id, kind, text, action: act }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms ?? (action ? 10000 : kind === 'error' ? 6000 : 3200));
  }, []);
  const toastRef = useRef(toast);
  /** 应用内对话框（替代原生 confirm，中文按钮） */
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const confirmDialog = useCallback((d: Omit<DialogSpec, 'resolve'>) => new Promise<boolean>((resolve) => setDialog({ ...d, resolve: (ok) => { setDialog(null); resolve(ok); } })), []);
  const [saveTpl, setSaveTpl] = useState<{ m: TypeManifest; name: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
  const redoStack = useRef<Record<string, string[]>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const loadRegistry = useCallback(async () => {
    const reg = new TypeRegistry();
    const builtin = Object.entries(builtinFiles).sort(([a], [b]) => a.localeCompare(b)).map(([file, text]) => ({ file: file.split('/').pop()!, text, source: 'builtin' as const }));
    reg.loadAll(builtin);
    try {
      const user = (await window.api.listPlugins()) as { file: string; text: string }[];
      reg.loadAll(user.map((u) => ({ ...u, source: 'user' as const })));
    } catch (e) { console.warn(e); }
    registryRef.current = reg;
    setRegVersion((v) => v + 1);
    return reg;
  }, []);

  // 初始化
  useEffect(() => {
    (async () => {
      const [s, ps, inf] = await Promise.all([window.api.getSettings(), window.api.loadProjects(), window.api.info()]);
      setInfo(inf);
      setSettingsState(mergeSettings(s));
      await loadRegistry();
      const list = (ps as Project[]).sort((a, b) => b.updatedAt - a.updatedAt);
      setProjects(list);
      // 重开应用：直接打开上次的作品
      const last = list.flatMap((p) => p.artifacts.map((a) => ({ p, a }))).sort((x, y) => y.a.updatedAt - x.a.updatedAt)[0];
      if (last && (!inf?.shot || inf?.tour === 'reopen')) {
        setCurrent({ projectId: last.p.id, artifactId: last.a.id });
        setView('artifact');
        setTimeout(() => toastRef.current?.(`已为你打开上次的「${last.a.title}」`, 'info', { label: '回到首页', fn: () => setView('home') }, 6000), 400);
      }
      setReady(true);
    })();
  }, [loadRegistry]);

  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);

  // 自动保存（防抖）
  useEffect(() => {
    if (!ready || !dirty.current.size) return;
    const t = setTimeout(async () => {
      const ids = [...dirty.current];
      dirty.current.clear();
      for (const id of ids) {
        const p = projectsRef.current.find((x) => x.id === id);
        if (p) await window.api.saveProject(p);
      }
      setSavedAt(Date.now());
    }, 400);
    return () => clearTimeout(t);
  }, [projects, ready]);

  const saveSettings = useCallback(async (s: Settings) => {
    setSettingsState(s);
    await window.api.setSettings(s);
  }, []);

  const mutateProject = useCallback((pid: string, fn: (p: Project) => Project) => {
    dirty.current.add(pid);
    setProjects((ps) => ps.map((p) => (p.id === pid ? { ...fn(p), updatedAt: Date.now() } : p)));
  }, []);

  const updateArtifact = useCallback((pid: string, aid: string, fn: (a: Artifact) => Artifact) => {
    mutateProject(pid, (p) => ({ ...p, artifacts: p.artifacts.map((a) => (a.id === aid ? fn(a) : a)) }));
  }, [mutateProject]);

  const newProject = useCallback((name = '新项目') => {
    const p: Project = { id: uid('p'), name, artifacts: [], createdAt: Date.now(), updatedAt: Date.now() };
    dirty.current.add(p.id);
    projectsRef.current = [p, ...projectsRef.current]; // 同步更新，避免同一轮内重复创建
    setProjects((ps) => [p, ...ps]);
    return p;
  }, []);
  /** 默认项目：优先用调用方指定的；否则复用第一个项目 / 同名项目；都没有才新建（三个入口统一） */
  const ensureDefaultProject = useCallback((preferred?: string): string => {
    const list = projectsRef.current;
    if (preferred && list.find((p) => p.id === preferred)) return preferred;
    return (list.find((p) => p.name === '我的项目') ?? list[0])?.id ?? newProject('我的项目').id;
  }, [newProject]);
  const duplicateProjects = useCallback(() => {
    // 修复旧版本可能留下的重复空“我的项目”
    const list = projectsRef.current;
    const empties = list.filter((p) => p.name === '我的项目' && !p.artifacts.length);
    if (list.filter((p) => p.name === '我的项目').length > 1 && empties.length) {
      const drop = new Set(empties.slice(list.some((p) => p.name === '我的项目' && p.artifacts.length) ? 0 : 1).map((p) => p.id));
      drop.forEach((id) => window.api.deleteProject(id));
      setProjects((ps) => ps.filter((p) => !drop.has(p.id)));
    }
  }, []);

  const renameProject = useCallback((pid: string, name: string) => mutateProject(pid, (p) => ({ ...p, name })), [mutateProject]);

  const deleteProject = useCallback(async (pid: string) => {
    const snap = projectsRef.current.find((p) => p.id === pid);
    setProjects((ps) => ps.filter((p) => p.id !== pid));
    await window.api.deleteProject(pid);
    setCurrent((c) => (c?.projectId === pid ? null : c));
    setView((v) => (v === 'artifact' ? 'home' : v));
    if (snap) toast(`已删除项目「${snap.name}」`, 'info', { label: '撤销', fn: () => { dirty.current.add(snap.id); setProjects((ps) => [snap, ...ps.filter((p) => p.id !== snap.id)]); } });
  }, [toast]);

  const currentProject = projects.find((p) => p.id === current?.projectId);
  const currentArtifact = currentProject?.artifacts.find((a) => a.id === current?.artifactId);
  const manifestOf = useCallback((typeId?: string): TypeManifest | undefined => (typeId ? registryRef.current.get(typeId) : undefined), [regVersion]); // eslint-disable-line
  /** 制品的流程：自带蓝图优先，否则取模板注册表 */
  const manifestFor = useCallback((a?: Artifact): TypeManifest | undefined => (a ? a.blueprint ?? registryRef.current.get(a.typeId) : undefined), [regVersion]); // eslint-disable-line
  const currentManifest = manifestFor(currentArtifact);

  const openArtifact = useCallback((projectId: string, artifactId: string) => {
    setCurrent({ projectId, artifactId });
    setSelectedId(undefined);
    setTextSel(undefined);
    setView('artifact');
    setRun((r) => (r.running ? r : { running: false, log: [], live: {} }));
  }, []);

  const deleteArtifact = useCallback((pid: string, aid: string) => {
    const snap = projectsRef.current.find((p) => p.id === pid)?.artifacts.find((a) => a.id === aid);
    mutateProject(pid, (p) => ({ ...p, artifacts: p.artifacts.filter((a) => a.id !== aid) }));
    setCurrent((c) => (c?.artifactId === aid ? null : c));
    setView((v) => (v === 'artifact' ? 'home' : v));
    if (snap) toast(`已删除「${snap.title}」`, 'info', { label: '撤销', fn: () => mutateProject(pid, (p) => ({ ...p, artifacts: [...p.artifacts.filter((a) => a.id !== aid), snap] })) });
  }, [mutateProject, toast]);

  const runOp = useCallback(async (opts: { op: OpKind; instruction?: string; stageIndex?: number; pid?: string; aid?: string; targetId?: string | null; targetIds?: string[] }) => {
    const pid = opts.pid ?? current?.projectId;
    const aid = opts.aid ?? current?.artifactId;
    const proj = projectsRef.current.find((p) => p.id === pid);
    const art = proj?.artifacts.find((a) => a.id === aid);
    if (!proj || !art) return;
    const manifest = art.blueprint ?? registryRef.current.get(art.typeId);
    if (!manifest) { toast(`模板「${art.typeId}」不存在（可能已被删除）`, 'error'); return; }
    const stageIndex = opts.stageIndex ?? art.stageIndex;
    // 预算：超出上限时直接拦下，说明原因
    const multi = opts.targetIds?.length ? opts.targetIds : null;
    const est0 = runEstimate(art, manifest, stageIndex, { model: settings.text.model, demo: settings.demoMode, prices: settings.prices, disabled: disabledSteps[`${manifest.id}:${manifest.stages[stageIndex].id}`] });
    const est = multi ? { ...est0, usage: { ...est0.usage, input: est0.usage.input * multi.length, output: est0.usage.output * multi.length }, cost: est0.cost != null ? est0.cost * multi.length : null } : est0;
    const blocked = budgetBlock(art, est, settings.budget);
    if (blocked) {
      confirmDialog({ title: '已超出预算，没有运行', body: blocked, ok: '去设置', cancel: '知道了' }).then((ok) => { if (ok) setView('settings'); });
      return;
    }
    const meter = createMeter();
    const usageNow = () => { const u = meter.total(); return { input: u.input, output: u.output, cost: costOf(u, est.model, priceTable(settings.prices)), estimated: u.estimated, model: est.model }; };
    const chargeWork = (a: Artifact) => { const u = usageNow(); return u.input + u.output ? { ...a, usage: addUsage(a.usage, u, u.cost) } : a; };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const stage0 = manifest.stages[stageIndex];
    const dis0 = disabledSteps[`${manifest.id}:${stage0.id}`] ?? [];
    const total = (stage0.pipeline ?? manifest.pipeline)?.steps.filter((x) => x.enabled !== false && !dis0.includes(x.id)).length;
    setRun({ running: true, artifactId: art.id, log: [], live: {}, startedAt: Date.now(), total: total ? (total + 1) * (multi?.length ?? 1) : undefined, lastOp: { op: opts.op, instruction: opts.instruction, stageIndex, ...(multi ? { targetIds: multi } : {}) }, ...(multi ? { multi: { i: 0, n: multi.length, title: '' } } : {}) });
    try {
      const stage = manifest.stages[stageIndex];
      const personas = opts.op === 'generate' && (stage.fork?.personas?.length || crossDesign) ? (stage.fork?.personas ?? DEFAULT_PERSONAS) : null;
      const req = {
        artifact: art, manifest, stageIndex, op: opts.op,
        targetId: opts.targetId === null ? undefined : (opts.targetId ?? selectedId),
        selection: manifest.output === 'text' ? textSel : undefined,
        instruction: opts.instruction,
        disabledSteps: disabledSteps[`${manifest.id}:${manifest.stages[stageIndex].id}`] ?? [],
        providers: buildProviders(settings, meter),
        references: refContext(art.refs).text,
        signal: ctrl.signal,
        onLog: (e: AgentLogEntry) => setRun((r) => {
          const i = r.log.findIndex((x) => x.id === e.id);
          const log = i >= 0 ? r.log.map((x, j) => (j === i ? e : x)) : [...r.log, e];
          return { ...r, log };
        }),
        onDelta: (stepId: string, d: string) => setRun((r) => ({ ...r, live: { ...r.live, [stepId]: (r.live[stepId] ?? '') + d } })),
      };
      let res: RunResult;
      if (personas) {
        // 多方案：全部作为兄弟分支提交，最高分最后提交 → 成为 head
        const outs = await runFork({ ...req, personas });
        res = outs[0];
        const ordered = [...outs].reverse();
        redoStack.current[art.id] = [];
        updateArtifact(proj.id, art.id, (a) => chargeWork({ ...ordered.reduce((acc, o) => commitVersion(acc, o.version), markReviewed(a)), stageIndex }));
        setRun((r) => ({ ...r, running: false, warnings: res.warnings, log: outs.flatMap((o) => o.log) }));
        setTextSel(undefined);
        toast(`${outs.length} 个人设方案已生成为兄弟分支，当前为最高分「${res.version.fork?.persona}」（可在版本树切换）`, 'success');
        return;
      }
      res = multi
        ? await runStageMulti(req, multi, (i, title, pr) => setRun((r) => ({ ...r, multi: { i, n: multi.length, title, done: pr?.done ?? i, active: pr?.active ?? [title], par: pr?.par ?? 1 } })), { concurrency: settingsRef.current.parallel ?? 3 })
        : await runStage(req);
      redoStack.current[art.id] = [];
      const ver = { ...res.version, usage: usageNow() };
      updateArtifact(proj.id, art.id, (a) => {
        // 步骤间追问：评审发现缺少只有用户知道的事实 → 下一步之前先问
        const asks = manifest.output === 'tree' ? deriveAsks(ver.summary, a.facts ?? []).map((q) => ({ id: uid('ask'), ...q, from: stage.name })) : [];
        return chargeWork({ ...commitVersion(markReviewed(a), ver), stageIndex, ...(asks.length ? { asks } : {}) });
      });
      setRun((r) => ({ ...r, running: false, warnings: res.warnings }));
      setTextSel(undefined);
    } catch (e: any) {
      // 失败/取消也计入已花费的用量
      if (meter.total().input) updateArtifact(proj.id, art.id, chargeWork);
      const log: AgentLogEntry[] | undefined = e?.log;
      if (e instanceof RunFailedError) {
        setRun((r) => ({ ...r, running: false, log: log ?? r.log, failure: { message: e.message, raw: e.raw, kind: e.kind } }));
      } else {
        const { message, detail } = splitDetail(String(e?.message ?? e));
        if (message === '已取消') { setRun((r) => ({ ...r, running: false, log: log ?? r.log })); toast('已停止，内容保持原样', 'info'); }
        else setRun((r) => ({ ...r, running: false, log: log ?? r.log, error: message, failure: { message, detail, kind: 'error' } }));
      }
    } finally {
      abortRef.current = null;
    }
  }, [current, selectedId, textSel, disabledSteps, settings, updateArtifact, toast, crossDesign, confirmDialog]);

  const runOpRef = useRef(runOp);
  runOpRef.current = runOp;
  const cancelRun = useCallback(() => abortRef.current?.abort(), []);

  const createArtifactAction = useCallback((typeId: string, seed: string, opts: { title?: string; projectId?: string; autoRun?: boolean } = {}) => {
    const manifest = registryRef.current.get(typeId);
    if (!manifest) return;
    let pid = opts.projectId;
    if (!pid || !projectsRef.current.find((p) => p.id === pid)) {
      pid = ensureDefaultProject();
    }
    const art = coreCreate(manifest, seed, opts.title);
    dirty.current.add(pid);
    setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, artifacts: [...p.artifacts, art], updatedAt: Date.now() } : p)));
    projectsRef.current = projectsRef.current.map((p) => (p.id === pid ? { ...p, artifacts: [...p.artifacts, art] } : p));
    setCurrent({ projectId: pid, artifactId: art.id });
    setSelectedId(undefined);
    setView('artifact');
    if (opts.autoRun) setTimeout(() => runOp({ op: 'generate', stageIndex: 0, pid, aid: art.id, targetId: null }), 30);
    return { pid, aid: art.id };
  }, [ensureDefaultProject, runOp]);

  const manualEdit = useCallback((root: ArtNode, label?: string) => {
    if (!current) return;
    // 树形类型：手动改过的字段自动固定（图钉标记），成为后续 AI 运行的约束
    updateArtifact(current.projectId, current.artifactId, (a) => commitManual(a, root, label, undefined, { pin: (a.blueprint ?? registryRef.current.get(a.typeId))?.output === 'tree' }));
  }, [current, updateArtifact]);

  const unpinNode = useCallback((id: string) => {
    if (!current) return;
    updateArtifact(current.projectId, current.artifactId, (a) => commitManual(a, coreUnpin(a.root, id), '取消固定', undefined, { pin: false }));
  }, [current, updateArtifact]);

  const setStage = useCallback((i: number) => {
    if (!current) return;
    const art = projectsRef.current.find((p) => p.id === current.projectId)?.artifacts.find((a) => a.id === current.artifactId);
    const m = art && (art.blueprint ?? registryRef.current.get(art.typeId));
    const go = () => { updateArtifact(current.projectId, current.artifactId, (a) => changeStage(a, i).artifact); setSelectedId(undefined); setTextSel(undefined); setRun((r) => (r.running ? r : { running: false, log: [], live: {} })); };
    if (art && m && i < art.stageIndex && art.versions.length > 1) {
      confirmDialog({ title: `回到「${m.stages[i].name}」重新来？`, body: '当前结果会保留在历史里，随时可以回来。', ok: '回到这一步', cancel: '取消' }).then((ok) => ok && go());
      return;
    }
    go();
  }, [current, updateArtifact, confirmDialog]);

  const mutateCurRef = useRef<((fn: (a: Artifact) => Artifact) => void) | null>(null);
  const curArt = () => current && projectsRef.current.find((p) => p.id === current.projectId)?.artifacts.find((a) => a.id === current.artifactId);
  const undoAction = useCallback(() => {
    const a = curArt();
    if (!a || run.running) return false;
    const r = coreUndo(a);
    if (!r.undone) { toast('已经是最早的版本了', 'info'); return false; }
    (redoStack.current[a.id] ??= []).push(r.undone);
    updateArtifact(current!.projectId, a.id, () => r.artifact);
    setSelectedId(undefined);
    const uv = a.versions.find((v) => v.id === r.undone);
    toast(`已撤销：${uv?.label ?? '上一步操作'}`, 'info', { label: '重做', fn: () => redoRef.current?.() });
    return true;
  }, [current, run.running, updateArtifact, toast]); // eslint-disable-line
  const redoAction = useCallback(() => {
    const a = curArt();
    if (!a || run.running) return false;
    const vid = redoStack.current[a.id]?.pop();
    if (!vid) { toast('没有可以重做的操作', 'info'); return false; }
    updateArtifact(current!.projectId, a.id, (x) => coreRedo(x, vid));
    return true;
  }, [current, run.running, updateArtifact, toast]); // eslint-disable-line
  const undoRef = useRef<() => boolean>();
  undoRef.current = undoAction;
  const redoRef = useRef<() => boolean>();
  redoRef.current = redoAction;
  /** 简单模式引导流程：保留并进入下一步（可自动运行）/ 跳过 / 完成 */
  const keepAndNext = useCallback(() => {
    const a = curArt(); if (!a || run.running) return;
    const m = a.blueprint ?? registryRef.current.get(a.typeId); if (!m) return;
    const r = keepAndAdvance(a, m, Date.now(), !!settingsRef.current?.autoRunNext);
    redoStack.current[a.id] = [];
    updateArtifact(current!.projectId, a.id, () => r.artifact);
    setSelectedId(undefined); setTextSel(undefined);
    setRun({ running: false, log: [], live: {} });
    if (r.autoRun && r.nextIndex != null) {
      const op = effectiveFreedom(m.stages, r.nextIndex).ops[0];
      const pid = current!.projectId, aid = a.id, si = r.nextIndex;
      setTimeout(() => runOpRef.current?.({ op, stageIndex: si, pid, aid, targetId: null }), 30);
    }
  }, [current, run.running, updateArtifact]); // eslint-disable-line
  const skipStep = useCallback(() => {
    const a = curArt(); if (!a) return;
    const m = a.blueprint ?? registryRef.current.get(a.typeId); if (!m) return;
    const info = stepInfo(a, m);
    updateArtifact(current!.projectId, a.id, (x) => skipStage(x, m));
    setSelectedId(undefined); setTextSel(undefined);
    setRun({ running: false, log: [], live: {} });
    toast(`已跳过「${info.stage.name}」`, 'info');
  }, [current, updateArtifact, toast]); // eslint-disable-line
  const finishWork = useCallback((on = true) => {
    const a = curArt(); if (!a) return;
    updateArtifact(current!.projectId, a.id, (x) => ({ ...markReviewed(x, pendingReview(x)?.version.id), finishedAt: on ? Date.now() : undefined }));
    setSelectedId(undefined);
  }, [current, updateArtifact]); // eslint-disable-line
  /** 审阅：全部保留 / 全部撤销 / 逐条保留与撤回 */
  const keepAll = useCallback(() => { const a = curArt(); if (a) updateArtifact(current!.projectId, a.id, (x) => markReviewed(x, pendingReview(x)?.version.id)); }, [current, updateArtifact]); // eslint-disable-line
  const undoAll = useCallback(() => {
    const a = curArt(); const p = a && pendingReview(a);
    if (!a || !p) return;
    (redoStack.current[a.id] ??= []).push(a.head);
    const pt = prefFromUndoAll(p.version.label, p.version.instruction);
    updateArtifact(current!.projectId, a.id, (x) => ({ ...coreRollback(x, p.version.parentId!), prefs: addPref(x.prefs, pt, 'undoAll', uid('pf')) }));
    setSelectedId(undefined);
    toast('已撤销本次 AI 的全部改动（已记下，不再这样改）', 'info', { label: '重做', fn: () => redoAction() });
  }, [current, updateArtifact, toast, redoAction]); // eslint-disable-line
  const revertOne = useCallback((nodeId: string) => {
    const a = curArt(); if (!a) return;
    redoStack.current[a.id] = [];
    // v2.0：撤回 = 负反馈，记成一句偏好（之后每步作为约束；可在“资料”里停用）
    const chg = headChanges(a); const c = chg?.map.get(nodeId); const after = findNode(a.root, nodeId);
    const text = c && after ? prefFromRevert(c, after, changeReasons(a.root, chg!.map, manifestFor(a), chg!.version.summary?.issues, chg!.version.summary?.whys).get(nodeId)) : undefined;
    updateArtifact(current!.projectId, a.id, (x) => { const y = coreRevert(x, nodeId); return text ? { ...y, prefs: addPref(y.prefs, text, 'revert', uid('pf')) } : y; });
    if (text) toast(`已撤回，并记下：${text}`, 'info', { label: '不要记', fn: () => mutateCurRef.current?.((z) => ({ ...z, prefs: (z.prefs ?? []).filter((p) => p.text !== text) })) });
  }, [current, updateArtifact, toast]); // eslint-disable-line
  const keepOne = useCallback((nodeId: string) => { const a = curArt(); if (a) updateArtifact(current!.projectId, a.id, (x) => coreKeep(x, nodeId)); }, [current, updateArtifact]); // eslint-disable-line
  /** 方案对比：把另一版本中的某个一级部分采用到当前版本（按位置/标题对齐） */
  const adoptPart = useCallback((fromVid: string, partId: string | null, removeRef?: { id: string; title: string }) => {
    const a = curArt(); if (!a) return;
    if (!partId && removeRef) {
      const kids = (a.root.children ?? []).filter((c) => c.id !== removeRef.id && c.title !== removeRef.title);
      redoStack.current[a.id] = [];
      updateArtifact(current!.projectId, a.id, (x) => commitManual(x, { ...x.root, children: kids }, `按对比去掉「${removeRef.title}」`, undefined, { pin: false }));
      toast(`已去掉「${removeRef.title}」`, 'success', { label: '撤销', fn: () => undoRef.current?.() });
      return;
    }
    if (!partId) return;
    const from = a.versions.find((v) => v.id === fromVid)?.root;
    const part = from?.children?.find((c) => c.id === partId);
    if (!from || !part) return;
    const idx = from.children!.indexOf(part);
    const kids = [...(a.root.children ?? [])];
    const at = kids.findIndex((c) => c.id === part.id || c.title === part.title);
    if (at >= 0) kids[at] = part; else kids.splice(Math.min(idx, kids.length), 0, part);
    redoStack.current[a.id] = [];
    updateArtifact(current!.projectId, a.id, (x) => commitManual(x, { ...x.root, children: kids }, `采用对比方案的「${part.title}」`, undefined, { pin: false }));
    toast(`已采用「${part.title}」`, 'success', { label: '撤销', fn: () => undoRef.current?.() });
  }, [current, updateArtifact, toast]); // eslint-disable-line
  const dismissFailure = useCallback(() => setRun((r) => ({ ...r, failure: undefined, error: undefined })), []);
  const retryLast = useCallback(() => { const l = run.lastOp; if (l) runOp({ ...l }); }, [run.lastOp, runOp]);

  const rollback = useCallback((vid: string) => {
    if (!current) return;
    updateArtifact(current.projectId, current.artifactId, (a) => coreRollback(a, vid));
    setSelectedId(undefined);
    toast('已回滚；下一次操作将从该版本分叉', 'info');
  }, [current, updateArtifact, toast]);

  const renameArtifact = useCallback((title: string) => {
    if (!current) return;
    updateArtifact(current.projectId, current.artifactId, (a) => ({ ...a, title }));
  }, [current, updateArtifact]);

  const toggleStep = useCallback((key: string, stepId: string) => {
    setDisabledSteps((d) => {
      const list = d[key] ?? [];
      return { ...d, [key]: list.includes(stepId) ? list.filter((x) => x !== stepId) : [...list, stepId] };
    });
  }, []);

  const installType = useCallback(async (text: string): Promise<{ ok: boolean; errors: string[]; warnings: string[]; id?: string }> => {
    const r = parseManifest(text, (id) => registryRef.current.get(id));
    if (!r.manifest) return { ok: false, errors: r.errors, warnings: r.warnings };
    const entry = registryRef.current.entry(r.manifest.id);
    if (entry?.source === 'builtin') return { ok: false, errors: [`id「${r.manifest.id}」与内置类型重复，请换一个 id`], warnings: r.warnings };
    await window.api.savePlugin(r.manifest.id, text);
    await loadRegistry();
    return { ok: true, errors: [], warnings: r.warnings, id: r.manifest.id };
  }, [loadRegistry]);

  /** 规划流程：任何意图 → 流程规划师派生蓝图（或使用指定模板） */
  const planIntent = useCallback(async (intent: string, opts: { templateId?: string; title?: string; seed?: PlanState['seed']; facts?: Fact[]; source?: Artifact['source'] } = {}) => {
    planAbort.current?.abort();
    const ctrl = new AbortController();
    planAbort.current = ctrl;
    setPlan({ intent, templateId: opts.templateId, title: opts.title, running: true, log: [], live: {}, seed: opts.seed, facts: opts.facts, source: opts.source });
    setView('blueprint');
    try {
      const res = await planProcess({
        intent, templateId: opts.templateId, providers: buildProviders(settings), signal: ctrl.signal,
        templates: registryRef.current.list().map((e) => e.manifest).filter((m) => m.output === 'tree' || opts.templateId === m.id),
        renderers: listRenderers(),
        onLog: (e) => setPlan((p) => p && ({ ...p, log: p.log.some((x) => x.id === e.id) ? p.log.map((x) => (x.id === e.id ? e : x)) : [...p.log, e] })),
        onDelta: (sid, d) => setPlan((p) => p && ({ ...p, live: { ...p.live, [sid]: (p.live[sid] ?? '') + d } })),
      });
      setPlan((p) => p && ({ ...p, running: false, result: res, draft: res.manifest, log: res.log }));
      return res;
    } catch (e: any) {
      setPlan((p) => p && ({ ...p, running: false, error: String(e?.message ?? e) }));
      return undefined;
    }
  }, [settings]);
  const updateDraft = useCallback((fn: (m: TypeManifest) => TypeManifest) => setPlan((p) => (p?.draft ? { ...p, draft: fn(p.draft) } : p)), []);

  /** 按蓝图开始：制品自带这份蓝图（与模板解耦），并运行第一个检查点 */
  const startFromBlueprint = useCallback((opts: { title?: string; projectId?: string; autoRun?: boolean } = {}) => {
    const p0 = plan;
    if (!p0?.draft) return;
    const m = p0.draft;
    let pid = opts.projectId;
    pid = ensureDefaultProject(pid);
    let art: Artifact = { ...coreCreate(m, p0.intent, opts.title ?? p0.title), blueprint: m, ...(p0.facts?.length ? { facts: p0.facts } : {}), ...(p0.source ? { source: p0.source } : {}) };
    let start = -1;
    if (p0.seed) {
      art = { ...art, refs: p0.seed.refs };
      if (p0.seed.useAsDraft && p0.seed.tree) {
        // 规划师按已有内容的细化程度挑选起始步骤
        const pick = pickStartStage(p0.seed.tree, m);
        start = pick.index;
        // 导入时把说明里的数字整理进数字字段（标“推断”）
        const filled = fillNumbers({ ...p0.seed.tree, title: opts.title ?? p0.title ?? p0.seed.tree.title }, m).root;
        art = { ...commitManual(art, filled, `导入「${p0.seed.name}」`, m.stages[start].id, { pin: false }), stageIndex: start };
        setTimeout(() => toastRef.current?.(`已导入「${p0.seed!.name}」。${pick.reason}`, 'success', undefined, 7000), 300);
      }
    }
    dirty.current.add(pid);
    setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, artifacts: [...p.artifacts, art], updatedAt: Date.now() } : p)));
    projectsRef.current = projectsRef.current.map((p) => (p.id === pid ? { ...p, artifacts: [...p.artifacts, art] } : p));
    setCurrent({ projectId: pid, artifactId: art.id });
    setSelectedId(undefined);
    setView('artifact');
    if (opts.autoRun !== false && start < 0) setTimeout(() => runOp({ op: 'generate', stageIndex: 0, pid, aid: art.id, targetId: null }), 30);
    return { pid: pid!, aid: art.id };
  }, [plan, ensureDefaultProject, runOp]);

  /* ───── v1.6：导入 / 参考资料 / 直接编辑 / 备份 ───── */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 读文件并解析（docx/pdf/xlsx/xmind… 全部本地解析） */
  const extractFiles = useCallback(async (files: { name: string; data: string }[]) => {
    const { extractFile, browserLibs } = await import('./extract');
    const libs = await browserLibs();
    const out: (ImportResult & { name: string })[] = [];
    for (const f of files) {
      try {
        const bin = atob(f.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        out.push({ ...(await extractFile(f.name, bytes, libs)), name: f.name });
      } catch (e: any) { toastRef.current?.(`「${f.name}」读取失败：${String(e?.message ?? e).slice(0, 120)}`, 'error'); }
    }
    return out;
  }, []);
  /** 首页“从已有材料开始”：解析 → 参考资料 + 可作为初稿 → 规划师规划流程并挑起始步骤 */
  const importStart = useCallback(async (files?: { name: string; data: string }[]) => {
    const picked = files ?? (await window.api.importPick());
    if (!picked?.length) return;
    const res = await extractFiles(picked);
    if (!res.length) return;
    const { treeAsText } = await import('./extract');
    const main = res.find((r) => r.tree) ?? res[0];
    const refs: RefItem[] = res.map((r) => ({ id: uid('ref'), name: r.name, kind: 'file', text: r.text || (r.tree ? treeAsText(r.tree) : ''), addedAt: Date.now() }));
    // 导入理解：草稿里“待定 / ？ / TODO”的句子抽成“待澄清的问题”
    const oq = main.tree && main.kind === 'content' ? extractOpenQuestions(main.tree) : { tree: main.tree, questions: [] };
    const seed = { name: main.name, kind: main.kind, tree: oq.tree, refs, useAsDraft: !!main.tree?.children?.length, notes: res.flatMap((r) => r.notes ?? []), questions: oq.questions.length };
    const intent = `${main.title}（基于已有材料「${main.name}」继续完善）`;
    const r = await planIntent(intent, { title: main.title, seed });
    // 流程名直接用材料的标题（规划师按意图起的名字可能被截断）
    if (r) setPlan((p) => (p?.draft ? { ...p, draft: { ...p.draft, name: main.title } } : p));
    return r;
  }, [extractFiles, planIntent]);
  const mutateCur = useCallback((fn: (a: Artifact) => Artifact) => { if (current) updateArtifact(current.projectId, current.artifactId, fn); }, [current, updateArtifact]);
  const addRefs = useCallback(async (kind: 'file' | 'text' | 'url', payload?: { name?: string; text?: string; url?: string }) => {
    if (kind === 'file') {
      const picked = await window.api.importPick();
      if (!picked?.length) return;
      const { treeAsText } = await import('./extract');
      const res = await extractFiles(picked);
      mutateCur((a) => ({ ...a, refs: [...(a.refs ?? []), ...res.map((r) => ({ id: uid('ref'), name: r.name, kind: 'file' as const, text: r.text || (r.tree ? treeAsText(r.tree) : ''), addedAt: Date.now() }))] }));
      if (res.length) toast(`已添加 ${res.length} 份参考资料，之后每一步都会参考`, 'success');
    } else if (kind === 'text' && payload?.text?.trim()) {
      mutateCur((a) => ({ ...a, refs: [...(a.refs ?? []), { id: uid('ref'), name: payload.name?.trim() || payload.text!.trim().slice(0, 20), kind: 'text', text: payload.text!.trim(), addedAt: Date.now() }] }));
    } else if (kind === 'url' && payload?.url?.trim()) {
      const url = payload.url.trim();
      let text = payload.text?.trim() ?? '', name = url;
      if (!text) { const r = await window.api.fetchUrl(url); if (r?.ok && r.text) { text = r.text; name = r.title || url; } else { toast(`网页没取到（${r?.error ?? '无法访问'}），已只记下网址；可以把正文粘贴进来`, 'info'); text = url; } }
      mutateCur((a) => ({ ...a, refs: [...(a.refs ?? []), { id: uid('ref'), name, kind: 'url', text: `${url}\n${text === url ? '' : text}`.trim(), addedAt: Date.now() }] }));
    }
  }, [extractFiles, mutateCur, toast]);
  const removeRef = useCallback((id: string) => mutateCur((a) => ({ ...a, refs: (a.refs ?? []).filter((r) => r.id !== id) })), [mutateCur]);
  const toggleRef = useCallback((id: string) => mutateCur((a) => ({ ...a, refs: (a.refs ?? []).map((r) => (r.id === id ? { ...r, off: !r.off } : r)) })), [mutateCur]);
  /** 恢复备份：主进程先给当前数据做“恢复前”备份，再覆盖；然后重新加载 */
  const restoreBackup = useCallback(async (id: string, label: string) => {
    const ok = await confirmDialog({ title: '恢复这份备份？', body: `将恢复到「${label}」时的全部作品。当前数据会先自动备份一份（“恢复前”），随时可以再恢复回来。`, ok: '恢复' });
    if (!ok) return;
    try { await window.api.restoreBackup(id); location.reload(); } catch (e: any) { toast(`恢复失败：${e?.message ?? e}`, 'error'); }
  }, [confirmDialog, toast]);

  /* ───── v1.7：固定事实 / 步骤间追问 / 派生 ───── */
  const answerAsk = useCallback((askId: string, answer: string) => mutateCur((a) => {
    const q = (a.asks ?? []).find((x) => x.id === askId);
    if (!q) return a;
    const facts = [...(a.facts ?? []), { id: uid('f'), q: q.q, a: answer.trim(), from: 'review' as const, at: Date.now() }];
    return { ...a, facts, asks: (a.asks ?? []).filter((x) => x.id !== askId) };
  }), [mutateCur]);
  const dismissAsks = useCallback(() => mutateCur((a) => ({ ...a, facts: [...(a.facts ?? []), ...(a.asks ?? []).map((q) => ({ id: uid('f'), q: q.q, a: '', from: 'review' as const, at: Date.now() }))], asks: [] })), [mutateCur]);
  const addFact = useCallback((q: string, ans: string) => q.trim() && mutateCur((a) => ({ ...a, facts: [...(a.facts ?? []), { id: uid('f'), q: q.trim(), a: ans.trim(), from: 'user' as const, at: Date.now() }] })), [mutateCur]);
  const togglePref = useCallback((id: string) => mutateCur((a) => ({ ...a, prefs: (a.prefs ?? []).map((p) => (p.id === id ? { ...p, on: !p.on } : p)) })), [mutateCur]);
  const removePref = useCallback((id: string) => mutateCur((a) => ({ ...a, prefs: (a.prefs ?? []).filter((p) => p.id !== id) })), [mutateCur]);
  const addUserPref = useCallback((t: string) => t.trim() && mutateCur((a) => ({ ...a, prefs: addPref(a.prefs, t.trim(), 'user', uid('pf')) })), [mutateCur]);
  mutateCurRef.current = mutateCur;
  const removeFact = useCallback((id: string) => mutateCur((a) => ({ ...a, facts: (a.facts ?? []).filter((f) => f.id !== id) })), [mutateCur]);
  /** 以此为基础新建：上游全文作为参考资料，意图自动填写，新作品记录来源 */
  const deriveFrom = useCallback(async (kind: { label: string; templateId?: string; verb: string }) => {
    const a = curArt(); if (!a || !current) return;
    const text = `${a.title}\n${toOutlineText(a.root, { props: true })}`;
    const refId = uid('ref');
    const ref: RefItem = { id: refId, name: `来自「${a.title}」`, kind: 'text', text, addedAt: Date.now() };
    const intent = `基于「${a.title}」${kind.verb}`;
    await planIntent(intent, { title: `${a.title.replace(/[（(].*$/, '').split(' · ')[0].slice(0, 20).trim()} · ${kind.label}`, templateId: kind.templateId, seed: { name: a.title, kind: 'content', refs: [ref], useAsDraft: false }, facts: a.facts?.filter((f) => f.a), source: { projectId: current.projectId, artifactId: a.id, title: a.title, versionId: a.head, refId } });
  }, [current, planIntent]); // eslint-disable-line
  const openSource = useCallback(() => { const a = curArt(); if (a?.source) openArtifact(a.source.projectId, a.source.artifactId); }, [current, openArtifact]); // eslint-disable-line
  /** 上游改了：用上游当前内容更新参考资料 */
  const refreshFromSource = useCallback(() => {
    const a = curArt(); if (!a?.source) return;
    const up = projectsRef.current.find((p) => p.id === a.source!.projectId)?.artifacts.find((x) => x.id === a.source!.artifactId);
    if (!up) return;
    const text = `${up.title}\n${toOutlineText(up.root, { props: true })}`;
    mutateCur((x) => ({ ...x, refs: (x.refs ?? []).some((r) => r.id === x.source!.refId) ? (x.refs ?? []).map((r) => (r.id === x.source!.refId ? { ...r, text, addedAt: Date.now() } : r)) : [...(x.refs ?? []), { id: x.source!.refId ?? uid('ref'), name: `来自「${up.title}」`, kind: 'text' as const, text, addedAt: Date.now() }], source: { ...x.source!, versionId: up.head, dismissed: undefined } }));
    toast(`已用「${up.title}」的最新内容更新参考资料；之后的步骤会按新内容来`, 'success');
  }, [current, mutateCur, toast]); // eslint-disable-line
  const dismissSource = useCallback(() => { const a = curArt(); if (!a?.source) return; const up = projectsRef.current.find((p) => p.id === a.source!.projectId)?.artifacts.find((x) => x.id === a.source!.artifactId); mutateCur((x) => ({ ...x, source: { ...x.source!, dismissed: up?.head } })); }, [current, mutateCur]); // eslint-disable-line
  const [hlIds, setHlIds] = useState<string[]>([]);

  /** 任何一次运行（或草稿蓝图）都可以存为模板：模板 = 缓存下来的蓝图 */
  const saveAsTemplate = useCallback(async (m: TypeManifest, name?: string, description?: string) => {
    const t = { ...blueprintToTemplate(m, name), ...(description ? { description } : {}) };
    const r = await installType(dumpManifest(t));
    if (r.ok) toast(`已存为模板「${t.name}」，可在模板库中复用`, 'success');
    else toast(r.errors.join('；'), 'error');
    return r;
  }, [toast]); // eslint-disable-line

  const deleteType = useCallback(async (id: string) => {
    await window.api.deletePlugin(id);
    await loadRegistry();
  }, [loadRegistry]);

  return {
    ready, info, settings, saveSettings, projects, registry: registryRef.current, regVersion, manifestOf,
    exportOpen, setExportOpen, compare, setCompare, adoptPart,
    dialog, confirmDialog, saveTpl, setSaveTpl, helpOpen, setHelpOpen, savedAt, ensureDefaultProject, duplicateProjects,
    undo: undoAction, redo: redoAction, keepAndNext, skipStep, finishWork, keepAll, undoAll, revertOne, keepOne, dismissFailure, retryLast,
    answerAsk, dismissAsks, addFact, removeFact, togglePref, removePref, addUserPref, deriveFrom, openSource, refreshFromSource, dismissSource, hlIds, setHlIds,
    editingId, setEditingId, importStart, extractFiles, addRefs, removeRef, toggleRef, restoreBackup,
    plan, setPlan, planIntent, updateDraft, startFromBlueprint, saveAsTemplate, manifestFor,
    view, setView, current, currentProject, currentArtifact, currentManifest, openArtifact, deleteArtifact, renameArtifact,
    newProject, renameProject, deleteProject, createArtifact: createArtifactAction,
    selectedId, setSelectedId, textSel, setTextSel, rendererBy, setRendererBy,
    disabledSteps, toggleStep, run, multiSel, toggleMulti, clearMulti, runOp, cancelRun, manualEdit, unpinNode, setStage, rollback, updateArtifact, crossDesign, setCrossDesign,
    toasts, toast, newDialog, setNewDialog, installType, deleteType, loadRegistry, designerSel, setDesignerSel,
  };
}

export type Store = ReturnType<typeof useStoreImpl>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useStoreImpl();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function useMemoOnce<T>(fn: () => T): T { return useMemo(fn, []); } // eslint-disable-line
