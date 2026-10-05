import React, { useState, useEffect } from 'react';
import { Plus, Download } from 'lucide-react';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type { Bom, BomItem, CostSimulationResult, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';

interface FormItem {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  usagePerPiece: number;
  lossRate: number;
  bomType: string;
}

const statusLabel: Record<string, string> = {
  draft: '草稿',
  pending: '待审',
  approved: '已审',
  completed: '已完成',
};

const BomPage: React.FC = () => {
  const [list, setList] = useState<Bom[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [styleId, setStyleId] = useState<string>('');
  const [styleOptions, setStyleOptions] = useState<{ id: string; styleNo: string; name: string }[]>([]);
  const [materialOptions, setMaterialOptions] = useState<{ id: string; code: string; name: string; unit: string }[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [showModal, setShowModal] = useState<boolean>(false);
  const [editId, setEditId] = useState<string>('');
  const [formStyleId, setFormStyleId] = useState<string>('');
  const [formVersion, setFormVersion] = useState<string>('V1');
  const [formRemark, setFormRemark] = useState<string>('');
  const [formItems, setFormItems] = useState<FormItem[]>([]);

  const [showCostModal, setShowCostModal] = useState<boolean>(false);
  const [costStyleId, setCostStyleId] = useState<string>('');
  const [costResult, setCostResult] = useState<CostSimulationResult | null>(null);

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: { page: number; pageSize: number; styleId?: string } = { page, pageSize };
      if (styleId) params.styleId = styleId;
      const res = await productionApi.bom.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [page, styleId]);

  useEffect(() => {
    const loadOptions = async (): Promise<void> => {
      try {
        const [s, m] = await Promise.all([
          baseApi.style.options(),
          baseApi.material.options(),
        ]);
        setStyleOptions(s);
        setMaterialOptions(m);
      } catch {
        // ignore
      }
    };
    loadOptions();
  }, []);

  const openAdd = (): void => {
    setEditId('');
    setFormStyleId('');
    setFormVersion('V1');
    setFormRemark('');
    setFormItems([]);
    setShowModal(true);
  };

  const openEdit = async (id: string): Promise<void> => {
    try {
      const bom = await productionApi.bom.get(id);
      setEditId(id);
      setFormStyleId(bom.styleId);
      setFormVersion(bom.version);
      setFormRemark(bom.remark ?? '');
      setFormItems((bom.items ?? []).map((it: BomItem) => ({
        id: it.id,
        materialId: it.materialId,
        materialCode: it.materialCode,
        materialName: it.materialName,
        unit: it.unit,
        usagePerPiece: it.usagePerPiece,
        lossRate: it.lossRate,
        bomType: it.bomType,
      })));
      setShowModal(true);
    } catch (e) {
      toast(errMsg(e, '加载详情失败'));
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!await showConfirm('确定删除该BOM吗？')) return;
    try {
      await productionApi.bom.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  };

  const handleAddRow = (): void => {
    const firstMat = materialOptions[0];
    setFormItems(prev => [...prev, {
      id: `tmp_${Date.now()}`,
      materialId: firstMat?.id ?? '',
      materialCode: firstMat?.code ?? '',
      materialName: firstMat?.name ?? '',
      unit: firstMat?.unit ?? '',
      usagePerPiece: 0,
      lossRate: 0,
      bomType: '主料',
    }]);
  };

  const handleRemoveRow = (idx: number): void => {
    setFormItems(prev => prev.filter((_: FormItem, i: number) => i !== idx));
  };

  const updateItemField = (idx: number, field: keyof FormItem, value: string | number): void => {
    setFormItems(prev => prev.map((it: FormItem, i: number) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };
      if (field === 'materialId') {
        const mat = materialOptions.find((m: { id: string }) => m.id === value);
        if (mat) {
          updated.materialCode = mat.code;
          updated.materialName = mat.name;
          updated.unit = mat.unit;
        }
      }
      return updated;
    }));
  };

  const handleSubmit = async (): Promise<void> => {
    if (!formStyleId) { toast('请选择款号'); return; }
    if (!formVersion) { toast('请填写版本'); return; }
    if (formItems.length === 0) { toast('请添加至少一条BOM明细'); return; }
    const data = {
      styleId: formStyleId,
      version: formVersion,
      remark: formRemark,
      items: formItems.map((it: FormItem) => ({
        materialId: it.materialId,
        usagePerPiece: Number(it.usagePerPiece),
        lossRate: Number(it.lossRate),
        bomType: it.bomType,
      })),
    };
    try {
      if (editId) {
        await productionApi.bom.update(editId, data);
      } else {
        await productionApi.bom.create(data);
      }
      toast('保存成功');
      setShowModal(false);
      fetchList();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    }
  };

  const openCostSim = (): void => {
    setCostStyleId('');
    setCostResult(null);
    setShowCostModal(true);
  };

  const runCostSim = async (): Promise<void> => {
    if (!costStyleId) { toast('请选择款号'); return; }
    try {
      const res = await productionApi.bom.costSimulation(costStyleId);
      setCostResult(res);
    } catch (e) {
      toast(errMsg(e, '成本模拟失败'));
    }
  };

  const handleExport = async (): Promise<void> => {
    try {
      const params: { page: number; pageSize: number; styleId?: string } = { page: 1, pageSize: 10000 };
      if (styleId) params.styleId = styleId;
      const res: PaginationResult<Bom> = await productionApi.bom.list(params);
      const columnMap: Record<string, string> = {
        styleNo: '款号',
        version: '版本',
        status: '状态',
        createdAt: '创建时间',
      };
      const data = res.items.map((item: Bom) => ({
        ...item,
        status: statusLabel[item.status] ?? item.status,
      }));
      exportTableToCSV('生产BOM列表', data, columnMap);
      toast('导出成功');
    } catch (e) {
      toast.error(errMsg(e, '导出失败'));
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-800">生产BOM</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openCostSim}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
          >
            成本模拟
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700 flex items-center gap-1"
          >
            <Download size={16} /> 导出
          </button>
          <button
            onClick={openAdd}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary flex items-center gap-1"
          >
            <Plus size={16} /> + 新增BOM
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200">
        <span className="text-sm text-gray-600">款号：</span>
        <select
          value={styleId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStyleId(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部款号</option>
          {styleOptions.map((s: { id: string; styleNo: string; name: string }) => (
            <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
          ))}
        </select>
        <div className="flex-1" />
      </div>

      {/* 列表 */}
      <TableContainer>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600 bg-gray-50">
              <th className="text-left py-2.5 px-4 font-medium">款号</th>
              <th className="text-left py-2.5 px-4 font-medium">版本</th>
              <th className="text-left py-2.5 px-4 font-medium">状态</th>
              <th className="text-left py-2.5 px-4 font-medium">创建时间</th>
              <th className="text-left py-2.5 px-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item: Bom) => (
                <tr key={item.id} className="border-b border-gray-100 h-10 hover:bg-gray-50">
                  <td className="py-2 px-4">{item.styleNo}</td>
                  <td className="py-2 px-4">{item.version}</td>
                  <td className="py-2 px-4">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                      {statusLabel[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-gray-500">{item.createdAt || '-'}</td>
                  <td className="py-2 px-4">
                    <button onClick={() => openEdit(item.id)} className="text-primary hover:text-primary mr-3">编辑</button>
                    <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-600 mr-3">删除</button>
                    <button
                      onClick={async () => {
                        try {
                          const res = await productionApi.bom.costSimulation(item.styleId);
                          setCostResult(res);
                          setShowCostModal(true);
                        } catch { toast('获取成本模拟失败'); }
                      }}
                      className="text-emerald-500 hover:text-emerald-600"
                    >成本模拟</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableContainer>

      {/* 分页 */}
      <DataPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(v: number) => { setPageSize(v); setPage(1); }}
      />

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <span className="text-base font-medium">{editId ? '编辑BOM' : '新增BOM'}</span>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">款号<span className="text-red-500">*</span></label>
                  <select
                    value={formStyleId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormStyleId(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="">请选择款号</option>
                    {styleOptions.map((s: { id: string; styleNo: string; name: string }) => (
                      <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">版本<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={formVersion}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormVersion(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">备注</label>
                <textarea
                  value={formRemark}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormRemark(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-600 font-medium">BOM明细</label>
                  <button onClick={handleAddRow} className="text-sm text-primary hover:text-primary">+ 添加行</button>
                </div>
                <table className="w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="text-left py-2 px-2 font-medium border-b border-gray-200">物料</th>
                      <th className="text-left py-2 px-2 font-medium border-b border-gray-200 w-24">单件用量</th>
                      <th className="text-left py-2 px-2 font-medium border-b border-gray-200 w-24">损耗率(%)</th>
                      <th className="text-left py-2 px-2 font-medium border-b border-gray-200 w-28">类型</th>
                      <th className="text-center py-2 px-2 font-medium border-b border-gray-200 w-16">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formItems.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-6 text-gray-400">暂无明细，点击添加行</td></tr>
                    ) : (
                      formItems.map((item: FormItem, idx: number) => (
                        <tr key={item.id} className="border-b border-gray-100">
                          <td className="py-1.5 px-2">
                            <select
                              value={item.materialId}
                              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateItemField(idx, 'materialId', e.target.value)}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                            >
                              {materialOptions.map((m: { id: string; code: string; name: string }) => (
                                <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              value={item.usagePerPiece}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItemField(idx, 'usagePerPiece', Number(e.target.value))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                              step="0.001"
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              value={item.lossRate}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItemField(idx, 'lossRate', Number(e.target.value))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                              step="0.1"
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <select
                              value={item.bomType}
                              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateItemField(idx, 'bomType', e.target.value)}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                            >
                              <option value="主料">主料</option>
                              <option value="辅料">辅料</option>
                              <option value="包材">包材</option>
                            </select>
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button onClick={() => handleRemoveRow(idx)} className="text-red-500 text-xs">删除</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">取消</button>
              <button onClick={handleSubmit} className="px-4 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 成本模拟弹窗 */}
      {showCostModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[800px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <span className="text-base font-medium">成本模拟</span>
              <button onClick={() => setShowCostModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600">款号：</label>
                <select
                  value={costStyleId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setCostStyleId(e.target.value); setCostResult(null); }}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 max-w-xs focus:outline-none focus:border-primary"
                >
                  <option value="">请选择款号</option>
                  {styleOptions.map((s: { id: string; styleNo: string; name: string }) => (
                    <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
                  ))}
                </select>
                <button onClick={runCostSim} className="px-4 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary">模拟</button>
              </div>
              {costResult && (
                <>
                  <div className="text-sm text-gray-600">
                    款号：<span className="font-medium text-gray-800">{costResult.styleNo}</span>
                    <span className="mx-3">款名：<span className="font-medium text-gray-800">{costResult.styleName}</span></span>
                  </div>
                  <table className="w-full text-sm border border-gray-200">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-left py-2 px-2 font-medium border-b border-gray-200">物料编码</th>
                        <th className="text-left py-2 px-2 font-medium border-b border-gray-200">物料名称</th>
                        <th className="text-left py-2 px-2 font-medium border-b border-gray-200 w-16">单位</th>
                        <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-20">单件用量</th>
                        <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-20">损耗率</th>
                        <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-20">毛用量</th>
                        <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-20">单价</th>
                        <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-24">成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costResult.items.map((it, idx: number) => (
                        <tr key={idx} className="border-b border-gray-100">
                          <td className="py-1.5 px-2">{it.materialCode}</td>
                          <td className="py-1.5 px-2">{it.materialName}</td>
                          <td className="py-1.5 px-2">{it.unit}</td>
                          <td className="py-1.5 px-2 text-right">{it.usagePerPiece}</td>
                          <td className="py-1.5 px-2 text-right">{it.lossRate}%</td>
                          <td className="py-1.5 px-2 text-right">{it.grossUsage.toFixed(3)}</td>
                          <td className="py-1.5 px-2 text-right">{it.unitPrice.toFixed(2)}</td>
                          <td className="py-1.5 px-2 text-right text-primary font-medium">{it.cost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-right text-base font-semibold text-gray-800">
                    总物料成本：<span className="text-red-500">¥ {costResult.totalMaterialCost.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowCostModal(false)} className="px-4 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BomPage;
