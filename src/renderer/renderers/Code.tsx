import { Icon } from '../icons/Icon';
import { useMemo, useRef } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { load as yamlLoad } from 'js-yaml';
import { parseManifest } from '../../core';
import type { RProps } from './types';
import { useStore } from '../store';

export function validateText(lang: string | undefined, text: string): { ok: boolean; msg: string } {
  if (!text.trim()) return { ok: true, msg: '空文档' };
  try {
    if (lang === 'yaml') { yamlLoad(text); return { ok: true, msg: 'YAML 语法正确' }; }
    if (lang === 'json') { JSON.parse(text); return { ok: true, msg: 'JSON 语法正确' }; }
    return { ok: true, msg: `${text.split('\n').length} 行` };
  } catch (e: any) {
    const line = e?.mark?.line != null ? `第 ${e.mark.line + 1} 行：` : '';
    return { ok: false, msg: line + String(e?.reason ?? e?.message ?? e).split('\n')[0] };
  }
}

export function CodeView({ m, root, onChange }: RProps) {
  const store = useStore();
  const text = root.content ?? '';
  const timer = useRef<number | undefined>();
  const exts = useMemo(() => {
    const lang = m.language === 'yaml' ? [yaml()] : m.language === 'json' ? [json()] : m.language === 'markdown' ? [markdown()] : [];
    return [...lang, EditorView.lineWrapping];
  }, [m.language]);
  const v = validateText(m.language, text);
  const isMeta = m.actions?.includes('installAsType');
  const meta = useMemo(() => (isMeta && text.trim() ? parseManifest(text, (id) => store.registry.get(id)) : null), [isMeta, text, store.registry]);
  const sel = store.textSel;

  return (
    <div className="code-wrap" style={{ position: 'absolute', inset: 0 }}>
      <CodeMirror
        value={text}
        theme={store.settings.theme === 'dark' ? oneDark : 'light'}
        extensions={exts}
        height="100%"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        basicSetup={{ foldGutter: true, highlightActiveLine: true }}
        onChange={(val) => {
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onChange({ ...root, content: val }, '手动编辑'), 500);
        }}
        onUpdate={(u) => {
          if (!u.selectionSet) return;
          const r = u.state.selection.main;
          if (r.empty) { if (store.textSel) store.setTextSel(undefined); return; }
          store.setTextSel({ from: r.from, to: r.to, text: u.state.sliceDoc(r.from, r.to) });
        }}
      />
      <div className="code-status">
        <span className={`badge ${v.ok ? 'live' : 'err'}`}><Icon name={v.ok ? 'ri-checkbox-circle-line' : 'ri-close-circle-line'} /> {v.msg}</span>
        {sel && <span className="badge accent">已选中 {sel.text.split('\n').length} 行 / {sel.text.length} 字符 —— 「调整」将只修改选区</span>}
        {meta && (meta.manifest
          ? <span className="badge live">类型插件校验通过：{meta.manifest.name}（{meta.manifest.stages.length} 个阶段）{meta.warnings.length ? ` · ${meta.warnings.length} 条警告` : ''}</span>
          : <span className="badge err" title={meta.errors.join('\n')}>插件校验：{meta.errors[0]}</span>)}
        <span className="spacer" />
        {isMeta && (
          <button className="btn sm primary" disabled={!meta?.manifest} onClick={async () => {
            const r = await store.installType(text);
            if (r.ok) store.toast(`已安装新类型「${r.id}」，左侧导航中可直接使用`, 'success');
            else store.toast(r.errors.join('；'), 'error');
          }}><Icon name="ri-download-2-line" />安装为模板</button>
        )}
        <span className="muted">{m.language?.toUpperCase() ?? 'TEXT'} · UTF-8</span>
      </div>
    </div>
  );
}
