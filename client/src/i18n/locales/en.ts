/**
 * English (en) dictionary —— 基线英语（POS）。
 * 仅覆盖已翻文案；未列出的 key 由 t() 回退到 zh-CN.ts。
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

  // ─── Settings categories ────────────────────────────────────────
  'settings.store': 'Store Profile',
  'settings.staff': 'Staff Management',
  'settings.payment': 'Payment Methods',
  'settings.points': 'Points Rules',
  'settings.receipt': 'Receipt Settings',
  'settings.offline': 'Offline Simulation',
  'settings.logs': 'Operation Logs',
  'settings.language': 'Language',
  'settings.title': 'Settings',
  'settings.breadcrumb': 'System / Settings',

  // ─── App shell ───────────────────────────────────────────────────
  'app.title': 'My POS',

  // ─── Login ───────────────────────────────────────────────────────
  'login.title': 'My POS',
  'login.code': 'Employee ID',
  'login.pin': 'PIN',
  'login.submit': 'Sign In',
  'login.loading': 'Signing in…',
  'login.demoHint': 'Demo quick login (PIN is 123456 for all)',
  'login.role.cashier': 'Cashier',
  'login.role.manager': 'Store Manager',
  'login.role.supervisor': 'Supervisor',
  'login.pleaseInput': 'Please enter your employee ID and PIN',
  'login.failed': 'Login failed',

  // ─── Language ─────────────────────────────────────────────────────
  'language.label': 'Language',
  'language.zh-CN': '简体中文',
  'language.en': 'English',
  'language.saving': 'Saving…',
  'language.current':
    'The currently signed-in employee can set their own display language; changes take effect immediately.',
};
