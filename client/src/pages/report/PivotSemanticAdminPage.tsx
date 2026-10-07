import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Power, Pencil, Info } from 'lucide-react';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import { reportApi } from '@client/src/api/report';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  PivotSemanticAdminItem,
  PivotSemanticInput,
  PivotSupportedFields,
} from '@shared/api.interface';

/**
 * 透视语义层管理页（#758）。
 *
 * 解决 #757 的遗留缺口：语义层当时只有「表+ 接口」，新增一个分析维度仍需DBA 执行
 * INSERT。本页把「开放一个已实现的字段」变成**业务/实施可自助的表单操作**，不发版。
 *
 * 三条安全边界在 UI 上也如实呈现，避免使用者误解「配置 = 写 SQL」：
 *   1. 新增只能选**引擎已实现**的 key（下拉来自服务端白名单快照），不能凭空造 SQL；
 *   2. 未实现的行显式标红「引擎未实现」，提示改数据源或找研发补实现；
 *   3. 只能「停用」不能物理删除——key 存在历史个人模板里，删了老模板会在用户点开时抛错。
 */

const DATA_SOURCES = [
  { value: 'sales', label: '销售/零售' },
  { value: 'purchase', label: '采购' },
  { value: 'inventory', label: '库存' },
  { value: 'transfer', label: '调拨' },
] as const;

const KIND_LABEL: Record<string, string> = { dimension: '维度', measure: '指标' };

const VALUE_FORMATS = [
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均' },
  { value: 'count', label: '计数' },
  { value: 'ratio', label: '比率' },
  { value: 'amount', label: '金额' },
];

const dsLabel = (code: string): string =>
  DATA_SOURCES.find((d) => d.value === code)?.label ?? code;

const emptyForm = (): PivotSemanticInput => ({
  key: '',
  label: '',
  kind: 'dimension',
  dataSources: ['sales'],
  category: '商品维度',
  sortOrder: 100,
  valueFormat: 'sum',
  sensitive: false,
  enabled: true,
  remark: '',
});

const PivotSemanticAdminPage: React.FC = () => {
  const [items, setItems] = useState<PivotSemanticAdminItem[]>([]);
  const [supported, setSupported] = useState<PivotSupportedFields>({});
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [showDisabled, setShowDisabled] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingKey, setEditingKey] = useState<string>('');
  const [form, setForm] = useState<PivotSemanticInput>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reportApi.pivotSemanticAdmin();
      setItems(res.items ?? []);
      setSupported(res.supported ?? {});
    } catch (e) {
      logger.error('加载语义层失败', e);
      toast.error('加载语义层失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 候选 key = 引擎白名单里还没被任何语义行占用的 key。
   * 「已被占用」也要能看到（编辑时可沿用自己那一项），故合并当前 form.key。
   */
  const keyOptions = useMemo(() => {
    const used = new Set(items.map((i) => i.key));
    const cur = form.kind;
    const pool = cur === 'dimension'
      ? supported.sales?.dimensions ?? []
      : supported.sales?.measures ?? [];
    const all = new Set<string>([...pool]);
    for (const ds of DATA_SOURCES) {
      const s = supported[ds.value];
      if (!s) continue;
      for (const k of cur === 'dimension' ? s.dimensions : s.measures) all.add(k);
    }
    return [...all].sort().filter((k) => !used.has(k) || k === form.key);
  }, [supported, items, form.kind, form.key]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter((i) => {
      if (!showDisabled && !i.enabled) return false;
      if (kindFilter && i.kind !== kindFilter) return false;
      if (kw && !`${i.key}${i.label}${i.category}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [items, keyword, kindFilter, showDisabled]);

  /** 按分类分组渲染，与透视选择器的分组口径一致 */
  const grouped = useMemo(() => {
    const m = new Map<string, PivotSemanticAdminItem[]>();
    for (const i of filtered) {
      const g = m.get(i.category) ?? [];
      g.push(i);
      m.set(i.category, g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  }, [filtered]);

  const openCreate = () => {
    setEditingKey('');
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (row: PivotSemanticAdminItem) => {
    setEditingKey(row.key);
    setForm({
      key: row.key,
      label: row.label,
      kind: row.kind as 'dimension' | 'measure',
      dataSources: row.dataSources.split(',').map((s) => s.trim()),
      category: row.category,
      sortOrder: row.sortOrder,
      valueFormat: row.valueFormat as PivotSemanticInput['valueFormat'],
      sensitive: row.sensitive,
      enabled: row.enabled,
      remark: row.remark ?? '',
    });
    setShowModal(true);
  };

  const toggleDs = (code: string) => {
    setForm((f) => {
      const has = f.dataSources.includes(code);
      const next = has ? f.dataSources.filter((d) => d !== code) : [...f.dataSources, code];
      return { ...f, dataSources: next };
    });
  };

  const save = async () => {
    if (!form.label.trim()) {
      toast.error('请填写中文标签');
      return;
    }
    if (!editingKey && !form.key?.trim()) {
      toast.error('请选择字段 key');
      return;
    }
    if (form.dataSources.length === 0) {
      toast.error('请至少选择一个适用数据源');
      return;
    }
    setSaving(true);
    try {
      const payload: PivotSemanticInput = { ...form, label: form.label.trim() };
      if (editingKey) {
        delete payload.key; // key 不可改
        await reportApi.updatePivotSemantic(editingKey, payload);
        toast.success(`已更新「${form.label}」`);
      } else {
        await reportApi.createPivotSemantic(payload);
        toast.success(`已新增「${form.label}」，透视分析即刻可用`);
      }
      setShowModal(false);
      await load();
    } catch (e: any) {
      // 服务端拒绝的原因（引擎未实现等）对业务很有价值，直接展示
      const msg = e?.response?.data?.message ?? e?.message ?? '保存失败';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const disable = async (row: PivotSemanticAdminItem) => {
    const ok = await showConfirm({
      title: '停用语义字段',
      content: `停用后「${row.label}」将从透视分析的字段选择器中隐藏。\n\n已保存的个人模板若引用了该字段，恢复时会报错，需用户自行删除该模板。\n\n（不提供物理删除：字段 key 是历史模板的一部分，删掉会让老模板失效。）`,
      okText: '确认停用',
      cancelText: '取消',
    });
    if (!ok) return;
    try {
      await reportApi.disablePivotSemantic(row.key);
      toast.success(`已停用「${row.label}」`);
      await load();
    } catch (e) {
      logger.error('停用语义失败', e);
      toast.error('停用失败');
    }
  };

  const enable = async (row: PivotSemanticAdminItem) => {
    try {
      await reportApi.updatePivotSemantic(row.key, { enabled: true });
      toast.success(`已启用「${row.label}」`);
      await load();
    } catch (e) {
      logger.error('启用语义失败', e);
      toast.error('启用失败');
    }
  };

  const stats = useMemo(
    () => ({
      total: items.length,
      enabled: items.filter((i) => i.enabled).length,
      sensitive: items.filter((i) => i.sensitive).length,
      unimplemented: items.filter((i) => i.enabled && !i.implemented).length,
    }),
    [items],
  );

  return (
    <div className="p-4 space-y-4">
      {/* 说明条：把边界讲在前面，避免使用者以为「配置=写 SQL」 */}
      <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3 flex items-start gap-2">
        <Info size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-blue-800 leading-relaxed">
          <div className="font-medium mb-1">语义层 = 透视分析的「字段说明书」，不是 SQL 编辑器</div>
          可自助配置的是<b>标签、分类、排序、适用数据源、敏感标记与启停</b>；
          字段<b>只能从引擎已实现的清单中选取</b>（配置表无法生成新的取数表达式）。
          因此本页能解决「新增维度要改代码发版」，但不能新增引擎尚未实现的统计口径。
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '语义总数', value: stats.total, tone: 'text-gray-900' },
          { label: '启用中', value: stats.enabled, tone: 'text-green-600' },
          { label: '敏感指标', value: stats.sensitive, tone: 'text-amber-600' },
          { label: '引擎未实现', value: stats.unimplemented, tone: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded px-4 py-3">
            <div className="text-xs text-gray-500">{s.label}</div>
            <div className={`text-xl font-semibold mt-1 ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="bg-white border border-gray-200 rounded px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Search size={15} className="text-gray-400" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索 key / 标签 / 分类"
            className="h-7 w-56 text-sm"
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm h-7 bg-white"
        >
          <option value="">全部类型</option>
          <option value="dimension">仅维度</option>
          <option value="measure">仅指标</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
          />
          显示已停用
        </label>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1" />
            新增字段
          </Button>
        </div>
      </div>

      {/* 列表：按分类分组 */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded py-16 text-center text-sm text-gray-400">
          加载中…
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded py-16 text-center text-sm text-gray-400">
          没有符合条件的语义字段
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, rows]) => (
            <div key={category} className="bg-white border border-gray-200 rounded overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{category}</span>
                <Badge variant="secondary">{rows.length}</Badge>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="px-4 py-2 font-medium">字段 key</th>
                    <th className="px-4 py-2 font-medium">中文标签</th>
                    <th className="px-4 py-2 font-medium">类型</th>
                    <th className="px-4 py-2 font-medium">适用数据源</th>
                    <th className="px-4 py-2 font-medium">格式化</th>
                    <th className="px-4 py-2 font-medium">排序</th>
                    <th className="px-4 py-2 font-medium">引擎</th>
                    <th className="px-4 py-2 font-medium">状态</th>
                    <th className="px-4 py-2 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.key}</td>
                      <td className="px-4 py-2">
                        {r.label}
                        {r.sensitive && (
                          <Badge variant="outline" className="ml-2 text-amber-600 border-amber-300">
                            敏感
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {r.dataSources.split(',').map((s) => dsLabel(s.trim())).join(' / ')}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{r.valueFormat}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{r.sortOrder}</td>
                      <td className="px-4 py-2">
                        {r.implemented ? (
                          <span className="text-xs text-green-600">已实现</span>
                        ) : (
                          <span
                            className="text-xs text-red-600 cursor-help"
                            title={`引擎未在 ${r.missingIn.join('、')} 实现该字段，透视查询时会报「非法字段」`}
                          >
                            未实现（{r.missingIn.join('、')}）
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {r.enabled ? (
                          <Badge variant="default">启用</Badge>
                        ) : (
                          <Badge variant="secondary">停用</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                            <Pencil size={13} />
                          </Button>
                          {r.enabled ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!r.implemented}
                              title={
                                r.implemented
                                  ? '停用该字段'
                                  : '引擎未实现的字段本就无法查询，请先修复引擎实现'
                              }
                              onClick={() => disable(r)}
                            >
                              <Power size={13} />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!r.implemented}
                              title={r.implemented ? '启用该字段' : '引擎未实现，启用后仍无法查询'}
                              onClick={() => enable(r)}
                            >
                              <Power size={13} className="text-green-600" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* 新增/ 编辑弹窗 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingKey ? `编辑字段：${editingKey}` : '新增透视字段'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-600">字段 key</label>
                {editingKey ? (
                  <Input value={form.key} disabled className="font-mono text-sm" />
                ) : keyOptions.length === 0 ? (
                  /* 引擎已实现的字段全部登记在册时，新增入口本就无处可选——
                     此时如实说明，而不是给一个空下拉让用户对着空气发愣。 */
                  <div className="border border-amber-200 bg-amber-50 rounded px-3 py-2 text-xs text-amber-800 leading-relaxed">
                    引擎已实现的字段<b>全部</b>登记在册，没有待新增的了。
                    如需调整现有字段的标签、分类或适用范围，请关闭本弹窗直接编辑对应行。
                  </div>
                ) : (
                  <select
                    value={form.key ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full bg-white font-mono"
                  >
                    <option value="">请选择引擎已实现的字段…</option>
                    {keyOptions.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  {editingKey
                    ? 'key 是代码侧的物理标识，创建后不可修改。'
                    : '下拉仅列出引擎已实现、且尚未登记的 key。配置表不能生成新的取数表达式。'}
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-600">中文标签</label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="如：上市季节"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-600">字段类型</label>
                <select
                  value={form.kind}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, kind: e.target.value as 'dimension' | 'measure', key: '' }))
                  }
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full bg-white"
                >
                  <option value="dimension">维度（行/列/筛选用）</option>
                  <option value="measure">指标（求和/平均用）</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-600">所属分类</label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="如：商品维度"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-600">排序号</label>
                <Input
                  type="number"
                  value={form.sortOrder ?? 100}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value || '100', 10) }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-600">适用数据源（可多选）</label>
              <div className="flex flex-wrap gap-3 pt-1">
                {DATA_SOURCES.map((d) => (
                  <label key={d.value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.dataSources.includes(d.value)}
                      onChange={() => toggleDs(d.value)}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-600">数值格式化</label>
                <select
                  value={form.valueFormat}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      valueFormat: e.target.value as PivotSemanticInput['valueFormat'],
                    }))
                  }
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full bg-white"
                >
                  {VALUE_FORMATS.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 flex items-end gap-4 pb-1.5">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.sensitive}
                    onChange={(e) => setForm((f) => ({ ...f, sensitive: e.target.checked }))}
                  />
                  敏感指标（需财务-利润权限才可见）
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.enabled ?? true}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                  启用
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-600">备注</label>
              <Input
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                placeholder="如：2026Q4 业务要求新增「上市季节」维度"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)} disabled={saving}>
              取消
            </Button>
            <Button
              onClick={save}
              disabled={saving || (!editingKey && keyOptions.length === 0)}
              title={
                !editingKey && keyOptions.length === 0
                  ? '没有待新增的字段（引擎已实现的字段均已登记）'
                  : undefined
              }
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PivotSemanticAdminPage;