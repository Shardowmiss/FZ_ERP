/**
 * English (en) dictionary —— 基线英语。
 *
 * 仅覆盖已翻文案；未列出的 key 由 t() 自动回退到 zh-CN.ts（中文），
 * 保证首轮上线无空白。后续按模块分批补充即可。
 */
export const en: Record<string, string> = {
  // ─── Common actions / fields ─────────────────────────────────────
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
  'common.create': 'Create',
  'common.search': 'Search',
  'common.refresh': 'Refresh',
  'common.edit': 'Edit',
  'common.export': 'Export',
  'common.back': 'Back',
  'common.submit': 'Submit',
  'common.reset': 'Reset',
  'common.all': 'All',
  'common.operate': 'Actions',
  'common.status': 'Status',
  'common.remark': 'Remark',
  'common.name': 'Name',
  'common.code': 'Code',

  // ─── Login ───────────────────────────────────────────────────────
  'login.subtitle': 'Enter your credentials to access the admin console',
  'login.username': 'Username / Employee ID',
  'login.usernamePlaceholder': 'Enter username',
  'login.password': 'Password',
  'login.passwordPlaceholder': 'Enter password',
  'login.remember': 'Remember me (this device)',
  'login.forgotPassword': 'Forgot password?',
  'login.submit': 'Sign In',
  'login.sso': 'Enterprise SSO',
  'login.testAccount': 'Test account: admin / admin123',
  'login.metrics.modules': 'Business Modules',
  'login.metrics.pages': 'Feature Pages',
  'login.metrics.tables': 'Core Tables',
  'login.trust.compliance': 'Level 3 Security Certified',
  'login.trust.private': 'Private Deployment',
  'login.trust.sso': 'WeCom SSO',

  // ─── App shell ───────────────────────────────────────────────────
  'app.title': 'Apparel ERP',
  'app.collapseMenu': 'Collapse menu',
  'app.expandMenu': 'Expand sidebar',

  'topbar.logout': 'Sign out',
  'topbar.user': 'User',

  // ─── Language ─────────────────────────────────────────────────────
  'language.label': 'Language',
  'language.zh-CN': '简体中文',
  'language.en': 'English',
  'language.saving': 'Saving…',
};
