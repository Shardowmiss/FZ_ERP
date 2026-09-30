/**
 * 简体中文词典 —— 翻译的「唯一源」（POS）。
 * 约定同 ERP：扁平 key；未翻译 key 由 t() 回退到本文件。
 */
export const zhCN = {
  // ─── 通用动作 / 字段 ──────────────────────────────────────────────
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.confirm': '确认',
  'common.create': '新增',
  'common.search': '搜索',
  'common.refresh': '刷新',
  'common.edit': '编辑',
  'common.export': '导出',
  'common.back': '返回',
  'common.submit': '提交',
  'common.reset': '重置',
  'common.all': '全部',
  'common.operate': '操作',
  'common.status': '状态',
  'common.remark': '备注',
  'common.name': '名称',
  'common.code': '编码',

  // ─── 系统设置分类 ────────────────────────────────────────────────
  'settings.store': '门店档案',
  'settings.staff': '员工管理',
  'settings.payment': '支付方式',
  'settings.points': '积分规则',
  'settings.receipt': '小票设置',
  'settings.offline': '离线模拟',
  'settings.logs': '操作日志',
  'settings.language': '语言设置',
  'settings.title': '系统设置',
  'settings.breadcrumb': '系统 / 系统设置',

  // ─── 应用外壳 ───────────────────────────────────────────────────
  'app.title': '云裁POS',

  // ─── 登录页 ─────────────────────────────────────────────────────
  'login.title': '云裁智慧门店 POS',
  'login.code': '工号',
  'login.pin': 'PIN 码',
  'login.submit': '登 录',
  'login.loading': '登录中…',
  'login.demoHint': '演示快速登录（PIN 均为 123456）',
  'login.role.cashier': '收银员',
  'login.role.manager': '店长',
  'login.role.supervisor': '督导',
  'login.pleaseInput': '请输入工号和 PIN',
  'login.failed': '登录失败',

  // ─── 语种选择 ────────────────────────────────────────────────────
  'language.label': '语言',
  'language.zh-CN': '简体中文',
  'language.en': 'English',
  'language.saving': '保存中…',
  'language.current': '当前登录员工可单独设置自己的显示语言，保存后立即生效。',
};

export type I18nKey = keyof typeof zhCN;
