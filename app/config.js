// FZ_ERP 前端配置（可提交，不含真实密钥）
// 真实 publishableKey 由 config.local.js（已被 .gitignore 忽略）注入。
// 仅在缺少本地配置时提供兜底占位，便于无密钥环境下页面仍能加载（但无法访问数据库）。
if (!window.FZ_CONFIG) {
  window.FZ_CONFIG = {
    endpoint: "https://fz-erp.app.workbuddy.host",
    publishableKey: ""   // 留空：从 config.local.js 或 WorkBuddy 应用面板获取，禁止提交真实值
  };
}
