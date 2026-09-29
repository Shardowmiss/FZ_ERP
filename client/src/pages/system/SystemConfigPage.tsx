import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Switch } from '@client/src/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@client/src/components/ui/select';
import { Button } from '@client/src/components/ui/button';
import { systemApi } from '@client/src/api/system';
import { uniqueCodeApi } from '@client/src/api/uniqueCode';
import type { SystemConfig } from '@shared/api.interface';
import { errMsg } from '@/utils/errMsg';

interface ConfigRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

const ConfigRow: React.FC<ConfigRowProps> = ({ label, description, children }) => (
  <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
    <div className="flex-1 pr-6">
      <div className="text-sm font-medium text-gray-800">{label}</div>
      {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

interface SelectFieldProps {
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange: (value: string) => void;
  width?: string;
}

const SelectField: React.FC<SelectFieldProps> = ({ value, options, onChange, width = 'w-40' }) => (
  <Select value={String(value)} onValueChange={onChange}>
    <SelectTrigger className={width}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((opt) => (
        <SelectItem key={String(opt.value)} value={String(opt.value)}>
          {opt.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10 条/页' },
  { value: 20, label: '20 条/页' },
  { value: 50, label: '50 条/页' },
  { value: 100, label: '100 条/页' },
];

const AMOUNT_DECIMAL_OPTIONS = [
  { value: 2, label: '2 位小数' },
  { value: 4, label: '4 位小数' },
];

const QTY_DECIMAL_OPTIONS = [
  { value: 0, label: '0 位小数' },
  { value: 1, label: '1 位小数' },
  { value: 2, label: '2 位小数' },
];

const AUTO_SAVE_OPTIONS = [
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分钟' },
  { value: 300, label: '5 分钟' },
];

const OVER_DELIVERY_OPTIONS = [
  { value: 0, label: '0%' },
  { value: 5, label: '5%' },
  { value: 10, label: '10%' },
  { value: 20, label: '20%' },
];

const HOME_PAGE_OPTIONS = [
  { value: 'dashboard', label: '数据看板' },
  { value: 'welcome', label: '欢迎页' },
];

const MAX_TABS_OPTIONS = [
  { value: 6, label: '6 个' },
  { value: 8, label: '8 个' },
  { value: 10, label: '10 个' },
  { value: 12, label: '12 个' },
  { value: 15, label: '15 个' },
  { value: 20, label: '20 个' },
];

const SystemConfigPage: React.FC = () => {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveStats, setArchiveStats] = useState<{
    hot: { count: number; minAt: string | null; maxAt: string | null };
    archive: { count: number; minAt: string | null; maxAt: string | null };
  } | null>(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    void systemApi.config.get().then((data) => setConfig(data));
  }, []);

  useEffect(() => {
    void uniqueCodeApi.archiveStats().then(setArchiveStats).catch(() => {});
  }, []);

  const update = <K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await systemApi.config.update(config);
      setConfig(updated);
      toast.success('保存成功');
    } catch (e) {
      toast.error(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!config || config.uniqueCodeArchiveDays <= 0) return;
    setArchiving(true);
    try {
      const r = await uniqueCodeApi.archiveByDays(config.uniqueCodeArchiveDays);
      if (!r.enabled) {
        toast.error('归档未启用：请先设置归档天数（>0）');
        return;
      }
      toast.success(`已归档 ${r.moved} 条流水（早于 ${r.days} 天）`);
      const stats = await uniqueCodeApi.archiveStats().catch(() => null);
      if (stats) setArchiveStats(stats);
    } catch {
      toast.error('归档失败');
    } finally {
      setArchiving(false);
    }
  };

  if (!config) {
    return <div className="p-10 text-sm text-gray-500">加载中...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-800">系统配置</h1>
        <Button onClick={handleSave} disabled={saving}>
          <Save size={16} className="mr-2" />
          保存配置
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-800 mb-2">界面偏好</h2>
        <p className="text-xs text-gray-500 mb-4">自定义界面展示和交互行为</p>
        <ConfigRow label="记住上次打开的Tab列表" description="开启后刷新或重新登录时自动恢复之前打开的Tab">
          <Switch
            checked={config.rememberTabs}
            onCheckedChange={(v) => update('rememberTabs', v)}
          />
        </ConfigRow>
        <ConfigRow label="最大TAB页数量" description="打开新Tab达到上限时自动关闭最久未使用的Tab">
          <SelectField
            value={config.maxTabs}
            options={MAX_TABS_OPTIONS}
            onChange={(v) => update('maxTabs', Number(v))}
          />
        </ConfigRow>
        <ConfigRow label="默认首页" description="登录后默认打开的页面">
          <SelectField
            value={config.defaultHomePage}
            options={HOME_PAGE_OPTIONS}
            onChange={(v) => update('defaultHomePage', v as 'dashboard' | 'welcome')}
          />
        </ConfigRow>
        <ConfigRow label="侧边栏默认折叠" description="进入系统时侧边栏是否默认收起">
          <Switch
            checked={config.sidebarCollapsed}
            onCheckedChange={(v) => update('sidebarCollapsed', v)}
          />
        </ConfigRow>
        <ConfigRow label="表格每页默认条数">
          <SelectField
            value={config.tablePageSize}
            options={PAGE_SIZE_OPTIONS}
            onChange={(v) => update('tablePageSize', Number(v))}
          />
        </ConfigRow>
        <ConfigRow label="金额小数位">
          <SelectField
            value={config.amountDecimals}
            options={AMOUNT_DECIMAL_OPTIONS}
            onChange={(v) => update('amountDecimals', Number(v))}
          />
        </ConfigRow>
        <ConfigRow label="数量小数位">
          <SelectField
            value={config.qtyDecimals}
            options={QTY_DECIMAL_OPTIONS}
            onChange={(v) => update('qtyDecimals', Number(v))}
          />
        </ConfigRow>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-800 mb-2">业务规则</h2>
        <p className="text-xs text-gray-500 mb-4">配置单据处理和库存控制规则</p>
        <ConfigRow label="单据草稿自动保存" description="编辑单据时自动保存草稿">
          <Switch
            checked={config.autoSaveDraft}
            onCheckedChange={(v) => update('autoSaveDraft', v)}
          />
        </ConfigRow>
        <ConfigRow label="自动保存间隔" description="仅开启自动保存时生效">
          <SelectField
            value={config.autoSaveInterval}
            options={AUTO_SAVE_OPTIONS}
            onChange={(v) => update('autoSaveInterval', Number(v))}
          />
        </ConfigRow>
        <ConfigRow label="允许负库存" description="关闭后库存不足时不能出库">
          <Switch
            checked={config.allowNegativeStock}
            onCheckedChange={(v) => update('allowNegativeStock', v)}
          />
        </ConfigRow>
        <ConfigRow label="单据审核后可修改" description="开启后已审核的单据仍可编辑">
          <Switch
            checked={config.allowEditAfterApproval}
            onCheckedChange={(v) => update('allowEditAfterApproval', v)}
          />
        </ConfigRow>
        <ConfigRow label="订单超交允许比例" description="出库数量不能超过订单数量的该比例">
          <SelectField
            value={config.overDeliveryRatio}
            options={OVER_DELIVERY_OPTIONS}
            onChange={(v) => update('overDeliveryRatio', Number(v))}
          />
        </ConfigRow>
        <ConfigRow label="零售单允许修改价格" description="关闭后零售单只能按吊牌价销售">
          <Switch
            checked={config.retailAllowPriceEdit}
            onCheckedChange={(v) => update('retailAllowPriceEdit', v)}
          />
        </ConfigRow>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-800 mb-2">唯一码流水留存（冷热分离）</h2>
        <p className="text-xs text-gray-500 mb-4">仅管理员可配置与操作。将过早的流水从热表搬移到归档表，降低热表体积与查询成本，溯源仍完整可见。</p>
        <ConfigRow
          label="流水归档天数"
          description="0 = 不归档；>0 = 将早于该天数的流水归档（冷热分离）。保存后用于「立即归档」。"
        >
          <input
            type="number"
            min={0}
            step={1}
            value={config.uniqueCodeArchiveDays}
            onChange={(e) => update('uniqueCodeArchiveDays', Number(e.target.value) || 0)}
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm text-right"
          />
        </ConfigRow>
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-gray-500">
            热表 {archiveStats?.hot.count ?? '-'} 条；归档表 {archiveStats?.archive.count ?? '-'} 条
          </div>
          <div className="flex items-center gap-2">
            {config.uniqueCodeArchiveDays <= 0 && (
              <span className="text-xs text-amber-600">请先设置归档天数（&gt;0）</span>
            )}
            <Button onClick={handleArchive} disabled={archiving || config.uniqueCodeArchiveDays <= 0}>
              {archiving ? '归档中…' : '立即归档'}
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-800 mb-2">提醒配置</h2>
        <p className="text-xs text-gray-500 mb-4">配置首页提醒和预警相关选项</p>
        <ConfigRow label="库存低于安全库存提醒" description="在数据看板显示低库存预警">
          <Switch
            checked={config.lowStockAlert}
            onCheckedChange={(v) => update('lowStockAlert', v)}
          />
        </ConfigRow>
        <ConfigRow label="单据待审核数量提醒" description="在数据看板显示待办数量">
          <Switch
            checked={config.pendingApprovalAlert}
            onCheckedChange={(v) => update('pendingApprovalAlert', v)}
          />
        </ConfigRow>
      </div>
    </div>
  );
};

export default SystemConfigPage;
