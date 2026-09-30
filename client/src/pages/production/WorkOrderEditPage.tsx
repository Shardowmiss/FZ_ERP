import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import DocPage from '@client/src/components/DocPage/DocPage';
import { errMsg } from '@/utils/errMsg';

const BACK_PATH = '/production/work-order';

const WorkOrderEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [styleOptions, setStyleOptions] = useState<{ id: string; styleNo: string; name: string }[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const [formStyleId, setFormStyleId] = useState<string>('');
  const [formQuantity, setFormQuantity] = useState<number>(0);
  const [formSupplierId, setFormSupplierId] = useState<string>('');
  const [formFactoryName, setFormFactoryName] = useState<string>('');
  const [formPlanStartDate, setFormPlanStartDate] = useState<string>('');
  const [formPlanFinishDate, setFormPlanFinishDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');

  const [orderNo, setOrderNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [styles, suppliers] = await Promise.all([
          baseApi.style.options(),
          baseApi.supplier.options(),
        ]);
        setStyleOptions(styles);
        setSupplierOptions(suppliers);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  useEffect(() => {
    if (isNew) {
      setFormPlanStartDate(new Date().toISOString().slice(0, 10));
      return;
    }
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const order = await productionApi.workOrder.get(id as string);
        setOrderNo(order.orderNo);
        setStatus(order.status);
        setFormStyleId(order.styleId);
        setFormQuantity(order.quantity);
        setFormSupplierId(order.supplierId ?? '');
        setFormFactoryName(order.factoryName ?? '');
        setFormPlanStartDate(order.planStartDate ? order.planStartDate.slice(0, 10) : '');
        setFormPlanFinishDate(order.planFinishDate ? order.planFinishDate.slice(0, 10) : '');
        setFormRemark(order.remark ?? '');
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const doSave = async (): Promise<boolean> => {
    if (!formStyleId) { toast('请选择款号'); return false; }
    if (!formQuantity || formQuantity <= 0) { toast('请输入生产数量'); return false; }
    if (!formPlanStartDate) { toast('请选择预计开工日期'); return false; }
    const data = {
      styleId: formStyleId,
      quantity: Number(formQuantity),
      supplierId: formSupplierId || undefined,
      factoryName: formFactoryName || undefined,
      planStartDate: formPlanStartDate,
      planFinishDate: formPlanFinishDate || undefined,
      remark: formRemark,
    };
    try {
      if (isNew) {
        await productionApi.workOrder.create(data);
      } else {
        await productionApi.workOrder.update(id as string, data);
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
        await productionApi.workOrder.approve(id as string);
        toast('下发成功');
        navigate(BACK_PATH);
      } catch (e) {
        toast(errMsg(e, '下发失败'));
      }
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看生产工单' : isNew ? '新增生产工单' : '编辑生产工单';

  const headerContent = (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <label className="block text-gray-600 mb-1">工单号</label>
        <input
          type="text"
          value={orderNo || '自动生成'}
          disabled
          className="w-full border border-gray-300 rounded px-3 py-1.5 bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">款号 <span className="text-red-500">*</span></label>
        <select
          value={formStyleId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormStyleId(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        >
          <option value="">请选择</option>
          {styleOptions.map((s: { id: string; styleNo: string }) => (
            <option key={s.id} value={s.id}>{s.styleNo}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-gray-600 mb-1">生产数量 <span className="text-red-500">*</span></label>
        <input
          type="number"
          value={formQuantity}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormQuantity(Number(e.target.value))}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">供应商</label>
        <select
          value={formSupplierId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormSupplierId(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        >
          <option value="">请选择</option>
          {supplierOptions.map((s: { id: string; name: string }) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-gray-600 mb-1">工厂名称</label>
        <input
          type="text"
          value={formFactoryName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormFactoryName(e.target.value)}
          disabled={viewOnly}
          placeholder="供应商/工厂名称"
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">预计开工日期 <span className="text-red-500">*</span></label>
        <input
          type="date"
          value={formPlanStartDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormPlanStartDate(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">预计完工日期</label>
        <input
          type="date"
          value={formPlanFinishDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormPlanFinishDate(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div />
      <div className="col-span-2">
        <label className="block text-gray-600 mb-1">备注</label>
        <textarea
          value={formRemark}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormRemark(e.target.value)}
          disabled={viewOnly}
          rows={3}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100 resize-none"
        />
      </div>
    </div>
  );

  return (
    <DocPage
      title={pageTitle}
      docNo={orderNo}
      status={status}
      backPath={BACK_PATH}
      viewOnly={viewOnly}
      onSave={handleSave}
      onSubmit={!viewOnly && !isNew && status === 'draft' ? handleSubmit : undefined}
      saving={saving}
      submitting={submitting}
      header={headerContent}
    >
      <div className="text-center py-8 text-gray-400 text-sm">无明细</div>
    </DocPage>
  );
};

export default WorkOrderEditPage;
