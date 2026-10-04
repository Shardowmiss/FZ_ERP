import { StatusBadge } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { errMsg } from '@/utils/errMsg';
import { request } from '@client/src/api/request';

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
}

interface TplRow {
  id: string;
  name: string;
  code: string;
  scopeType: 'all' | 'store' | 'store_type';
  storeFilter?: { ids?: string[]; storeType?: string };
  skuFilter?: { ids?: string[] };
  paramN: number;
  expectedDays: number;
  leadTimeDays: number;
  safetyDays: number;
  caseQty: number;
  sourceWarehouseRule: string;
  fixedWarehouseId?: string;
  enabled: boolean;
  cron?: string;
}

const emptyForm: Partial<TplRow> = {
  name: '',
  code: '',
  scopeType: 'all',
  paramN: 30,
  expectedDays: 14,
  leadTimeDays: 0,
  safetyDays: 0,
  caseQty: 1,
  sourceWarehouseRule: 'fixed',
  enabled: false,
  cron: '',
};

const ReplenishTemplatePage: React.FC = () => {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [list, setList] = useState<TplRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<TplRow>>(emptyForm);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [scopeStoreType, setScopeStoreType] = useState<'direct' | 'franchise'>('franchise');
  const [skuIds, setSkuIds] = useState('');

  useEffect(() => {
    loadStores();
    loadList();
  }, []);

  const loadStores = async () => {
    try {
      const res = await request<StoreOption[]>('/api/base/store/options', 'GET');
      setStores(res || []);
    } catch (error) {
      toast.error(errMsg(error, '加载门店失败'));
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await request<{ total: number; list: TplRow[] }>(
        '/api/inventory/replenish-template?pageSize=50',
        'GET',
      );
      setList(res?.list || []);
    } catch (error) {
      toast.error(errMsg(error, '加载模板失败'));
    }
    setLoading(false);
  };

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setStoreIds([]);
    setScopeStoreType('franchise');
    setSkuIds('');
  };

  const startEdit = (t: TplRow) => {
    setEditing(t.id);
    setForm(t);
    setStoreIds(t.storeFilter?.ids || []);
    setScopeStoreType((t.storeFilter?.storeType as any) || 'franchise');
    setSkuIds((t.skuFilter?.ids || []).join(','));
  };

  const handleSave = async () => {
    if (!form.name || !form.code) {
      toast.error('名称与编码必填');
      return;
    }
    const payload: any = {
      ...form,
      storeFilter:
        form.scopeType === 'store'
          ? { ids: storeIds }
          : form.scopeType === 'store_type'
          ? { storeType: scopeStoreType }
          : null,
      skuFilter: skuIds.trim() ? { ids: skuIds.split(',').map((s) => s.trim()).filter(Boolean) } : null,
    };
    setSaving(true);
    try {
      if (editing) {
        await request(`/api/inventory/replenish-template/${editing}`, 'PATCH', payload);
        toast.success('模板已更新');
      } else {
        await request('/api/inventory/replenish-template', 'POST', payload);
        toast.success('模板已创建');
      }
      await loadList();
      startCreate();
    } catch (error) {
      toast.error(errMsg(error, '保存失败'));
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该模板？')) return;
    try {
      await request(`/api/inventory/replenish-template/${id}`, 'DELETE');
      toast.success('已删除');
      await loadList();
    } catch (error) {
      toast.error(errMsg(error, '删除失败'));
    }
  };

  const handleExecute = async (id: string) => {
    try {
      const res = await request<any>(`/api/inventory/replenish-template/${id}/execute`, 'POST');
      toast.success(
        `执行完成：成功 ${res.successStores}/${res.totalStores} 店，生成 ${res.totalDocs} 单`,
      );
      await loadList();
    } catch (error) {
      toast.error(errMsg(error, '执行失败'));
    }
  };

  const set = (k: keyof TplRow, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">渠道铺货 · 补货模板</h1>
          <span className="text-sm text-gray-400">配置计算参数与作用范围，启用后由系统定时自动生成草稿单据</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 列表 */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-sm font-medium text-gray-700">模板列表</h2>
              <button
                onClick={startCreate}
                className="px-3 py-1.5 bg-primary text-white rounded text-xs hover:bg-blue-600"
              >
                + 新建模板
              </button>
            </div>
            <TableContainer>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                    <th className="px-3 py-2 text-left">编码</th>
                    <th className="px-3 py-2 text-left">名称</th>
                    <th className="px-3 py-2 text-left">范围</th>
                    <th className="px-3 py-2 text-left">cron</th>
                    <th className="px-3 py-2 text-center">启用</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-400">加载中...</td></tr>
                  ) : list.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-400">暂无模板</td></tr>
                  ) : (
                    list.map((t) => (
                      <tr key={t.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-700">{t.code}</td>
                        <td className="px-3 py-2 text-gray-700">{t.name}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {t.scopeType === 'all' ? '全部门店' : t.scopeType === 'store_type' ? `类型:${t.storeFilter?.storeType}` : '指定门店'}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{t.cron || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <StatusBadge tone={t.enabled ? 'ok' : 'neutral'}>{t.enabled ? '是' : '否'}</StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => handleExecute(t.id)} className="text-blue-600 hover:underline text-xs mr-2">执行</button>
                          <button onClick={() => startEdit(t)} className="text-gray-600 hover:underline text-xs mr-2">编辑</button>
                          <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:underline text-xs">删除</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableContainer>
          </div>

          {/* 表单 */}
          <div className="bg-gray-50 rounded p-4">
            <h2 className="text-sm font-medium text-gray-700 mb-3">{editing ? '编辑模板' : '新建模板'}</h2>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="名称 *" value={form.name || ''} onChange={(v) => set('name', v)} />
              <TextField label="编码 *" value={form.code || ''} onChange={(v) => set('code', v)} />
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">作用范围</label>
                <select
                  value={form.scopeType || 'all'}
                  onChange={(e) => set('scopeType', e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded text-sm w-full focus:outline-none focus:border-primary"
                >
                  <option value="all">全部门店</option>
                  <option value="store_type">按门店类型</option>
                  <option value="store">指定门店</option>
                </select>
              </div>
              {form.scopeType === 'store_type' && (
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">门店类型</label>
                  <select
                    value={scopeStoreType}
                    onChange={(e) => setScopeStoreType(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded text-sm w-full focus:outline-none focus:border-primary"
                  >
                    <option value="franchise">经销商（生成销售单）</option>
                    <option value="direct">直营店（生成调拨单）</option>
                  </select>
                </div>
              )}
              {form.scopeType === 'store' && (
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">选择门店（多选）</label>
                  <select
                    multiple
                    value={storeIds}
                    onChange={(e) => setStoreIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
                    className="px-3 py-2 border border-gray-300 rounded text-sm w-full h-28 focus:outline-none focus:border-primary"
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}（{s.storeType === 'franchise' ? '经销商' : '直营店'}）</option>
                    ))}
                  </select>
                </div>
              )}
              <NumberField label="近 N 天" value={form.paramN ?? 30} onChange={(v) => set('paramN', v)} />
              <NumberField label="预计销售天数" value={form.expectedDays ?? 14} onChange={(v) => set('expectedDays', v)} />
              <NumberField label="提前期(天)" value={form.leadTimeDays ?? 0} onChange={(v) => set('leadTimeDays', v)} />
              <NumberField label="安全天数" value={form.safetyDays ?? 0} onChange={(v) => set('safetyDays', v)} />
              <NumberField label="箱规/起订量" value={form.caseQty ?? 1} onChange={(v) => set('caseQty', v)} />
              <div>
                <label className="block text-xs text-gray-500 mb-1">发货仓规则</label>
                <select
                  value={form.sourceWarehouseRule || 'fixed'}
                  onChange={(e) => set('sourceWarehouseRule', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded text-sm w-full focus:outline-none focus:border-primary"
                >
                  <option value="fixed">固定主仓</option>
                </select>
              </div>
              <TextField label="cron 表达式" value={form.cron || ''} onChange={(v) => set('cron', v)} placeholder="如 0 2 * * *" />
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">限定 SKU（可选，逗号分隔 ID）</label>
                <input
                  value={skuIds}
                  onChange={(e) => setSkuIds(e.target.value)}
                  placeholder="留空表示全部 SKU"
                  className="px-3 py-2 border border-gray-300 rounded text-sm w-full focus:outline-none focus:border-primary"
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.enabled}
                  onChange={(e) => set('enabled', e.target.checked)}
                />
                <span className="text-sm text-gray-600">启用定时自动生成（启用需填写 cron）</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存模板'}
              </button>
              <button onClick={startCreate} className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300">
                重置
              </button>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              调度器每 30 秒轮询一次，命中 cron 且本分钟未执行过的启用模板将自动生成草稿单据。可点“执行”立即手动触发验证。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const TextField: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({
  label,
  value,
  onChange,
  placeholder,
}) => (
  <div>
    <label className="block text-xs text-gray-500 mb-1">{label}</label>
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 border border-gray-300 rounded text-sm w-full focus:outline-none focus:border-primary"
    />
  </div>
);

const NumberField: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <div>
    <label className="block text-xs text-gray-500 mb-1">{label}</label>
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="px-3 py-2 border border-gray-300 rounded text-sm w-full focus:outline-none focus:border-primary"
    />
  </div>
);

export default ReplenishTemplatePage;
