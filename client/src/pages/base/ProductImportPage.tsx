import React, { useState, useEffect, useRef } from 'react';
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Eye, ShieldCheck } from 'lucide-react';
import { StatusBadge } from '@client/src/components/ui/status-badge';
import {
  productImportApi,
  type ImportType,
  type RowStatusValue,
  type ValidateResult,
  type ProductImportTaskView,
  type ProductImportSummary,
} from '@client/src/api/productImport';
import { parseXlsxFile, downloadXlsx } from '@client/src/utils/excel';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { errMsg } from '@/utils/errMsg';

interface ColumnDef {
  header: string;
  field: string;
  required?: boolean;
  note?: string;
}

const STYLE_COLUMNS: ColumnDef[] = [
  { header: '款号', field: 'styleNo', required: true },
  { header: '款号名称', field: 'name', required: true },
  { header: '颜色组编码', field: 'colorGroupCode', required: true, note: '须为系统中已存在的颜色组编码' },
  { header: '尺码组编码', field: 'sizeGroupCode', required: true, note: '须为系统中已存在的尺码组编码' },
  { header: '品类', field: 'category' },
  { header: '季节', field: 'season' },
  { header: '品牌', field: 'brand' },
  { header: '波段', field: 'wave' },
  { header: '年份', field: 'year' },
  { header: '版型', field: 'fit' },
  { header: '子类', field: 'subCategory' },
  { header: '吊牌价', field: 'tagPrice' },
  { header: '成本价', field: 'costPrice' },
  { header: '供货价', field: 'supplyPrice' },
  { header: '状态', field: 'status', note: '默认 active' },
  { header: '备注', field: 'remark' },
];

const SKU_COLUMNS: ColumnDef[] = [
  { header: 'SKU编码', field: 'skuCode', required: true },
  { header: '款号', field: 'styleNo', required: true, note: '须为系统中已存在的款号' },
  { header: '颜色', field: 'color', required: true, note: '须为系统中已存在的颜色名称' },
  { header: '尺码', field: 'size', required: true, note: '须为系统中已存在的尺码名称' },
  { header: '条码', field: 'barcode' },
  { header: '成本价', field: 'costPrice' },
  { header: '吊牌价', field: 'tagPrice' },
  { header: '供货价', field: 'supplyPrice' },
  { header: '安全库存下限', field: 'safetyStockMin' },
  { header: '安全库存上限', field: 'safetyStockMax' },
  { header: '状态', field: 'status', note: '默认 active' },
];

function columnsOf(t: ImportType): ColumnDef[] {
  return t === 'style' ? STYLE_COLUMNS : SKU_COLUMNS;
}

function exampleRow(t: ImportType): (string | number)[] {
  if (t === 'style') {
    return ['STYLE-EXAMPLE', '示例款号', 'CG-EXAMPLE', 'SG-EXAMPLE', '', '2026FW', '示例品牌', 'W1', '2026', '', '', 199, 80, 100, 'active', '示例行，请删除后填写真实数据'];
  }
  return ['SKU-EXAMPLE', 'STYLE-EXAMPLE', '红色', 'M', '', 80, 199, 100, '', '', 'active'];
}

/** 把解析出的二维表头+数据映射为字段对象数组（按表头中文/英文匹配列定义） */
function buildRowsFromGrid(grid: string[][], t: ImportType): Record<string, any>[] {
  const cols = columnsOf(t);
  const header = grid[0] || [];
  const fieldByCol: (string | null)[] = header.map((h) => {
    const key = (h || '').trim();
    const found = cols.find((c) => c.header === key || c.field === key);
    return found ? found.field : null;
  });
  const rows: Record<string, any>[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    if (line.every((c) => !c || !c.trim())) continue; // 跳过空行
    const obj: Record<string, any> = {};
    fieldByCol.forEach((field, ci) => {
      if (!field) return;
      obj[field] = (line[ci] ?? '').trim();
    });
    rows.push(obj);
  }
  return rows;
}

const STATUS_BADGE: Record<RowStatusValue, { tone: 'ok' | 'warn' | 'danger' | 'neutral'; label: string }> = {
  ok: { tone: 'ok', label: '可导入' },
  existed: { tone: 'warn', label: '已存在' },
  unsupported: { tone: 'danger', label: '不支持' },
  missing_master: { tone: 'warn', label: '主数据缺失' },
};

const TASK_STATUS_BADGE: Record<string, { tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'info'; label: string }> = {
  draft: { tone: 'info', label: '草稿' },
  approved: { tone: 'ok', label: '已审核' },
  superseded: { tone: 'neutral', label: '已覆盖' },
};

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-base font-semibold text-gray-800">{title}</h3>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>
            <XCircle size={20} />
          </button>
        </div>
        <div className="overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const ProductImportPage: React.FC = () => {
  const [tasks, setTasks] = useState<ProductImportTaskView[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<ImportType | 'all'>('all');

  // 导入向导
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardType, setWizardType] = useState<ImportType>('style');
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, any>[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 详情
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<ProductImportTaskView | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const list = await productImportApi.list(filter === 'all' ? undefined : filter);
      setTasks(list);
    } catch (e) {
      toast(errMsg(e, '加载导入任务失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const openWizard = () => {
    setWizardType('style');
    setFileName('');
    setValidateResult(null);
    setParsedRows([]);
    setWizardOpen(true);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDownloadTemplate = () => {
    const cols = columnsOf(wizardType);
    const header = cols.map((c) => c.header);
    const rows = [header, exampleRow(wizardType)];
    const name = wizardType === 'style' ? '款号批量导入模板' : 'SKU批量导入模板';
    downloadXlsx(rows, name);
    toast.success('模板已下载，请按表头填写后导入');
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    setValidateResult(null);
    try {
      const grid = await parseXlsxFile(file);
      if (!grid.length) {
        toast.error('Excel 为空或无法解析');
        return;
      }
      const rows = buildRowsFromGrid(grid, wizardType);
      if (!rows.length) {
        toast.error('未解析到有效数据行（请确认表头与模板一致）');
        return;
      }
      setParsedRows(rows);
      const result = await productImportApi.validate(wizardType, rows);
      setValidateResult(result);
    } catch (err) {
      toast(errMsg(err, '解析 Excel 失败'));
    } finally {
      setParsing(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!parsedRows.length) {
      toast.error('没有可保存的数据');
      return;
    }
    setSubmitting(true);
    try {
      let fileMeta: { fileName: string; fileUrl?: string; filePath?: string; bucketId?: string } = {
        fileName,
      };
      // 记录原始 Excel 文件（失败不阻断，仍保存解析数据）
      try {
        const input = fileRef.current?.files?.[0];
        if (input) {
          const up = await uploadFile(input);
          fileMeta = { fileName: input.name, fileUrl: up.url, filePath: up.filePath, bucketId: up.bucketId };
        }
      } catch (upErr) {
        toast.warning('Excel 原文件上传失败，仅保存解析数据');
      }
      await productImportApi.createDraft({
        importType: wizardType,
        fileName: fileMeta.fileName,
        fileUrl: fileMeta.fileUrl,
        filePath: fileMeta.filePath,
        bucketId: fileMeta.bucketId,
        rows: parsedRows,
      });
      toast.success('已保存为草稿（可再次导入覆盖，审核后写入商品库）');
      setWizardOpen(false);
      fetchTasks();
    } catch (err) {
      toast(errMsg(err, '保存草稿失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (task: ProductImportTaskView) => {
    const ok = await showConfirm({
      title: '确认审核入库',
      message: `将把该草稿中「可导入」的 ${task.summary.ok} 行写入商品库（已存在/不支持/主数据缺失行将被跳过）。确定继续？`,
    });
    if (!ok) return;
    try {
      const updated = await productImportApi.approve(task.id);
      toast.success(`审核完成：新增 ${updated.summary.inserted} 行，跳过 ${updated.summary.skipped} 行`);
      fetchTasks();
    } catch (err) {
      toast(errMsg(err, '审核失败'));
    }
  };

  const openDetail = (task: ProductImportTaskView) => {
    setDetailTask(task);
    setDetailOpen(true);
  };

  const counts = (s: Pick<ProductImportSummary, 'total' | 'ok' | 'existed' | 'unsupported' | 'missingMasterData'>) => [
    { label: '总行数', value: s.total, tone: 'neutral' as const },
    { label: '可导入', value: s.ok, tone: 'ok' as const },
    { label: '已存在', value: s.existed, tone: 'warn' as const },
    { label: '不支持', value: s.unsupported, tone: 'danger' as const },
    { label: '主数据缺失', value: s.missingMasterData, tone: 'warn' as const },
  ];

  return (
    <div className="min-h-full bg-gray-50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">批量导入</h1>
          <p className="mt-1 text-sm text-gray-500">
            商品资料批量导入：下载 Excel 模板 → 填写并上传 → 校验 → 审核入库。后一次导入可覆盖前一次草稿。
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={openWizard}
        >
          <Upload size={16} /> 新建导入
        </button>
      </div>

      {/* 类型过滤 */}
      <div className="mb-3 flex gap-2">
        {(['all', 'style', 'sku'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              filter === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {t === 'all' ? '全部' : t === 'style' ? '款号导入' : 'SKU导入'}
          </button>
        ))}
      </div>

      {/* 任务历史 */}
      <div className="overflow-hidden rounded-lg bg-white ring-1 ring-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">导入类型</th>
              <th className="px-4 py-3 font-medium">文件名</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">统计</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  暂无导入记录
                </td>
              </tr>
            )}
            {!loading &&
              tasks.map((task) => (
                <tr key={task.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">{task.importType === 'style' ? '款号' : 'SKU'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {task.fileName || <span className="text-gray-300">—</span>}
                    {task.fileUrl && (
                      <a href={task.fileUrl} target="_blank" rel="noreferrer" className="ml-2 text-blue-600 hover:underline">
                        原文件
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={TASK_STATUS_BADGE[task.status]?.tone ?? 'neutral'}>
                      {TASK_STATUS_BADGE[task.status]?.label ?? task.status}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="text-green-600">可导入 {task.summary.ok}</span>
                    {task.summary.existed > 0 && <span className="ml-2 text-amber-600">已存在 {task.summary.existed}</span>}
                    {task.summary.unsupported > 0 && <span className="ml-2 text-red-600">不支持 {task.summary.unsupported}</span>}
                    {task.summary.missingMasterData > 0 && <span className="ml-2 text-amber-600">缺失 {task.summary.missingMasterData}</span>}
                    {task.status === 'approved' && (
                      <span className="ml-2 text-gray-500">入库 {task.summary.inserted}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(task.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="mr-3 inline-flex items-center gap-1 text-blue-600 hover:underline" onClick={() => openDetail(task)}>
                      <Eye size={14} /> 查看
                    </button>
                    {task.status === 'draft' && (
                      <button className="inline-flex items-center gap-1 text-green-600 hover:underline" onClick={() => handleApprove(task)}>
                        <ShieldCheck size={14} /> 审核
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* 导入向导 */}
      {wizardOpen && (
        <Modal
          title="新建批量导入"
          onClose={() => setWizardOpen(false)}
          footer={
            <>
              <button
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
                onClick={() => setWizardOpen(false)}
              >
                取消
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={!parsedRows.length || submitting || parsing}
                onClick={handleSaveDraft}
              >
                <FileSpreadsheet size={16} /> {submitting ? '保存中…' : '保存为草稿'}
              </button>
            </>
          }
        >
          {/* 类型选择 */}
          <div className="mb-4 flex items-center gap-3">
            <span className="text-sm text-gray-600">导入类型：</span>
            {(['style', 'sku'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setWizardType(t);
                  setValidateResult(null);
                  setParsedRows([]);
                  setFileName('');
                  if (fileRef.current) fileRef.current.value = '';
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  wizardType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === 'style' ? '款号批量导入' : 'SKU批量导入'}
              </button>
            ))}
            <button
              className="ml-auto inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-blue-600 ring-1 ring-blue-200 hover:bg-blue-50"
              onClick={handleDownloadTemplate}
            >
              <Download size={15} /> 下载导入模板
            </button>
          </div>

          {/* 必填/注意事项 */}
          <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <div className="font-medium">必填列：</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {columnsOf(wizardType)
                .filter((c) => c.required)
                .map((c) => (
                  <span key={c.field} className="font-medium">
                    {c.header}
                  </span>
                ))}
            </div>
            <div className="mt-1 space-y-0.5">
              {columnsOf(wizardType)
                .filter((c) => c.note)
                .map((c) => (
                  <div key={c.field}>
                    · {c.header}：{c.note}
                  </div>
                ))}
            </div>
          </div>

          {/* 上传 */}
          <div className="mb-4">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
              <Upload size={15} /> 选择 Excel 文件
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFile}
              />
            </label>
            {fileName && <span className="ml-3 text-sm text-gray-500">{fileName}</span>}
            {parsing && <span className="ml-3 text-sm text-blue-500">解析中…</span>}
          </div>

          {/* 校验结果 */}
          {validateResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {counts(validateResult).map((c) => (
                  <span
                    key={c.label}
                    className={`rounded-md px-3 py-1.5 text-sm ${
                      c.tone === 'ok'
                        ? 'bg-green-50 text-green-700'
                        : c.tone === 'warn'
                        ? 'bg-amber-50 text-amber-700'
                        : c.tone === 'danger'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {c.label}：<b>{c.value}</b>
                  </span>
                ))}
              </div>

              <ProblemList
                icon={<CheckCircle2 size={15} className="text-green-500" />}
                title="可导入"
                tone="green"
                rows={validateResult.rows.filter((r) => r.status === 'ok')}
                columnsOf={columnsOf}
              />
              <ProblemList
                icon={<AlertTriangle size={15} className="text-amber-500" />}
                title="已存在（将跳过，不覆盖线上数据）"
                tone="amber"
                rows={validateResult.rows.filter((r) => r.status === 'existed')}
                columnsOf={columnsOf}
              />
              <ProblemList
                icon={<XCircle size={15} className="text-red-500" />}
                title="不支持 / 格式错误"
                tone="red"
                rows={validateResult.rows.filter((r) => r.status === 'unsupported')}
                columnsOf={columnsOf}
              />
              <ProblemList
                icon={<AlertTriangle size={15} className="text-amber-500" />}
                title="主数据缺失（SKU 导入需先存在对应款号/颜色/尺码）"
                tone="amber"
                rows={validateResult.rows.filter((r) => r.status === 'missing_master')}
                columnsOf={columnsOf}
              />

              {(validateResult.unsupported > 0 || validateResult.missingMasterData > 0) && (
                <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  存在「不支持」或「主数据缺失」行，可修改 Excel 后重新上传（将覆盖本次草稿）。仅「可导入」行会在审核后写入商品库。
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* 详情 */}
      {detailOpen && detailTask && (
        <Modal title="导入明细" onClose={() => setDetailOpen(false)}>
          <div className="mb-3 flex flex-wrap gap-2">
            {counts(detailTask.summary).map((c) => (
              <span
                key={c.label}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  c.tone === 'ok'
                    ? 'bg-green-50 text-green-700'
                    : c.tone === 'warn'
                    ? 'bg-amber-50 text-amber-700'
                    : c.tone === 'danger'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {c.label}：<b>{c.value}</b>
              </span>
            ))}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">关键字段</th>
                  <th className="px-3 py-2 font-medium">说明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {detailTask.rows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td className="px-3 py-2 text-gray-500">#{r.rowIndex + 1}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.raw?.styleNo || r.raw?.skuCode || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{r.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
};

function ProblemList({
  icon,
  title,
  tone,
  rows,
  columnsOf,
}: {
  icon: React.ReactNode;
  title: string;
  tone: 'green' | 'amber' | 'red';
  rows: { rowIndex: number; raw: Record<string, any>; reason?: string }[];
  columnsOf: (t: ImportType) => ColumnDef[];
}) {
  if (!rows.length) return null;
  const keyField = (raw: Record<string, any>) => raw.styleNo || raw.skuCode || '—';
  const toneClass =
    tone === 'green' ? 'border-green-200' : tone === 'amber' ? 'border-amber-200' : 'border-red-200';
  return (
    <div className={`rounded-md border ${toneClass} bg-white p-3`}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
        {icon} {title}（{rows.length}）
      </div>
      <div className="max-h-40 space-y-1 overflow-auto text-xs text-gray-600">
        {rows.map((r) => (
          <div key={r.rowIndex} className="flex gap-2">
            <span className="shrink-0 text-gray-400">#{r.rowIndex + 1}</span>
            <span className="shrink-0 font-medium text-gray-700">{keyField(r.raw)}</span>
            <span className="text-gray-500">{r.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProductImportPage;
