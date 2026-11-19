import { useStore } from './store';
import { useEffect } from 'react';
import { TitleBar, Sidebar, Toasts, NewDialog, AppDialog, SaveTemplateDialog, HelpDialog, CompareDialog } from './components/Shell';
import { flatten, removeNode, indentNode, outdentNode, findNode } from '../core';
import { escCloseTop } from './esc';
import { toMarkdown } from './exporters';
import { RightPanel } from './components/RightPanel';
import { ArtifactView } from './views/ArtifactView';
import { Home } from './views/Home';
import { BlueprintView } from './views/Blueprint';
import { Templates } from './views/Templates';
import { Designer } from './views/Designer';
import { SettingsView } from './views/Settings';
import { ShotTour } from './ShotTour';

export function App() {
  const s = useStore();
  useShortcuts();
  useEffect(() => { if (s.ready) s.duplicateProjects(); }, [s.ready]); // eslint-disable-line
  useEffect(() => { if (s.ready) window.api.zoom(s.settings.fontScale ?? 1); }, [s.ready, s.settings.fontScale]);
  if (!s.ready) return <div className="empty" style={{ height: '100vh' }}>正在加载…</div>;
  const right = s.settings.expert && s.view === 'artifact' && !!s.currentArtifact && !!s.currentManifest;
  return (
    <div className="app">
      <TitleBar />
      <div className={`body ${right ? 'with-right' : ''}`}>
        <Sidebar />
        <main className="main">
          {s.view === 'artifact' && s.currentArtifact ? <ArtifactView /> : s.view === 'designer' ? <Designer /> : s.view === 'settings' ? <SettingsView /> : s.view === 'blueprint' ? <BlueprintView /> : s.view === 'templates' ? <Templates /> : <Home />}
        </main>
        {right && <RightPanel />}
      </div>
      {s.newDialog && <NewDialog />}
      {s.saveTpl && <SaveTemplateDialog />}
      {s.helpOpen && <HelpDialog />}
      {s.compare && <CompareDialog />}
      <AppDialog />
      <Toasts />
      {s.info?.shot && <ShotTour />}
    </div>
  );
}

/** 全局快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y、Esc 停止、上下方向键选择、Delete、F2、Ctrl+Shift+C、? */
function useShortcuts() {
  const s = useStore();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest?.('.cm-editor'));
      if (s.dialog || s.saveTpl || s.newDialog) return;
      const mod = e.ctrlKey || e.metaKey;
      // 字号：Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 还原
      if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        const cur = s.settings.fontScale ?? 1;
        const next = e.key === '0' ? 1 : Math.round(Math.max(0.8, Math.min(1.6, cur + (e.key === '-' ? -0.1 : 0.1))) * 10) / 10;
        s.saveSettings({ ...s.settings, fontScale: next });
        s.toast(`界面大小 ${Math.round(next * 100)}%（Ctrl+0 还原）`, 'info');
        return;
      }
      // Esc 依次关闭：停止运行 → 浮层 → 面板 → 选择
      if (e.key === 'Escape') {
        if (s.run.running) { e.preventDefault(); s.cancelRun(); return; }
        if (s.helpOpen) { s.setHelpOpen(false); return; }
        if (s.compare) { s.setCompare(null); return; }
        if (typing) return;
        if (s.exportOpen) { s.setExportOpen(false); return; }
        if (escCloseTop()) { e.preventDefault(); return; }
        if (s.selectedId) { s.setSelectedId(undefined); s.setTextSel(undefined); }
        return;
      }
      if (typing) return;
      const inArt = s.view === 'artifact' && !!s.currentArtifact;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && inArt) { e.preventDefault(); s.undo(); return; }
      if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y') && inArt) { e.preventDefault(); s.redo(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c' && inArt && s.currentManifest) {
        e.preventDefault();
        navigator.clipboard.writeText(toMarkdown(s.currentArtifact!.root, s.currentManifest)).then(() => s.toast('已复制为 Markdown', 'success'));
        return;
      }
      if (e.key === '?' && !mod) { s.setHelpOpen(true); return; }
      if (!inArt || s.currentManifest?.output !== 'tree') return;
      const a = s.currentArtifact!;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const ids = flatten(a.root).map((x) => x.node.id);
        if (!ids.length) return;
        e.preventDefault();
        const i = s.selectedId ? ids.indexOf(s.selectedId) : -1;
        const j = e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        s.setSelectedId(ids[j]);
        document.querySelector('.sel')?.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId && s.selectedId !== a.root.id && !s.run.running) {
        e.preventDefault();
        const t = findNode(a.root, s.selectedId)?.title.slice(0, 16) ?? '';
        s.manualEdit(removeNode(a.root, s.selectedId), `删除「${t}」`);
        s.setSelectedId(undefined);
        s.toast(`已删除「${t}」`, 'info', { label: '撤销', fn: () => s.undo() });
        return;
      }
      if ((e.key === 'F2' || e.key === 'Enter') && s.selectedId && !s.run.running) { e.preventDefault(); s.setEditingId(s.selectedId); return; }
      if (e.key === 'Tab' && s.selectedId && s.selectedId !== a.root.id && !s.run.running) {
        e.preventDefault();
        const r = e.shiftKey ? outdentNode(a.root, s.selectedId) : indentNode(a.root, s.selectedId);
        const t = findNode(a.root, s.selectedId)?.title.slice(0, 16) ?? '';
        if (r) s.manualEdit(r, `${e.shiftKey ? '提升' : '缩进'}「${t}」`);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
}
