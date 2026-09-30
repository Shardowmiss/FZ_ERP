/**
 * 简体中文词典 —— 翻译的「唯一源」。
 *
 * 约定：
 * - 扁平 key（点分命名），与 en.ts 的 key 集合保持一致。
 * - 未翻译的 key 由 t() 自动回退到本文件（i18n 标准行为），
 *   因此本文件必须包含全部 key，en.ts 仅覆盖已翻文案。
 * - 支持 {var} 占位插值，由 t(key, { var: value }) 替换。
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

  // ─── 登录页 ──────────────────────────────────────────────────────
  'login.subtitle': '请输入您的账号信息以进入管理后台',
  'login.username': '用户名 / 工号',
  'login.usernamePlaceholder': '请输入用户名',
  'login.password': '密码',
  'login.passwordPlaceholder': '请输入密码',
  'login.remember': '记住我（本机）',
  'login.forgotPassword': '忘记密码？',
  'login.submit': '登 录',
  'login.sso': '企业统一登录（SSO）',
  'login.testAccount': '测试账号：admin / admin123',
  'login.metrics.modules': '大业务模块',
  'login.metrics.pages': '功能页面',
  'login.metrics.tables': '核心数据表',
  'login.trust.compliance': '等保三级合规',
  'login.trust.private': '私有化部署',
  'login.trust.sso': '企业微信 SSO',

  // ─── 应用外壳（侧边栏 / 顶栏） ───────────────────────────────────
  'app.title': '服装ERP系统',
  'app.collapseMenu': '收起菜单',
  'app.expandMenu': '展开侧边栏',

  'topbar.logout': '退出登录',
  'topbar.user': '用户',

  // ─── 语种选择 ────────────────────────────────────────────────────
  'language.label': '语言',
  'language.zh-CN': '简体中文',
  'language.en': 'English',
  'language.saving': '保存中…',
};

export type I18nKey = keyof typeof zhCN;
