import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import { Badge } from '@client/src/components/ui/badge';
import { Switch } from '@client/src/components/ui/switch';
import { Separator } from '@client/src/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@client/src/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose,
} from '@client/src/components/ui/dialog';
import { publicTraceQrUrl } from '@client/src/api/uniqueCode';
import { hangtagApi } from '@client/src/api/hangtag';
import HangtagPreview from '@client/src/components/hangtag/HangtagPreview';
import HangtagTemplateEditor from '@client/src/components/hangtag/HangtagTemplateEditor';
import { SAMPLE_DATA, type HangtagTemplateFull } from '@client/src/components/hangtag/types';

/* ------------------------------------------------------------------ *
 * 吊牌打印页（预览 + 批量打印 + 打印日志）
 *
 * 能力：
 *  1. 选择吊牌模板
 *  2. 两种取数方式：① 导入成品采购单自动带出数量 ② 录入款号手填/批量设量
 *  3. 颜色 × 尺码 二维表编辑数量（支持"整行/整列/全部批量设量"）
 *  4. 预览吊牌版面（含唯一码占位，按配置的前缀+长度+校验位示例）
 *  5. 批量打印 → 生成打印任务与日志（日期/模板/数量/唯一码区间）
 * ------------------------------------------------------------------ */

interface GridCell {
  color: string;
  size: string;
  quantity: number;
}

interface StyleGrid {
  styleNo: string;
  styleName: string;
  colors: string[];
  sizes: string[];
  cells: GridCell[];
}

interface UniqueCodeConfig {
  enabled: boolean;
  length: number | null;
  max: number;
  prefix?: string | null;
  checksum?: boolean;
}

interface PrintResult {
  taskId: string;
  taskNo: string;
  totalQty: number;
  itemCount: number;
  includeUniqueCode: boolean;
  uniqueCodeStart: number | null;
  uniqueCodeEnd: number | null;
  sampleCodes: string[];
  uniqueCodes: string[];
}

interface LogRow {
  id: string;
  taskNo: string;
  printDate: string;
  templateName?: string;
  sourceType: string;
  sourceRef?: string;
  totalQty: number;
  itemCount: number;
  includeUniqueCode?: boolean;
  uniqueCodeStart?: number | null;
  uniqueCodeEnd?: number | null;
}

const SOURCE_LABEL: Record<string, string> = {
  purchase_order: '采购单导入',
  manual: '手工录入',
};

const HangtagPrintPage: React.FC = () => {
  const [templates, setTemplates] = useState<HangtagTemplateFull[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [cfg, setCfg] = useState<UniqueCodeConfig | null>(null);
  const [includeUniqueCode, setIncludeUniqueCode] = useState(true);

  // 取数方式
  const [sourceType, setSourceType] = useState<'purchase_order' | 'manual'>('purchase_order');
  const [orderNo, setOrderNo] = useState('');
  const [styleNo, setStyleNo] = useState('');
  const [grid, setGrid] = useState<StyleGrid | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [loadingGrid, setLoadingGrid] = useState(false);

  // 批量设量
  const [batchQty, setBatchQty] = useState('1');

  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState<PrintResult | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);

  // 模板设计器
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HangtagTemplateFull | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadMeta = useCallback(async () => {
    try {
      const [tpls, cfgRes] = await Promise.all([
        hangtagApi.listTemplates(),
        axiosForBackend.get('/api/hangtag/config'),
      ]);
      setTemplates(tpls);
      if (tpls.length) setTemplateId((prev) => prev || tpls[0].id);
      setCfg(cfgRes.data || null);
    } catch (e) {
      logger.error('加载模板/配置失败', e);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const res = await axiosForBackend.get('/api/hangtag/logs');
      setLogs(res.data || []);
    } catch (e) {
      logger.error('加载打印日志失败', e);
    }
  }, []);

  useEffect(() => {
    loadMeta();
    loadLogs();
  }, [loadMeta, loadLogs]);

  /** 生成二维表 */
  const buildGrid = async () => {
    setLoadingGrid(true);
    setResult(null);
    try {
      if (sourceType === 'purchase_order') {
        if (!orderNo.trim()) {
          toast.error('请输入成品采购单号');
          return;
        }
        const res = await axiosForBackend.post('/api/hangtag/grid/purchase-order', { orderNo: orderNo.trim() });
        const styles: StyleGrid[] = res.data?.styles || [];
        setSupplierName(res.data?.supplierName || '');
        if (!styles.length) {
          toast.error('该采购单无可用明细');
          setGrid(null);
          return;
        }
        setGrid(styles[0]);
      } else {
        if (!styleNo.trim()) {
          toast.error('请输入款号');
          return;
        }
        const res = await axiosForBackend.post('/api/hangtag/grid/style', { styleNo: styleNo.trim() });
        setGrid(res.data || null);
        setSupplierName('');
      }
    } catch (e: any) {
      logger.error('生成二维表失败', e);
      toast.error(e?.response?.data?.message || '生成二维表失败');
    } finally {
      setLoadingGrid(false);
    }
  };

  /** 单元格数量 */
  const cellKey = (color: string, size: string) => `${color}||${size}`;
  const qtyMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of grid?.cells || []) m[cellKey(c.color, c.size)] = Number(c.quantity || 0);
    return m;
  }, [grid]);

  const setQty = (color: string, size: string, qty: number) => {
    setGrid((g) => {
      if (!g) return g;
      const cells = g.cells.map((c) =>
        c.color === color && c.size === size ? { ...c, quantity: Math.max(0, Math.trunc(qty || 0)) } : c,
      );
      return { ...g, cells };
    });
  };

  /** 批量设量：all / row(按颜色) / col(按尺码) */
  const applyBatch = (scope: 'all' | 'row' | 'col', key?: string) => {
    const q = Math.max(0, Math.trunc(Number(batchQty || 0)));
    setGrid((g) => {
      if (!g) return g;
      const cells = g.cells.map((c) => {
        if (scope === 'all') return { ...c, quantity: q };
        if (scope === 'row' && c.color === key) return { ...c, quantity: q };
        if (scope === 'col' && c.size === key) return { ...c, quantity: q };
        return c;
      });
      return { ...g, cells };
    });
  };

  const totalQty = useMemo(
    () => (grid?.cells || []).reduce((s, c) => s + Number(c.quantity || 0), 0),
    [grid],
  );

  /** 当前选中的模板（含 contentConfig / styleConfig） */
  const currentTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId],
  );

  /** 唯一码示例（演示前缀 + 补零 + 校验位效果） */
  const uniqueCodeSample = useMemo(() => {
    if (!cfg?.enabled || !cfg.length) return null;
    const n = (cfg.max || 0) + 1;
    let body = String(n).padStart(cfg.length, '0');
    if (cfg.prefix) body = cfg.prefix + body;
    if (cfg.checksum) {
      let sum = 0;
      for (const ch of body) if (ch >= '0' && ch <= '9') sum += Number(ch);
      body = body + String(sum % 10);
    }
    return body;
  }, [cfg]);

  /** 批量打印 */
  const doPrint = async () => {
    if (!templateId) {
      toast.error('请选择吊牌模板');
      return;
    }
    if (!grid) {
      toast.error('请先生成二维表');
      return;
    }
    const items = grid.cells
      .filter((c) => Number(c.quantity || 0) > 0)
      .map((c) => ({
        styleNo: grid.styleNo,
        styleName: grid.styleName,
        color: c.color,
        size: c.size,
        quantity: Number(c.quantity),
      }));
    if (!items.length) {
      toast.error('请至少设置一个大于 0 的数量');
      return;
    }
    setPrinting(true);
    try {
      const res = await axiosForBackend.post('/api/hangtag/print', {
        templateId,
        sourceType,
        sourceRef: sourceType === 'purchase_order' ? orderNo.trim() : styleNo.trim(),
        items,
        includeUniqueCode: !!cfg?.enabled && includeUniqueCode,
      });
      setResult(res.data);
      toast.success(`打印成功：${res.data?.taskNo}，共 ${res.data?.totalQty} 张`);
      loadLogs();
    } catch (e: any) {
      logger.error('打印失败', e);
      toast.error(e?.response?.data?.message || '打印失败');
    } finally {
      setPrinting(false);
    }
  };

  /** 打开模板设计器（新建 / 编辑） */
  const openEditor = (tpl: HangtagTemplateFull | null) => {
    setEditingTemplate(tpl);
    setEditorOpen(true);
  };

  /** 删除当前模板（由确认弹窗的「删除」按钮触发） */
  const handleDeleteTemplate = async () => {
    if (!currentTemplate) return;
    try {
      await hangtagApi.deleteTemplate(currentTemplate.id);
      toast.success('模板已删除');
      const list = await hangtagApi.listTemplates();
      setTemplates(list);
      if (templateId === currentTemplate.id) setTemplateId(list[0]?.id || '');
    } catch (e: any) {
      logger.error('删除模板失败', e);
      toast.error(e?.response?.data?.message || '删除失败');
    } finally {
      setDeleteOpen(false);
    }
  };

  /** 保存模板后刷新列表并选中 */
  const handleSaved = async (saved: HangtagTemplateFull) => {
    const list = await hangtagApi.listTemplates();
    setTemplates(list);
    setTemplateId(saved.id);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">吊牌打印</h1>
        <div className="flex items-center gap-2 text-sm">
          {cfg?.enabled ? (
            <Badge variant="default">
              唯一码已启用（{cfg.length} 位{cfg.prefix ? ` · 前缀 ${cfg.prefix}` : ''}
              {cfg.checksum ? ' · 带校验位' : ''}）
            </Badge>
          ) : (
            <Badge variant="secondary">唯一码未启用</Badge>
          )}
          {cfg?.enabled && (
            <div className="flex items-center gap-2">
              <Label htmlFor="incUc" className="text-xs">本次打印带唯一码</Label>
              <Switch id="incUc" checked={includeUniqueCode} onCheckedChange={setIncludeUniqueCode} />
            </div>
          )}
        </div>
      </div>

      {/* 步骤 1：模板 + 取数 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border rounded-lg p-4">
        <div className="space-y-1">
          <Label>吊牌模板</Label>
          <div className="flex items-center gap-2">
            <select
              className="flex-1 border rounded-md h-9 px-2 text-sm bg-background"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">请选择模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}（{t.code}）</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => openEditor(null)}>
              新增模板
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!currentTemplate}
              onClick={() => openEditor(currentTemplate)}
            >
              编辑
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!currentTemplate}
              onClick={() => setDeleteOpen(true)}
            >
              删除
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label>取数方式</Label>
          <select
            className="w-full border rounded-md h-9 px-2 text-sm bg-background"
            value={sourceType}
            onChange={(e) => {
              setSourceType(e.target.value as 'purchase_order' | 'manual');
              setGrid(null);
            }}
          >
            <option value="purchase_order">导入成品采购单（自动带出数量）</option>
            <option value="manual">录入款号（手工设置数量）</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label>{sourceType === 'purchase_order' ? '采购单号' : '款号'}</Label>
          <div className="flex gap-2">
            <Input
              value={sourceType === 'purchase_order' ? orderNo : styleNo}
              placeholder={sourceType === 'purchase_order' ? '如 PO20260001' : '如 ST001'}
              onChange={(e) => {
                if (sourceType === 'purchase_order') setOrderNo(e.target.value);
                else setStyleNo(e.target.value);
              }}
            />
            <Button variant="outline" onClick={buildGrid} disabled={loadingGrid}>
              {loadingGrid ? '生成中…' : '生成二维表'}
            </Button>
          </div>
        </div>
      </div>

      {supplierName && (
        <div className="text-sm text-muted-foreground">供应商：{supplierName}</div>
      )}

      {/* 步骤 2：颜色 × 尺码 二维表 */}
      {grid && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="font-medium">
              {grid.styleNo} {grid.styleName && `· ${grid.styleName}`}
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">批量设量</Label>
              <Input
                className="w-20 h-8"
                value={batchQty}
                onChange={(e) => setBatchQty(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={() => applyBatch('all')}>全部应用</Button>
              <span className="text-sm text-muted-foreground">合计 {totalQty} 张</span>
            </div>
          </div>

          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background">颜色 \ 尺码</TableHead>
                  {grid.sizes.map((s) => (
                    <TableHead key={s} className="text-center">
                      <div>{s}</div>
                      <Button
                        size="sm" variant="ghost" className="h-6 px-1 text-xs"
                        onClick={() => applyBatch('col', s)}
                      >
                        整列
                      </Button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {grid.colors.map((c) => (
                  <TableRow key={c}>
                    <TableCell className="sticky left-0 bg-background font-medium">
                      <div className="flex items-center gap-1">
                        <span>{c}</span>
                        <Button
                          size="sm" variant="ghost" className="h-6 px-1 text-xs"
                          onClick={() => applyBatch('row', c)}
                        >
                          整行
                        </Button>
                      </div>
                    </TableCell>
                    {grid.sizes.map((s) => (
                      <TableCell key={s} className="text-center">
                        <Input
                          className="w-20 h-8 mx-auto text-center"
                          value={String(qtyMap[cellKey(c, s)] ?? 0)}
                          onChange={(e) => setQty(c, s, Number(e.target.value))}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Separator />

          <div className="flex justify-end gap-2">
            <Button onClick={doPrint} disabled={printing}>
              {printing ? '打印中…' : `批量打印（${totalQty} 张）`}
            </Button>
          </div>
        </div>
      )}

      {/* 吊牌预览（按所选模板布局渲染） */}
      {currentTemplate ? (
        <div className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="font-medium text-sm">吊牌预览（模板：{currentTemplate.name}）</div>
            <Button size="sm" variant="outline" onClick={() => openEditor(currentTemplate)}>
              编辑模板
            </Button>
          </div>
          <div className="overflow-auto">
            <HangtagPreview
              content={currentTemplate.contentConfig}
              style={currentTemplate.styleConfig}
              data={SAMPLE_DATA}
              maxWidth={360}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            预览使用样例数据；实际打印按取数结果（款号 / 颜色 / 尺码 / 数量 / 唯一码 / 溯源二维码）填充。
          </div>
        </div>
      ) : (
        <div className="border rounded-lg p-4 text-sm text-muted-foreground">
          请先在上方选择或新增一个吊牌模板，预览将按模板布局渲染。
        </div>
      )}

      {/* 打印结果 */}
      {result && (
        <div className="border rounded-lg p-4 space-y-3 text-sm bg-muted/30">
          <div className="font-medium">打印完成</div>
          <div>任务号：{result.taskNo}</div>
          <div>明细 {result.itemCount} 行 / 共 {result.totalQty} 张</div>
          {result.includeUniqueCode && result.uniqueCodeStart != null && (
            <div>
              唯一码区间：{result.uniqueCodeStart} ~ {result.uniqueCodeEnd}
              {result.sampleCodes?.length ? `（示例 ${result.sampleCodes.join('、')}）` : ''}
            </div>
          )}

          {/* 每件唯一码溯源二维码：消费者扫码直达公开溯源页 */}
          {result.includeUniqueCode && result.uniqueCodes?.length ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-medium">每件唯一码溯源二维码</div>
                <div className="text-xs text-muted-foreground">
                  共 {result.uniqueCodes.length} 张；点击二维码可预览公开溯源页
                </div>
              </div>
              <div
                className="grid gap-3 overflow-auto"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  maxHeight: 420,
                }}
              >
                {result.uniqueCodes.slice(0, 120).map((c) => (
                  <a
                    key={c}
                    href={`/trace/${encodeURIComponent(c)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="border rounded-md p-2 flex flex-col items-center gap-1 bg-white hover:bg-muted/50"
                    title={`溯源页 /trace/${c}`}
                  >
                    <img
                      src={publicTraceQrUrl(c, 110)}
                      alt={c}
                      style={{ width: 110, height: 110 }}
                    />
                    <div className="font-mono text-[10px] break-all text-center leading-tight">
                      {c}
                    </div>
                  </a>
                ))}
              </div>
              {result.uniqueCodes.length > 120 && (
                <div className="text-xs text-muted-foreground">
                  为保证页面性能，仅展示前 120 张二维码；完整 {result.uniqueCodes.length} 张对应唯一码区间
                  {' '}{result.uniqueCodeStart} ~ {result.uniqueCodeEnd}。
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* 打印日志 */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium">打印日志</div>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务号</TableHead>
                <TableHead>打印日期</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>来源单号/款号</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>唯一码区间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.taskNo}</TableCell>
                  <TableCell>{l.printDate}</TableCell>
                  <TableCell>{SOURCE_LABEL[l.sourceType] || l.sourceType}</TableCell>
                  <TableCell>{l.sourceRef || '-'}</TableCell>
                  <TableCell className="text-right">{l.totalQty}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.includeUniqueCode && l.uniqueCodeStart != null
                      ? `${l.uniqueCodeStart} ~ ${l.uniqueCodeEnd}`
                      : '-'}
                  </TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    暂无打印记录
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 删除模板确认弹窗 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除吊牌模板</DialogTitle>
            <DialogDescription>
              确定删除模板「{currentTemplate?.name}」？该操作不可撤销，已生成的打印记录不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">取消</Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={handleDeleteTemplate}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 模板设计器（新增 / 编辑吊牌模板） */}
      <HangtagTemplateEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        template={editingTemplate}
        onSaved={handleSaved}
      />
    </div>
  );
};

export default HangtagPrintPage;
