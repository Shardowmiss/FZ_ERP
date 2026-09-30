import { useState, useEffect, useRef } from 'react';
import {
  Search,
  ArrowDownToLine,
  FileText,
  ClipboardList,
  SlidersHorizontal,
  Loader2,
  Package,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { errMsg } from '@client/src/lib/errMsg';
import { useOffline } from '@client/src/contexts/OfflineContext';
import OfflineBanner from '@client/src/components/ui/offline-banner';
import * as masterDataApi from '@client/src/api/master-data';
import * as stockApi from '@client/src/api/stock';
import * as inventoryApi from '@client/src/api/inventory';
import type {
  Style,
  StockMatrix,
  Transfer,
  TransferRequest,
  Stocktake,
  StockAdjustment,
} from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import StockMatrixTable from './StockMatrixTable';
import ListTable, {
  getStatusClass,
  formatDateTime,
  getStatusLabel,
} from './InventoryListTable';
import { CreateReqDialog, CreateStocktakeDialog } from './InventoryDialogs';

const tabs = [
  { key: 'query', label: '库存查询', icon: Search },
  { key: 'receive', label: '收货入库', icon: ArrowDownToLine },
  { key: 'requisition', label: '要货申请', icon: FileText },
  { key: 'stocktake', label: '盘点', icon: ClipboardList },
  { key: 'adjust', label: '库存调整', icon: SlidersHorizontal },
];

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState('query');

  // 离线状态
  const offline = useOffline();
  const isOffline = offline.effectivelyOffline;

  // Tab1: 库存查询
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<Style[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<Style | null>(null);
  const [stockMatrix, setStockMatrix] = useState<StockMatrix | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tab2~5: 列表数据
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transferReqs, setTransferReqs] = useState<TransferRequest[]>([]);
  const [transferReqsLoading, setTransferReqsLoading] = useState(false);
  const [reqDialogOpen, setReqDialogOpen] = useState(false);
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([]);
  const [stocktakesLoading, setStocktakesLoading] = useState(false);
  const [stocktakeDialogOpen, setStocktakeDialogOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);
  // 四个列表各自的加载失败原因：此前 catch 只写日志，失败时表格落到空态，
  // 与「真的没有单据」不可区分，也没有重试入口。
  const [transfersError, setTransfersError] = useState<string | null>(null);
  const [transferReqsError, setTransferReqsError] = useState<string | null>(null);
  const [stocktakesError, setStocktakesError] = useState<string | null>(null);
  const [adjustmentsError, setAdjustmentsError] = useState<string | null>(null);

  // Tab1: 搜索款式（防抖）
  useEffect(() => {
    if (!searchKeyword.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await masterDataApi.getStyles({
          keyword: searchKeyword,
          page: 1,
          pageSize: 20,
        });
        setSearchResults(res.items);
        setShowDropdown(true);
      } catch (error) {
        logger.error('search styles failed', error as Error);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchKeyword]);

  // Tab1: 选中款式加载矩阵
  useEffect(() => {
    if (!selectedStyle) {
      setStockMatrix(null);
      return;
    }
    let cancelled = false;
    setMatrixLoading(true);
    stockApi
      .getStockMatrix(selectedStyle.id)
      .then((data) => {
        if (!cancelled) setStockMatrix(data);
      })
      .catch((error) => {
        logger.error('load stock matrix failed', error as Error);
      })
      .finally(() => {
        if (!cancelled) setMatrixLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStyle]);

  // 切换 tab 时加载对应数据
  useEffect(() => {
    if (activeTab === 'receive') loadTransfers();
    if (activeTab === 'requisition') loadTransferRequests();
    if (activeTab === 'stocktake') loadStocktakes();
    if (activeTab === 'adjust') loadAdjustments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const LIST_PARAMS = { page: 1, pageSize: 50 };
  const loadTransfers = async () => {
    setTransfersLoading(true);
    setTransfersError(null);
    try {
      const res = await inventoryApi.getTransfers(LIST_PARAMS);
      setTransfers(res.items);
    } catch (e) {
      logger.error('load transfers failed', e as Error);
      setTransfersError(errMsg(e, '收货单加载失败'));
    } finally { setTransfersLoading(false); }
  };
  const loadTransferRequests = async () => {
    setTransferReqsLoading(true);
    setTransferReqsError(null);
    try {
      const res = await inventoryApi.getTransferRequests(LIST_PARAMS);
      setTransferReqs(res.items);
    } catch (e) {
      logger.error('load transfer requests failed', e as Error);
      setTransferReqsError(errMsg(e, '要货申请加载失败'));
    } finally { setTransferReqsLoading(false); }
  };
  const loadStocktakes = async () => {
    setStocktakesLoading(true);
    setStocktakesError(null);
    try {
      const res = await inventoryApi.getStocktakes(LIST_PARAMS);
      setStocktakes(res.items);
    } catch (e) {
      logger.error('load stocktakes failed', e as Error);
      setStocktakesError(errMsg(e, '盘点单加载失败'));
    } finally { setStocktakesLoading(false); }
  };
  const loadAdjustments = async () => {
    setAdjustmentsLoading(true);
    setAdjustmentsError(null);
    try {
      const res = await inventoryApi.getAdjustments(LIST_PARAMS);
      setAdjustments(res.items);
    } catch (e) {
      logger.error('load adjustments failed', e as Error);
      setAdjustmentsError(errMsg(e, '调整单加载失败'));
    } finally { setAdjustmentsLoading(false); }
  };

  const handleSelectStyle = (style: Style) => {
    setSelectedStyle(style);
    setSearchKeyword(style.name);
    setShowDropdown(false);
  };

  const handleConfirmReceipt = async (item: Transfer) => {
    try {
      if (isOffline) {
        const clientId = await offline.createOfflineReceipt({
          transferId: item.id,
          transferNo: item.transferNo,
          fromLocation: item.fromLocation,
          totalQty: item.totalQty,
          items: [],
        });
        toast.success('离线暂存 · 联网后自动上传', {
          description: `收货单 ${item.transferNo}（临时号 ${clientId.slice(-8)}）`,
        });
        return;
      }
      await inventoryApi.receiveTransfer(item.id, { items: [] });
      loadTransfers();
    } catch (error) {
      logger.error('confirm receipt failed', error as Error);
      toast.error(errMsg(error, '收货确认失败'));
    }
  };

  const renderQueryTab = () => (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-pos-line shadow-sm p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3 pointer-events-none"
            />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="输入款号 / 品名查询库存"
              className="w-full h-10 pl-9 pr-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors"
            />
            {searchLoading && (
              <Loader2
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-pos-ink-3 animate-spin"
              />
            )}
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-pos-line rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
                {searchResults.map((style) => (
                  <div
                    key={style.id}
                    onMouseDown={() => handleSelectStyle(style)}
                    className="px-3 py-2 text-sm hover:bg-pos-paper cursor-pointer border-b border-pos-line-soft last:border-0"
                  >
                    <div className="text-pos-ink font-medium">
                      {style.id} · {style.name}
                    </div>
                    <div className="text-xs text-pos-ink-3">
                      {style.category} · 吊牌价 ¥{style.tagPrice}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            onClick={() => {
              if (searchResults.length > 0) handleSelectStyle(searchResults[0]);
            }}
          >
            查询
          </Button>
          <Button variant="secondary">高级筛选</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
        {matrixLoading ? (
          <div className="p-10 text-center text-pos-ink-3">
            <Loader2 size={24} className="animate-spin mx-auto mb-2" />
            加载库存矩阵中...
          </div>
        ) : stockMatrix ? (
          <div className="p-4">
            <StockMatrixTable
              matrix={stockMatrix}
              tagPrice={selectedStyle?.tagPrice}
            />
          </div>
        ) : selectedStyle ? (
          <div className="p-10 text-center text-pos-ink-3">
            <Package size={32} className="mx-auto mb-2 opacity-30" />
            暂无库存数据
          </div>
        ) : (
          <div className="p-10 text-center text-pos-ink-3">
            <Search size={32} className="mx-auto mb-2 opacity-30" />
            请输入款号或品名进行查询
          </div>
        )}
      </div>
    </div>
  );

  const renderReceiveTab = () => (
    <ListTable<Transfer>
      title="收货入库单"
      items={transfers}
      loading={transfersLoading}
      error={transfersError}
      onRetry={() => void loadTransfers()}
      emptyText="暂无收货单"
      headerKeys={[
        { key: '单号' },
        { key: '类型' },
        { key: '来源' },
        { key: '数量', align: 'right' as const },
        { key: '时间' },
        { key: '状态' },
      ]}
      actionLabel="确认收货"
      onAction={handleConfirmReceipt}
      actionDisabled={(item) =>
        item.status === 'received' || item.status === 'completed'
      }
      renderRow={(item) => (
        <>
          <td className="px-4 py-3 font-medium text-pos-ink">
            {item.transferNo}
          </td>
          <td className="px-4 py-3 text-pos-ink-2">{item.type}</td>
          <td className="px-4 py-3 text-pos-ink-2">
            {item.fromLocation || '-'}
          </td>
          <td className="px-4 py-3 text-right text-pos-ink tabular-nums">
            {item.totalQty}
          </td>
          <td className="px-4 py-3 text-pos-ink-3">
            {formatDateTime(item.createdAt)}
          </td>
          <td className="px-4 py-3">
            <span className={`text-xs ${getStatusClass(item.status)}`}>
              {getStatusLabel(item.status)}
            </span>
          </td>
        </>
      )}
    />
  );

  const renderRequisitionTab = () => (
    <ListTable<TransferRequest>
      title="要货申请单"
      items={transferReqs}
      loading={transferReqsLoading}
      error={transferReqsError}
      onRetry={() => void loadTransferRequests()}
      emptyText="暂无要货申请"
      headerKeys={[
        { key: '单号' },
        { key: '数量', align: 'right' as const },
        { key: '申请人' },
        { key: '时间' },
        { key: '状态' },
      ]}
      onCreate={() => setReqDialogOpen(true)}
      createLabel="新建申请"
      renderRow={(item) => (
        <>
          <td className="px-4 py-3 font-medium text-pos-ink">{item.reqNo}</td>
          <td className="px-4 py-3 text-right text-pos-ink tabular-nums">
            {item.totalQty}
          </td>
          <td className="px-4 py-3 text-pos-ink-2">
            {item.employeeName || '-'}
          </td>
          <td className="px-4 py-3 text-pos-ink-3">
            {formatDateTime(item.createdAt)}
          </td>
          <td className="px-4 py-3">
            <span className={`text-xs ${getStatusClass(item.status)}`}>
              {getStatusLabel(item.status)}
            </span>
          </td>
        </>
      )}
    />
  );

  const renderStocktakeTab = () => (
    <ListTable<Stocktake>
      title="盘点单"
      items={stocktakes}
      loading={stocktakesLoading}
      error={stocktakesError}
      onRetry={() => void loadStocktakes()}
      emptyText="暂无盘点单"
      headerKeys={[
        { key: '单号' },
        { key: '类型' },
        { key: '数量', align: 'right' as const },
        { key: '差异', align: 'right' as const },
        { key: '时间' },
        { key: '状态' },
      ]}
      onCreate={() => setStocktakeDialogOpen(true)}
      createLabel="新建盘点"
      renderRow={(item) => (
        <>
          <td className="px-4 py-3 font-medium text-pos-ink">
            {item.stocktakeNo}
          </td>
          <td className="px-4 py-3 text-pos-ink-2">{item.type}</td>
          <td className="px-4 py-3 text-right text-pos-ink tabular-nums">
            {item.totalQty}
          </td>
          <td
            className={`px-4 py-3 text-right tabular-nums font-medium ${
              item.diffQty === 0
                ? 'text-pos-ink-3'
                : item.diffQty > 0
                ? 'text-pos-ok'
                : 'text-pos-danger'
            }`}
          >
            {item.diffQty > 0 ? `+${item.diffQty}` : item.diffQty}
          </td>
          <td className="px-4 py-3 text-pos-ink-3">
            {formatDateTime(item.createdAt)}
          </td>
          <td className="px-4 py-3">
            <span className={`text-xs ${getStatusClass(item.status)}`}>
              {getStatusLabel(item.status)}
            </span>
          </td>
        </>
      )}
    />
  );

  const renderAdjustTab = () => (
    <ListTable<StockAdjustment>
      title="库存调整单"
      items={adjustments}
      loading={adjustmentsLoading}
      error={adjustmentsError}
      onRetry={() => void loadAdjustments()}
      emptyText="暂无调整单"
      headerKeys={[
        { key: '单号' },
        { key: '类型' },
        { key: '原因' },
        { key: '数量', align: 'right' as const },
        { key: '金额', align: 'right' as const },
        { key: '时间' },
        { key: '状态' },
      ]}
      renderRow={(item) => (
        <>
          <td className="px-4 py-3 font-medium text-pos-ink">
            {item.adjustNo}
          </td>
          <td className="px-4 py-3 text-pos-ink-2">{item.type}</td>
          <td className="px-4 py-3 text-pos-ink-2">{item.reason || '-'}</td>
          <td className="px-4 py-3 text-right text-pos-ink tabular-nums">
            {item.totalQty > 0 ? `+${item.totalQty}` : item.totalQty}
          </td>
          <td className="px-4 py-3 text-right text-pos-ink font-medium tabular-nums">
            ¥{Math.abs(item.totalAmount).toLocaleString()}
          </td>
          <td className="px-4 py-3 text-pos-ink-3">
            {formatDateTime(item.createdAt)}
          </td>
          <td className="px-4 py-3">
            <span className={`text-xs ${getStatusClass(item.status)}`}>
              {getStatusLabel(item.status)}
            </span>
          </td>
        </>
      )}
    />
  );

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-pos-ink">门店库存</h1>
          <p className="text-xs text-pos-ink-3 mt-0.5">运营 / 门店库存</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-pos-ink-3">门店库存总值</span>
          <span className="text-base font-semibold text-pos-accent tabular-nums">
            ¥1,286,540
          </span>
        </div>
      </header>

      <OfflineBanner isOffline={isOffline} pendingCount={offline.pendingCount} />

      <div className="px-5 py-2 bg-white border-b border-pos-line flex-shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm rounded-t-lg transition-colors flex items-center gap-1.5 border-b-2 ${
                  activeTab === tab.key
                    ? 'text-pos-accent font-medium border-pos-accent bg-pos-paper/30'
                    : 'text-pos-ink-3 hover:text-pos-ink border-transparent hover:border-pos-line-soft'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'query' && renderQueryTab()}
        {activeTab === 'receive' && renderReceiveTab()}
        {activeTab === 'requisition' && renderRequisitionTab()}
        {activeTab === 'stocktake' && renderStocktakeTab()}
        {activeTab === 'adjust' && renderAdjustTab()}
      </div>

      <CreateReqDialog
        open={reqDialogOpen}
        onOpenChange={setReqDialogOpen}
        onCreated={loadTransferRequests}
      />
      <CreateStocktakeDialog
        open={stocktakeDialogOpen}
        onOpenChange={setStocktakeDialogOpen}
        onCreated={loadStocktakes}
      />
    </div>
  );
}
