# 渐进 Refiner

**2.0.0** · 渐进式内容精修工具：先让 AI 大胆铺开整体，再一步步只改你选中的部分；你亲手改过的内容会被保护。

## 功能特性

- 默认简单模式，界面只保留完成任务所需控件；专家模式可查看智能体分工与流水线。
- 演示模式无需 API Key，可用内置例子走完流程。
- 可从已有 Word / PDF / Excel / XMind 等材料开始，支持参考资料、拖拽排序、并排对比版本。
- 运行中显示生成内容，统计 tokens 与费用，支持预算上限、自动备份与 API Key 加密。
- 你改过的内容不会被后续 AI 步骤覆盖。

## 下载

本仓库目前没有已发布的 GitHub Release 安装包。请从源码运行。GitHub 自动生成的 Source code zip/tar 不算安装包。

## 界面截图

仓库里目前还没有已提交的真实产品界面截图（图标、logo 或品牌图不算）。请不要把下列预留路径当成已经存在的图片去引用（避免破链）。待在真实运行窗口中截取后放入：

- `docs/screenshots/01-workbench.png`
- `docs/screenshots/02-main-or-result.png`

截图说明必须写明操作系统、软件版本、是否示例/演示数据，以及是否在 Windows 安装后截取。

## 技术栈

- Electron + TypeScript
- Vitest

## 从源码运行

源码在仓库根目录。本仓库不包含安装包。`package.json` 版本为 2.0.0。

```bash
npm install
npm start            # 需先按 README 构建，或查看其 start/build 脚本
npm test
npm run build
```
使用说明见 `文档/使用说明.md`（文档中的版本号可能早于 2.0.0，以 package.json 为准）。

## 文档

- [使用说明](文档/使用说明.md)
- [规划文档](文档/规划文档.md)

## 贡献

欢迎通过 Issue 和 Pull Request 参与，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。参与时请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可证

本仓库尚未附带 LICENSE 文件，许可证未指定。

---

## English

# Refiner

**2.0.0** · A progressive refinement tool: let AI sketch the whole piece first, then tighten only what you select. Edits you make yourself are protected.

## Features

- Simple mode keeps only the controls needed to finish the job; expert mode shows agent roles and the pipeline.
- Demo mode needs no API key and can run built-in examples end to end.
- Start from existing Word / PDF / Excel / XMind materials, with references, drag-and-drop ordering, and side-by-side version compare.
- Live generation preview, token and cost tracking, budget caps, automatic backups, and encrypted API keys.
- Text you edited yourself is not overwritten by later AI steps.

## Downloads

This repository has no published GitHub Release installer. Run it from source. The automatic Source code zip/tar from GitHub is not an installer.

## Screenshots

No real product-window screenshot has been committed yet (icons, logos, and brand art do not count). Do not add markdown image links to the reserved paths below until the files exist (that would be a broken link). After a live capture, place:

- `docs/screenshots/01-workbench.png`
- `docs/screenshots/02-main-or-result.png`

Captions must state the OS, version, whether the data is sample/demo, and whether the shot was taken after a Windows install.

## Tech stack

- Electron + TypeScript
- Vitest

## Getting started

Source is at the repository root. This repository does not include installers. `package.json` reports version 2.0.0.

```bash
npm install
npm start            # build first if the README requires it
npm test
npm run build
```
The user guide is `文档/使用说明.md` (its version header may be older than 2.0.0; trust package.json).

## Documentation

- [使用说明](文档/使用说明.md)
- [规划文档](文档/规划文档.md)

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities privately via [SECURITY.md](SECURITY.md). This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

No LICENSE file is included in this repository; the license is unspecified.
