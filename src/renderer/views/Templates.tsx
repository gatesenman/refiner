import { useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons/Icon';
import { effectiveFreedom, freedomScore } from '../../core';

/** 模板库：模板只是缓存下来的流程蓝图。原来的“内容类型”都在这里，作为可复用的预设 */
export function Templates() {
  const s = useStore();
  const [q, setQ] = useState('');
  void s.regVersion;
  const list = s.registry.list().filter(({ manifest: m }) => !q || `${m.name}${m.description}${m.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 6 }}>
        <Icon name="ri-layout-grid-line" size={22} />
        <h2 style={{ margin: 0, fontSize: 18 }}>模板库</h2>
        <span className="muted">{s.registry.list().length} 个</span>
        <span className="spacer" />
        <input className="input" style={{ width: 220 }} placeholder="搜索模板" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn sm" onClick={() => s.setView('designer')}><Icon name="ri-code-s-slash-line" />模板编辑器</button>
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>模板 = 缓存下来的流程蓝图（形态 + 检查点 + 自由度 + 智能体分工）。它们不是导航，也不是能力边界：没有合适的模板时，直接在「开始」描述你的意图，流程规划师会即时派生一个新流程；任何一次运行都可以「存为模板」。</div>
      <div className="grid-cards">
        {list.map(({ manifest: m, source }) => (
          <div key={m.id} className="tcard" onClick={() => s.setNewDialog({ typeId: m.id })}>
            <div className="row"><span className="ti"><Icon name={m.icon} /></span><span className="spacer" />
              <div className="tpl-spark" style={{ width: 70 }} title="各检查点的有效自由度">{m.stages.map((_x, i) => <i key={i} style={{ height: `${Math.max(8, freedomScore(effectiveFreedom(m.stages, i)))}%` }} />)}</div>
            </div>
            <div className="tn">{m.name}{source === 'user' && <span className="badge accent" style={{ fontSize: 10 }}>我的</span>}</div>
            <div className="td">{m.description}</div>
            <div className="row wrap" style={{ gap: 4, marginTop: 'auto' }}>
              {m.stages.map((st) => <span key={st.id} className="chip" style={{ fontSize: 10.5 }}>{st.name}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
