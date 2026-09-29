# 云裁POS · 智慧门店 研发规范

## 一、项目概述

「云裁POS · 智慧门店」是云裁ERP体系下的服装连锁门店终端POS系统。采用款-色-码三维主数据模型，与云裁ERP统一品牌视觉语言。

## 二、品牌视觉规范

### 色彩系统（与ERP一致）

| Token | 色值 | 用途 |
|-------|------|------|
| --accent | #C4532F | 品牌橙红（线迹色），主按钮、选中态、高亮 |
| --accent-hover | #A8401F | 主按钮hover |
| --ink | #1B2A36 | 深墨蓝，侧边栏、深色文字 |
| --ink-2 | #233848 | 次深墨蓝 |
| --ink-3 | #2E4A5E | 第三墨蓝 |
| --paper | #F4F2EC | 暖灰白，页面底 |
| --card | #FFFFFF | 卡片白 |
| --line | #E3DFD5 | 实线边框 |
| --line-soft | #EDEAE2 | 软边框 |
| --text-primary | #1B2A36 | 主文字 |
| --text-secondary | #5A6A78 | 次文字 |
| --text-tertiary | #8A9AA8 | 辅助文字 |
| --ok | #3A7D5A | 成功绿 |
| --warn | #C08A2D | 警告黄 |
| --danger | #B4403A | 危险红 |
| --info | #2F5B8C | 信息蓝 |

### 字体系统

- 正文字体：Noto Sans SC → PingFang SC → Microsoft YaHei → system-ui
- 展示字体（品牌名/大标题）：Noto Serif SC → Songti SC
- 数字：tabular-nums 等宽

### 形状与间距

- 圆角：10px（卡片）、8px（按钮）、6px（小按钮/标签）
- 阴影：0 1px 2px rgba(27,42,54,.05), 0 4px 14px rgba(27,42,54,.05)
- 卡片内边距：18px
- 栅格间距：16px

## 三、核心业务组件

### 颜色×尺码矩阵（sku-matrix）
- 行=颜色（带色卡色块），列=尺码，单元格=数量/可点选
- 0库存：灰色占位；低库存（<10）：红色加粗；正常：黑色
- hover：浅橙红底（#F6E4DC）
- 合计行/列：底部合计、右侧合计、右下角总数

## 四、技术架构

- 前端：React 19 + TypeScript + Tailwind CSS + React Router v6
- 后端：NestJS 10 + Drizzle ORM + PostgreSQL
- 图表：ECharts
- 门店编号：HZ-HB-YT-001（杭州湖滨银泰旗舰店）

## 五、模块路由

| 路径 | 页面 | 说明 |
|------|------|------|
| /pos | 收银工作台 | POS首页，三栏布局 |
| /return | 退换货 | 按原单退货/换货 |
| /members | 会员中心 | 会员列表/详情/注册 |
| /promotions | 促销管理 | 促销活动列表 |
| /inventory | 门店库存 | 库存查询/收货/要货/盘点 |
| /shift | 交接班 | 开班/交班/日结 |
| /dashboard | 店长看板 | 经营报表与图表 |
| /omnichannel | 全渠道履约 | 网订店发/自提订单 |
| /erp-sync | ERP对接中心 | 同步总览/日志/接口清单 |
| /settings | 系统设置 | 门店/员工/配置 |
