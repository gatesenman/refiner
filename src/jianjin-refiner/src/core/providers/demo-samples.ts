/**
 * 演示样例（仅演示 Provider 使用，引擎不知道它们的存在）：
 * 首页 3 个精选示例在演示模式下返回精心写好的内容，让新用户看到“像样”的产出；
 * 其它意图仍走通用样例，画布顶部会提示“演示模式：示例内容，不代表 AI 真实水平”。
 */
export interface SampleNode { title: string; content?: string; props?: Record<string, unknown>; children?: SampleNode[] }
export interface DemoSample { id: string; match: (seed: string) => boolean; root: SampleNode; expand?: Record<string, SampleNode[]>; rain?: SampleNode[] }

const d = (offset: number) => { const t = new Date(); t.setDate(t.getDate() + 14 + offset); return t.toISOString().slice(0, 10); };

const TEAM: DemoSample = {
  id: 'team3d',
  match: (s) => /团建|团队建设/.test(s) && /三天|3\s*天/.test(s),
  root: {
    title: '三天两晚团队建设方案', content: '30 人研发团队，莫干山，预算 1.2 万元。目标：跨组破冰、对齐下季度目标、留下可执行的改进清单。',
    children: [
      { title: '目标与预算', content: '人均 400 元（住宿 220 / 餐饮 120 / 活动 60），预留 10% 机动。', props: { owner: '行政 · 王敏', status: '已确认' },
        children: [
          { title: '三个可衡量的目标', content: '①每人认识至少 5 位非本组同事；②产出下季度 3 个跨组合作点；③满意度 ≥ 4.5/5。', props: { owner: 'HRBP · 李想', status: '已确认' } },
          { title: '预算明细与审批', content: '总计 11,800 元，财务周三前审批；超支 5% 以内由部门经费承担。', props: { owner: '行政 · 王敏', status: '待定' } },
        ] },
      { title: '第 1 天 · 出发与破冰', props: { start: d(0), end: d(0), owner: '活动组 · 陈晨', status: '已确认' },
        children: [
          { title: '09:00 公司集合，大巴出发', content: '车程约 2.5 小时；车上发放分组名单与任务卡。', props: { start: d(0), end: d(0), owner: '行政 · 王敏', status: '已确认' } },
          { title: '14:00 破冰：“盲画同事”', content: '6 人一组，随机打散部门；40 分钟，失败成本低、笑点多。', props: { start: d(0), end: d(0), owner: '活动组 · 陈晨', status: '已确认' } },
          { title: '19:00 欢迎晚宴 + 自我介绍接龙', content: '每人 30 秒：一件工作之外的小事。', props: { start: d(0), end: d(0), owner: '活动组 · 陈晨', status: '待定' } },
        ] },
      { title: '第 2 天 · 协作挑战', props: { start: d(1), end: d(1), owner: '活动组 · 陈晨', status: '待定' },
        children: [
          { title: '09:30 竹林定向越野', content: '跨组 5 人一队，必须全员到达才算完成；设 3 个协作关卡。', props: { start: d(1), end: d(1), owner: '外部教练 · 赵峰', status: '待定' } },
          { title: '14:00 “下季度难题”共创工作坊', content: '世界咖啡形式，每桌一个真实痛点，产出可落地的合作点。', props: { start: d(1), end: d(1), owner: 'HRBP · 李想', status: '待定' } },
          { title: '20:00 篝火 + 才艺', content: '自愿报名，不强制表演。', props: { start: d(1), end: d(1), owner: '活动组 · 陈晨', status: '待定' } },
        ] },
      { title: '第 3 天 · 复盘与返程', props: { start: d(2), end: d(2), owner: 'HRBP · 李想', status: '待定' },
        children: [
          { title: '09:30 复盘会：保留 / 改进 / 尝试', content: '每组 10 分钟分享，汇总成改进清单并指定负责人。', props: { start: d(2), end: d(2), owner: 'HRBP · 李想', status: '待定' } },
          { title: '13:00 午餐后返程', content: '预计 16:00 回到公司；途中发满意度问卷。', props: { start: d(2), end: d(2), owner: '行政 · 王敏', status: '待定' } },
        ] },
      { title: '物料与后勤', content: '提前一周确认人数、饮食禁忌与保险。', props: { owner: '行政 · 王敏', status: '待定' },
        children: [
          { title: '住宿与交通', content: '民宿 15 间双床房；45 座大巴往返。', props: { owner: '行政 · 王敏', status: '已确认' } },
          { title: '安全与保险', content: '全员意外险；随队急救包；户外活动有教练持证。', props: { owner: '行政 · 王敏', status: '待定' } },
        ] },
    ],
  },
  rain: [
    { title: '雨天备选：室内“密室协作”', content: '如遇降雨，定向越野改为民宿会议室的分组解谜，关卡与协作规则不变。', props: { owner: '外部教练 · 赵峰', status: '待定' } },
    { title: '雨天备选：雨具与路线', content: '每人一次性雨衣；上午 7 点根据天气预报决定是否启用备选。', props: { owner: '行政 · 王敏', status: '待定' } },
  ],
  expand: {
    '第 1 天 · 出发与破冰': [{ title: '17:00 入住与自由活动', content: '分房名单提前发群；房间按跨组原则混住。', props: { owner: '行政 · 王敏', status: '待定' } }],
    '第 3 天 · 复盘与返程': [{ title: '一周后：改进清单回访', content: '负责人在周会汇报进度，避免“团建完就结束”。', props: { owner: 'HRBP · 李想', status: '待定' } }],
  },
};

const f = (title: string, type: string, required: '是' | '否', note: string): SampleNode => ({ title, content: note, props: { type, required, note } });
const DB: DemoSample = {
  id: 'wxdb',
  match: (s) => /小程序/.test(s) && /数据库|数据表|表结构/.test(s),
  root: {
    title: '微信小程序商城 · 数据库设计', content: 'MySQL 8，utf8mb4；所有表含 created_at / updated_at；金额统一用分（INT）存储。',
    children: [
      { title: 'users 用户', content: '以微信 openid 识别用户；手机号授权后补全。', props: { type: '表', required: '是', note: '核心实体' },
        children: [f('id', 'BIGINT PK', '是', '自增主键'), f('openid', 'VARCHAR(64) UNIQUE', '是', '微信用户唯一标识'), f('nickname', 'VARCHAR(64)', '否', '昵称，用户可修改'), f('phone', 'VARCHAR(20)', '否', '手机号授权后写入')] },
      { title: 'products 商品', content: '上下架用 status 控制，不物理删除。', props: { type: '表', required: '是', note: '核心实体' },
        children: [f('id', 'BIGINT PK', '是', '自增主键'), f('title', 'VARCHAR(120)', '是', '商品名称'), f('price_cent', 'INT', '是', '售价（分）'), f('stock', 'INT', '是', '库存，下单时扣减'), f('status', 'TINYINT', '是', '0 草稿 / 1 上架 / 2 下架')] },
      { title: 'orders 订单', content: '一单一个收货地址快照，避免地址修改影响历史订单。', props: { type: '表', required: '是', note: '业务实体' },
        children: [f('id', 'BIGINT PK', '是', '自增主键'), f('order_no', 'VARCHAR(32) UNIQUE', '是', '对外展示的订单号'), f('user_id', 'BIGINT FK', '是', '→ users.id'), f('total_cent', 'INT', '是', '实付金额（分）'), f('status', 'TINYINT', '是', '待付款 / 已付款 / 已发货 / 已完成 / 已取消'), f('address_snapshot', 'JSON', '是', '下单时的收货地址副本')] },
      { title: 'order_items 订单明细', content: '记录下单时的价格与标题快照。', props: { type: '表', required: '是', note: '关联关系' },
        children: [f('order_id', 'BIGINT FK', '是', '→ orders.id'), f('product_id', 'BIGINT FK', '是', '→ products.id'), f('qty', 'INT', '是', '购买数量'), f('price_cent', 'INT', '是', '下单时单价快照')] },
      { title: '索引与约束', content: '按小程序最常见的查询建立索引。', props: { type: '规则', required: '是', note: '索引与约束' },
        children: [f('idx_orders_user_status', 'INDEX(user_id, status)', '是', '“我的订单”按状态筛选'), f('uk_users_openid', 'UNIQUE(openid)', '是', '防止重复注册'), f('fk_order_items_order', 'FOREIGN KEY', '是', '删除订单时级联删除明细')] },
    ],
  },
  expand: {
    'users 用户': [f('avatar_url', 'VARCHAR(255)', '否', '头像地址'), f('last_login_at', 'DATETIME', '否', '最近登录时间，用于活跃统计')],
    'orders 订单': [f('paid_at', 'DATETIME', '否', '支付成功时间（微信支付回调写入）'), f('transaction_id', 'VARCHAR(64)', '否', '微信支付交易号，用于对账')],
  },
};

const SONG: DemoSample = {
  id: 'autumn',
  match: (s) => /秋/.test(s) && /歌/.test(s),
  root: {
    title: '《落叶寄信》', content: '民谣，4/4 拍，约 3 分 40 秒。主题：离家多年的人，在秋天收到一封迟来的信。', props: { mood: '温柔的怀念' },
    children: [
      { title: '主歌一', content: '梧桐把影子写得很长\n路灯替我站在老地方\n你说秋天适合寄信\n我却忘了自己的地址', props: { mood: '平静' } },
      { title: '导歌', content: '风翻过旧日历那一页\n像有人轻轻叫我的名字', props: { mood: '渐起' } },
      { title: '副歌', content: '落叶是寄给远方的信\n一片写想念 一片写别哭\n等到北风把它们读完\n我就回到你等我的路口', props: { mood: '释放' } },
      { title: '主歌二', content: '车站的钟还慢五分\n桂花落满你的衣襟\n我们把夏天折成纸船\n放进那年的小河', props: { mood: '回忆' } },
      { title: '桥段', content: '如果季节会迷路\n就让我做那盏灯\n照着你 也照着\n不肯回家的我', props: { mood: '最高点' } },
      { title: '尾声', content: '（副歌末句重复两遍，吉他泛音收尾）\n我就回到你等我的路口', props: { mood: '余韵' } },
    ],
  },
  expand: {
    '副歌': [{ title: '副歌（变奏）', content: '落叶是寄给自己的信\n一片写长大 一片写别怕', props: { mood: '升调' } }],
  },
};

export const DEMO_SAMPLES: DemoSample[] = [TEAM, DB, SONG];
export function sampleFor(seed: string): DemoSample | undefined { return DEMO_SAMPLES.find((x) => x.match(seed ?? '')); }
