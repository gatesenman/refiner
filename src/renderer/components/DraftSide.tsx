import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useStore } from '../store';
import { draftItems, draftItemsBetween, KIND_LABEL, parseSurvey, type DraftItem, type Survey } from '../../core';

/** 草稿层侧栏：待审阅改动的清单（新增/修改/删除 + 理由 + 保留/撤回） */
export function DraftSide() {
  const s = useStore();
  const a = s.currentArtifact;
  const m = s.currentManifest;
  const [open, setOpen] = useState(true);
  const cfm = s.run.confirm;
  const items: DraftItem[] = (() => {
    if (cfm && a) {
      const list = draftItemsBetween(cfm.base, cfm.preview, m, cfm.result.version.summary?.issues, cfm.result.version.summary?.whys);
      if (list.length) return list;
      return [{ id: cfm.targetId, kind: 'mod' as const, title: cfm.title, why: '这一处已生成预览，请确认是否保留', after: cfm.title }];
    }
    return a ? draftItems(a, m) : [];
  })();
  useEffect(() => { if (items.length) setOpen(true); }, [items.length, a?.head, cfm?.targetId]);
  if (!a || !items.length) return null;
  const adds = items.filter((x) => x.kind === 'add').length;
  const mods = items.filter((x) => x.kind === 'mod').length;
  const dels = items.filter((x) => x.kind === 'del').length;
  const jump = (id: string) => {
    s.setSelectedId(id);
    const el = document.querySelector<HTMLElement>(`.onode[data-node-id="${id}"], .chg-tag`);
    const node = document.querySelector<HTMLElement>(`.onode[data-node-id="${CSS.escape(id)}"]`);
    (node ?? el)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node?.classList.add('chg-focus');
    setTimeout(() => node?.classList.remove('chg-focus'), 1200);
  };
  const canAct = !cfm;
  return (
    <aside className={`draft-side ${open ? 'open' : 'collapsed'}`}>
      <div className="draft-h" onClick={() => setOpen(!open)}>
        <Icon name="ri-file-list-3-line" />
        <b>改动清单</b>
        <span className="muted">{items.length}</span>
        <span className="spacer" />
        <span className="hint">{[adds ? `新 ${adds}` : '', mods ? `改 ${mods}` : '', dels ? `删 ${dels}` : ''].filter(Boolean).join(' · ')}</span>
        <button className="icon-btn" title={open ? '收起' : '展开'} aria-label={open ? '收起' : '展开'} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><Icon name={open ? 'ri-arrow-right-s-line' : 'ri-arrow-left-s-line'} /></button>
      </div>
      {open && (
        <div className="draft-body">
          {cfm && <div className="hint" style={{ padding: '4px 10px' }}>正在确认第 {cfm.i + 1}/{cfm.n} 处「{cfm.title}」</div>}
          {items.map((it) => (
            <div key={it.id + it.kind} className={`draft-item kind-${it.kind} ${s.selectedId === it.id ? 'on' : ''}`} onClick={() => jump(it.id)}>
              <div className="draft-item-h">
                <span className={`chg-tag ${it.kind}`}>{KIND_LABEL[it.kind]}</span>
                <b className="draft-ttl">{it.title}</b>
                {it.parentTitle && <span className="muted"> · {it.parentTitle}</span>}
                {canAct && it.kind !== 'del' && (
                  <span className="draft-acts" onClick={(e) => e.stopPropagation()}>
                    <button className="chg-btn" title="保留这一处" onClick={() => s.keepOne(it.id)}><Icon name="ri-check-line" /></button>
                    <button className="chg-btn" title="撤回这一处" onClick={() => s.revertOne(it.id)}><Icon name="ri-arrow-go-back-line" /></button>
                  </span>
                )}
              </div>
              {it.kind === 'mod' && it.before && <div className="draft-before">改前：{it.before}</div>}
              {it.kind === 'del' && it.before && <div className="draft-before">已删除：{it.before}</div>}
              {it.kind !== 'del' && it.after && it.after !== it.before && <div className="draft-after">改后：{it.after}</div>}
              {it.why && <div className="chg-why"><Icon name="ri-chat-quote-line" />{it.why}</div>}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

/** 逐处确认卡：每改完一处先问再继续 */
export function ConfirmCard() {
  const s = useStore();
  const c = s.run.confirm;
  if (!c) return null;
  return (
    <div className="ask-card confirm-card">
      <div className="ask-h">
        <Icon name="ri-list-check-3" />
        <b>请确认第 {c.i + 1}/{c.n} 处：「{c.title}」</b>
        <span className="muted">保留后再处理其余部分；撤回则这一处保持原样</span>
      </div>
      <div className="row wrap" style={{ gap: 8, padding: '8px 12px 12px' }}>
        <button className="btn" onClick={() => s.decideConfirm('revert')}><Icon name="ri-arrow-go-back-line" />撤回并继续</button>
        <button className="btn primary" onClick={() => s.decideConfirm('keep')}><Icon name="ri-check-line" />保留并继续</button>
        {c.i < c.n - 1 && <button className="btn" onClick={() => s.decideConfirm('keepRest')}>其余不再询问</button>}
        <button className="btn ghost" onClick={() => s.decideConfirm('stop')}>先停在这里</button>
      </div>
    </div>
  );
}


function surveyFromLog(log: { stepId?: string; output?: string; status?: string }[]): Survey | undefined {
  const e = log.find((x) => x.stepId === 'survey' && x.output);
  if (!e?.output) return undefined;
  try { return { perspectives: parseSurvey(e.output), at: Date.now() }; } catch { return undefined; }
}
export function SurveyCard() {
  const s = useStore();
  const sv = s.currentArtifact?.survey ?? surveyFromLog(s.run.log);
  const [open, setOpen] = useState(true);
  if (!sv?.perspectives?.length || !open) return null;
  return (
    <div className="ask-card survey-card">
      <div className="ask-h">
        <Icon name="ri-compass-3-line" />
        <b>多视角备忘</b>
        <span className="muted">铺整体前，执行者 / 审查者 / 使用者先看过一遍</span>
        <span className="spacer" />
        <button className="icon-btn" title="收起" aria-label="收起" onClick={() => setOpen(false)}><Icon name="ri-close-line" /></button>
      </div>
      <div className="survey-body">
        {sv.perspectives.map((p) => (
          <div key={p.id} className="survey-p"><b>{p.name}</b>{p.notes}</div>
        ))}
      </div>
    </div>
  );
}
