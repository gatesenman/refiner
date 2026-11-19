# 渐进 Refiner

“由粗到细、自由度由高到低”的过程引擎（Electron + React + TypeScript）：描述任何意图 → 流程规划师即时派生蓝图（形态 / 检查点 / 自由度 / 智能体分工）→ 沿自由度轴推进。模板只是缓存的蓝图。详见 `docs/规划文档.md`（§A 过程抽象）与 `docs/使用说明.md`。当前版本 v2.0.0（v2.0：从撤回中学习偏好、导出 JSON Canvas / Mermaid；v1.9：多处并行细化、单项粒度更粗/更细、追问卡收起；v1.8：逐条改动理由、Ctrl+单击多选、首次引导、检查器推开内容；见 §22–§24。v1.7：由粗到细看得见：成熟度色点/就绪度/“接着细化最粗的 3 处”；范围守卫；金额字段与合计/小计/预算；导入识别表格与待定问题；步骤间追问；交接清单；“以此为基础新建”链式作品。见 `docs/规划文档.md` §21。此前 v1.6：从已有材料开始：Word/PDF/Excel/XMind/OPML/JSON/YAML 导入；参考资料；单击编辑与拖拽排序；下一步不自动运行；运行中流式显示；任意两版并排对比；tokens/费用/预算；自动备份与恢复；API Key 加密；自动更新；界面缩放。见 `docs/规划文档.md` §20）。

插件 `icon` 字段写图标名（如 `ri-book-open-line`，见规划文档 §7.1）；旧式 emoji 会警告并回退为默认图标。

```
src/core/          纯 TS 引擎（无 UI、无场景知识）：过程规划（process.ts）、契约、逐维自由度 meet、流水线（条件/循环/多人设）、守卫闭环、版本树、能力表 Provider
src/main/          Electron 主进程（持久化、网络请求、IPC）与 preload
src/renderer/      React 界面：万能输入、蓝图编辑、自由度轨道、模板库、检查点面板、8 个渲染积木、模板编辑器（含图标选择器）、设置
src/renderer/icons/ 离线内置图标集（Remix Icon SVG 符号表 + 名称表 + <Icon>），界面不使用 emoji/文字符号作图标
plugins/*.yaml     14 个预设模板（缓存的蓝图，纯声明式）
tests/             vitest 单元测试 56 项（engine / abstraction / icons / process）
scripts/           构建脚本、真实模型冒烟测试
```

## 开发

```bash
npm install
npm test               # 单元测试
npm run typecheck      # 类型检查
npm run build          # 构建 out/
npm start              # 运行（Linux 无沙箱环境可加 -- --no-sandbox）
npm run dist:win       # 打包 Windows：NSIS 安装版 + 便携版 + zip（Linux 上需要 wine）
```

真实模型冒烟测试（任何 OpenAI 兼容接口）：

```bash
BASE=http://127.0.0.1:11434/v1 MODEL=qwen2.5:7b npx vite-node scripts/real-llm-smoke.ts
```
