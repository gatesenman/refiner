/** 生成 v1.6 验收用的真实样本文件（docx / pdf / xlsx / xmind / opml） */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { makeDocx, makePdf, makeXlsx, makeXmind } from '../tests/fixtures/make';
import { normalizeNode } from '../src/core';
const out = process.argv[2] ?? 'fixtures16';
mkdirSync(out, { recursive: true });
const m: any = { id: 'outline', name: '大纲', output: 'tree', stages: [], nodeSchema: { props: [] } };
const docRoot = normalizeNode({ title: '团建方案', children: [
  { title: '第一天：抵达与破冰', content: '上午集合出发，下午破冰游戏', children: [{ title: '09:00 公司门口集合', content: '行政负责点名' }, { title: '14:00 破冰：你画我猜', content: '分 6 组，每组 8 人' }, { title: '18:30 欢迎晚宴' }] },
  { title: '第二天：徒步与协作', content: '山地徒步 8 公里，团队任务', children: [{ title: '08:30 徒步出发', content: '准备饮水和急救包' }, { title: '13:00 团队寻宝', content: '按小组完成 5 个任务点' }] },
  { title: '第三天：复盘与返程', children: [{ title: '09:30 分组复盘' }, { title: '12:00 午餐后返程' }] },
] });
writeFileSync(join(out, '团建方案.docx'), makeDocx(docRoot, m));
writeFileSync(join(out, '会议纪要.pdf'), makePdf(['Weekly product meeting notes', '', 'Goal: launch the import feature in v1.6.', 'Owner: product team. Deadline: end of October.', '', 'Risks: PDF scans have no text layer.', 'Next step: write the user guide and test on Windows.']));
writeFileSync(join(out, '项目排期.xlsx'), makeXlsx([['阶段', '任务', '负责人', '截止'], ['设计', '交互稿', '王敏', '10/20'], ['设计', '视觉稿', '李雷', '10/24'], ['开发', '导入功能', '张伟', '10/30'], ['开发', '对比视图', '赵强', '11/02'], ['测试', 'Windows 验收', '陈晨', '11/05'], ['测试', '回归测试', '陈晨', '11/06']], '排期'));
makeXmind({ title: '产品规划', children: [{ title: '目标', note: '提升真实可用性', children: [{ title: '导入已有材料' }, { title: '敢用：备份与加密' }] }, { title: '体验', children: [{ title: '直接编辑' }, { title: '拖拽排序' }, { title: '并排对比' }] }, { title: '成本', children: [{ title: 'Token 统计' }, { title: '预算上限' }] }] })
  .then((b) => { writeFileSync(join(out, '产品规划.xmind'), b); console.log('fixtures ->', out); });
