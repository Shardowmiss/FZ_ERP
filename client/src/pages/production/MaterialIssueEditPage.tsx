import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type {
  ProductionMaterialIssueItem,
  Warehouse,
  Material,
} from '@shared/api.interface';
import DocPage from '@client/src/components/DocPage/DocPage';
import { errMsg } from '@/utils/errMsg';

const BACK_PATH = '/production/material-issue';

interface IssueItemForm {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  spec: string;
  unit: string;
  planQty: number;
  actualQty: number;
}

const MaterialIssueEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [workOrderOptions, setWorkOrderOptions] = useState<{ id: string; orderNo: string }[]>([]);

  const [formWorkOrderId, setFormWorkOrderId] = useState<string>('');
  const [formWarehouseId, setFormWarehouseId] = useState<string>('');
  const [formIssueDate, setFormIssueDate] = useState<string>('');
  const [formReceiver, setFormReceiver] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [formItems, setFormItems] = useState<IssueItemForm[]>([]);

  const [issueNo, setIssueNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [wh, mat, wo] = await Promise.all([
          baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' }),
          baseApi.material.list({ page: 1, pageSize: 1000, status: 'active' }),
          productionApi.workOrder.list({ page: 1, pageSize: 1000, status: 'producing' }),
        ]);
        setWarehouses(wh.items);
        setMaterials(mat.items);
        setWorkOrderOptions(wo.items.map((it) => ({ id: it.id, orderNo: it.orderNo })));
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  useEffect(() => {
    if (isNew) {
      setFormWarehouseId(warehouses[0]?.id ?? '');
      setFormIssueDate(new Date().toISOString().slice(0, 10));
      return;
    }
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const detail = await productionApi.materialIssue.get(id as string);
        setIssueNo(detail.issueNo);
        setStatus(detail.status);
        setFormWorkOrderId(detail.workOrderId);
        setFormWarehouseId(detail.warehouseId);
        setFormIssueDate(detail.issueDate.slice(0, 10));
        setFormReceiver(detail.receiver ?? '');
        setFormRemark(detail.remark ?? '');
        setFormItems((detail.items ?? []).map((it: ProductionMaterialIssueItem) => ({
          id: it.id,
          materialId: it.materialId,
          materialCode: it.materialCode ?? '',
          materialName: it.materialName ?? '',
          spec: it.spec ?? '',
          unit: it.unit ?? '',
          planQty: it.planQty,
          actualQty: it.actualQty,
        })));
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const addItem = (): void => {
    const first = materials[0];
    if (!first) { toast('暂无物料'); return; }
    setFormItems([...formItems, {
      id: `tmp_${Date.now()}`,
      materialId: first.id,
      materialCode: first.code,
      materialName: first.name,
      spec: first.spec ?? '',
      unit: first.unit ?? '',
      planQty: 0,
      actualQty: 0,
    }]);
  };

  const updateItem = (index: number, field: keyof IssueItemForm, value: string | number): void => {
    const newItems = [...formItems];
    const item = { ...newItems[index] };
    if (field === 'materialId') {
      const mat = materials.find((m: Material) => m.id === value);
      if (mat) {
        item.materialId = mat.id;
        item.materialCode = mat.code;
        item.materialName = mat.name;
        item.spec = mat.spec ?? '';
        item.unit = mat.unit ?? '';
      }
    } else if (field === 'planQty' || field === 'actualQty') {
      (item as IssueItemForm)[field] = Number(value) || 0;
    } else {
      (item as Record<string, string | number>)[field] = value;
    }
    newItems[index] = item;
    setFormItems(newItems);
  };

  const removeItem = (index: number): void => {
    setFormItems(formItems.filter((_: IssueItemForm, i: number) => i !== index));
  };

  const doSave = async (): Promise<boolean> => {
    if (!formWorkOrderId) { toast('请选择生产工单'); return false; }
    if (!formWarehouseId) { toast('请选择领料仓库'); return false; }
    if (!formIssueDate) { toast('请选择领料日期'); return false; }
    if (formItems.length === 0) { toast('请添加明细'); return false; }
    const data = {
      workOrderId: formWorkOrderId,
      warehouseId: formWarehouseId,
      issueDate: formIssueDate,
      receiver: formReceiver || undefined,
      remark: formRemark,
      items: formItems.map((it: IssueItemForm) => ({
        materialId: it.materialId,
        planQty: Number(it.planQty.toFixed(3)),
        actualQty: Number(it.actualQty.toFixed(3)),
      })),
    };
    try {
      if (isNew) {
        await productionApi.materialIssue.create(data);
      } else {
        await productionApi.materialIssue.update(id as string, data);
      }
      toast('保存成功');
      return true;
    } catch (e) {
      toast(errMsg(e, '保存失败'));
      return false;
    }
  };

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    const ok = await doSave();
    setSaving(false);
    if (ok) navigate(BACK_PATH);
  };

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await doSave();
    if (ok && !isNew) {
      try {
        await productionApi.materialIssue.approve(id as string);
        toast('审核成功');
        navigate(BACK_PATH);
      } catch (e) {
        toast(errMsg(e, '审核失败'));
      }
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看领料单' : isNew ? '新增领料单' : '编辑领料单';

  const headerContent = (
    <div className="grid grid-cols-3 gap-4 text-sm">
      <div>
        <label className="block text-gray-600 mb-1">领料单号</label>
        <input
          type="text"
          value={issueNo || '自动生成'}
          disabled
          className="w-full border border-gray-300 rounded px-3 py-1.5 bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">生产工单 <span className="text-red-500">*</span></label>
        <select
          value={formWorkOrderId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormWorkOrderId(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        >
          <option value="">请选择</option>
          {workOrderOptions.map((wo: { id: string; orderNo: string }) => (
            <option key={wo.id} value={wo.id}>{wo.orderNo}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-gray-600 mb-1">领料仓库 <span className="text-red-500">*</span></label>
        <select
          value={formWarehouseId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormWarehouseId(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        >
          <option value="">请选择</option>
          {warehouses.map((w: Warehouse) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-gray-600 mb-1">领料日期 <span className="text-red-500">*</span></label>
        <input
          type="date"
          value={formIssueDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormIssueDate(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">领用人</label>
        <input
          type="text"
          value={formReceiver}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormReceiver(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div />
      <div className="col-span-3">
        <label className="block text-gray-600 mb-1">备注</label>
        <textarea
          value={formRemark}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormRemark(e.target.value)}
          disabled={viewOnly}
          rows={2}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100 resize-none"
        />
      </div>
    </div>
  );

  const detailContent = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-700">明细</h2>
        {!viewOnly && (
          <button onClick={addItem} className="text-sm text-primary hover:text-blue-600">+ 添加行</button>
        )}
      </div>
      <div className="border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">物料编码</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">物料名称</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">规格</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">单位</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">计划数量</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">实领数量</th>
              {!viewOnly && <th className="text-center px-3 py-2 font-medium text-gray-600 w-16">操作</th>}
            </tr>
          </thead>
          <tbody>
            {formItems.length === 0 && (
              <tr>
                <td colSpan={viewOnly ? 6 : 7} className="text-center py-4 text-gray-400">
                  暂无明细
                </td>
              </tr>
            )}
            {formItems.map((it: IssueItemForm, i: number) => (
              <tr key={it.id} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  {viewOnly ? (
                    it.materialCode
                  ) : (
                    <select
                      value={it.materialId}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateItem(i, 'materialId', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
                    >
                      {materials.map((m: Material) => (
                        <option key={m.id} value={m.id}>{m.code}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-3 py-2">{it.materialName}</td>
                <td className="px-3 py-2">{it.spec}</td>
                <td className="px-3 py-2">{it.unit}</td>
                <td className="px-3 py-2 text-right">
                  {viewOnly ? it.planQty.toFixed(3) : (
                    <input
                      type="number"
                      step="0.001"
                      value={it.planQty}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(i, 'planQty', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right"
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {viewOnly ? it.actualQty.toFixed(3) : (
                    <input
                      type="number"
                      step="0.001"
                      value={it.actualQty}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(i, 'actualQty', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right"
                    />
                  )}
                </td>
                {!viewOnly && (
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => removeItem(i)} className="text-red-500 text-xs hover:underline">删除</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <DocPage
      title={pageTitle}
      docNo={issueNo}
      status={status}
      backPath={BACK_PATH}
      viewOnly={viewOnly}
      onSave={handleSave}
      onSubmit={!viewOnly && !isNew && status === 'draft' ? handleSubmit : undefined}
      saving={saving}
      submitting={submitting}
      header={headerContent}
    >
      {detailContent}
    </DocPage>
  );
};

export default MaterialIssueEditPage;
