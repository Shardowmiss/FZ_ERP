import { useState, useEffect } from 'react';
import {
  Crown,
  Phone,
  CalendarDays,
  Sparkles,
  Wallet,
  Ticket,
  Receipt,
  TrendingUp,
  ShoppingBag,
  User,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import * as membersApi from '@client/src/api/members';
import type {
  Member,
  PointsLog,
  StoredLog,
  Coupon,
  SaleOrder,
} from '@shared/api.interface';

interface MemberDetailPanelProps {
  memberId: string;
}

const levelBadgeClass: Record<string, string> = {
  normal: 'bg-pos-paper text-pos-ink-2',
  silver: 'bg-pos-info-bg text-pos-info',
  gold: 'bg-pos-warn-bg text-pos-warn',
  black: 'bg-pos-accent-light text-pos-accent font-medium',
};

const levelLabelMap: Record<string, string> = {
  normal: '普通会员',
  silver: '银卡会员',
  gold: '金卡会员',
  black: '黑卡会员',
};

const pointsTypeLabel: Record<string, string> = {
  earn: '消费获赠',
  spend: '积分抵扣',
  recharge: '充值赠送',
  adjust: '积分调整',
  exchange: '积分兑换',
};

const storedTypeLabel: Record<string, string> = {
  recharge: '储值充值',
  consume: '消费使用',
  refund: '退款退回',
  gift: '充值赠送',
  adjust: '储值调整',
};

export default function MemberDetailPanel({
  memberId,
}: MemberDetailPanelProps) {
  const [member, setMember] = useState<Member | null>(null);
  const [pointsLog, setPointsLog] = useState<PointsLog[]>([]);
  const [storedLog, setStoredLog] = useState<StoredLog[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'points' | 'stored' | 'coupons' | 'orders'>(
    'points',
  );

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        const [m, p, s, c, o] = await Promise.all([
          membersApi.getMemberById(memberId),
          membersApi.getPointsLog(memberId, 1, 10),
          membersApi.getStoredLog(memberId, 1, 10),
          membersApi.getCoupons(memberId),
          membersApi.getMemberOrders(memberId, 1, 5),
        ]);
        setMember(m);
        setPointsLog(p.items ?? []);
        setStoredLog(s.items ?? []);
        setCoupons(c.filter((cp: Coupon) => cp.status === 'available'));
        setOrders(o.items ?? []);
      } catch (error) {
        logger.error('load member detail failed', error as Error);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, [memberId]);

  if (loading) {
    return (
      <div className="py-12 text-center text-pos-ink-3 text-sm">加载中...</div>
    );
  }

  if (!member) {
    return (
      <div className="py-12 text-center text-pos-ink-3 text-sm">
        会员信息加载失败
      </div>
    );
  }

  const avgOrderValue =
    member.totalCount > 0 ? member.totalSpent / member.totalCount : 0;

  return (
    <div className="flex flex-col max-h-[90vh]">
      {/* Header */}
      <div className="px-6 py-5 border-b border-pos-line flex-shrink-0">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-pos-accent-light flex items-center justify-center text-pos-accent text-lg font-semibold flex-shrink-0">
            {member.name?.charAt(0) || '会'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-pos-ink truncate">
                {member.name || '未命名会员'}
              </h2>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                   levelBadgeClass[member.level] ||
                 'bg-pos-paper text-pos-ink-2'
                }`}
              >
                <Crown size={10} className="mr-1" />
                {levelLabelMap[member.level] || member.level}
              </span>
            </div>
            <div className="text-xs text-pos-ink-3 mt-1 flex items-center gap-3 tabular-nums">
              <span>{member.memberNo}</span>
              <span className="flex items-center gap-1">
                <Phone size={12} /> {member.phone}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {/* Basic Info */}
        <section>
          <h3 className="text-sm font-medium text-pos-ink mb-3 flex items-center gap-1.5">
            <User size={14} className="text-pos-accent" />
            基本信息
          </h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <InfoItem label="会员号" value={member.memberNo} />
            <InfoItem label="手机号" value={member.phone} />
            <InfoItem
              label="性别"
              value={member.gender || '未填写'}
            />
            <InfoItem
              label="生日"
              value={member.birthday || '未填写'}
            />
            <InfoItem
              label="偏好尺码"
              value={member.preferSize || '未填写'}
            />
            <InfoItem
              label="偏好风格"
              value={member.preferStyle || '未填写'}
            />
            <InfoItem
              label="注册时间"
              value={new Date(member.createdAt).toLocaleDateString('zh-CN')}
            />
          </div>
        </section>

        {/* Consumption Overview */}
        <section>
          <h3 className="text-sm font-medium text-pos-ink mb-3 flex items-center gap-1.5">
            <TrendingUp size={14} className="text-pos-accent" />
            消费概览
          </h3>
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="消费总额"
              value={`¥${member.totalSpent.toLocaleString()}`}
              accent
            />
            <StatCard label="消费件数" value={String(member.totalCount)} />
            <StatCard
              label="客单价"
              value={`¥${avgOrderValue.toFixed(0)}`}
            />
            <StatCard
              label="最近消费"
              value={
                member.lastPurchaseAt
                  ? new Date(member.lastPurchaseAt)
                      .toLocaleDateString('zh-CN')
                      .replace(/\//g, '.')
                  : '—'
              }
            />
          </div>
        </section>

        {/* Preference Analysis */}
        <section>
          <h3 className="text-sm font-medium text-pos-ink mb-3 flex items-center gap-1.5">
            <Sparkles size={14} className="text-pos-accent" />
            偏好分析
          </h3>
          <div className="bg-pos-paper rounded-lg p-3 space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-pos-ink-3 w-16">常用尺码</span>
              <span className="text-pos-ink font-medium">
                {member.preferSize || '暂无数据'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-pos-ink-3 w-16">偏好风格</span>
              <span className="text-pos-ink font-medium">
                {member.preferStyle || '暂无数据'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-pos-ink-3 w-16">偏好颜色</span>
              <span className="text-pos-ink-3">需分析历史消费</span>
            </div>
          </div>
        </section>

        {/* Points + Stored Value + Coupons + Orders Tabs */}
        <section>
          <div className="flex items-center gap-4 border-b border-pos-line mb-3">
            <TabButton
              active={activeTab === 'points'}
              onClick={() => setActiveTab('points')}
              icon={<Sparkles size={12} />}
              label={`积分 ${member.points.toLocaleString()}`}
            />
            <TabButton
              active={activeTab === 'stored'}
              onClick={() => setActiveTab('stored')}
              icon={<Wallet size={12} />}
              label={`储值 ¥${member.storedValue.toFixed(2)}`}
            />
            <TabButton
              active={activeTab === 'coupons'}
              onClick={() => setActiveTab('coupons')}
              icon={<Ticket size={12} />}
              label={`优惠券 ${coupons.length}`}
            />
            <TabButton
              active={activeTab === 'orders'}
              onClick={() => setActiveTab('orders')}
              icon={<ShoppingBag size={12} />}
              label="历史单据"
            />
          </div>

          {activeTab === 'points' && (
            <LogList
              items={pointsLog.map((l) => ({
                id: l.id,
                title: pointsTypeLabel[l.type] || l.type,
                subtitle: l.remark || '',
                amount: `${l.change > 0 ? '+' : ''}${l.change}`,
                positive: l.change > 0,
                time: new Date(l.createdAt).toLocaleDateString('zh-CN'),
                extra: `余额: ${l.balance.toLocaleString()}`,
              }))}
              emptyText="暂无积分流水"
              unit="分"
            />
          )}

          {activeTab === 'stored' && (
            <LogList
              items={storedLog.map((l) => ({
                id: l.id,
                title: storedTypeLabel[l.type] || l.type,
                subtitle: l.remark || '',
                amount: `${l.change > 0 ? '+' : ''}¥${l.change.toFixed(2)}`,
                positive: l.change > 0,
                time: new Date(l.createdAt).toLocaleDateString('zh-CN'),
                extra: `余额: ¥${l.balance.toFixed(2)}`,
              }))}
              emptyText="暂无储值流水"
            />
          )}

          {activeTab === 'coupons' && (
            <div className="space-y-2">
              {coupons.length === 0 ? (
                <div className="text-center text-pos-ink-3 text-xs py-6">
                  暂无可用优惠券
                </div>
              ) : (
                coupons.map((c: Coupon) => (
                  <div
                    key={c.id}
                     className="flex items-center justify-between p-3 bg-pos-paper rounded-lg"
                   >
                     <div className="flex items-center gap-3">
                       <div className="w-12 h-12 rounded-md bg-pos-accent-light flex items-center justify-center flex-shrink-0">
                        <Ticket size={18} className="text-pos-accent" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-pos-ink">
                          {c.name}
                        </div>
                        <div className="text-xs text-pos-ink-3 mt-0.5">
                          {c.validFrom && c.validTo
                            ? `${c.validFrom} 至 ${c.validTo}`
                            : '长期有效'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-pos-accent font-bold tabular-nums">
                        {c.type === 'discount'
                          ? `${c.discountValue}折`
                          : `¥${c.discountValue}`}
                      </div>
                      {c.minAmount > 0 && (
                        <div className="text-xs text-pos-ink-3 tabular-nums">
                          满¥{c.minAmount}可用
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="space-y-2">
              {orders.length === 0 ? (
                <div className="text-center text-pos-ink-3 text-xs py-6">
                  暂无消费记录
                </div>
              ) : (
                orders.map((o: SaleOrder) => (
                  <div
                    key={o.id}
                     className="flex items-center justify-between p-3 bg-pos-paper rounded-lg"
                   >
                     <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-md bg-pos-paper border border-pos-line flex items-center justify-center flex-shrink-0">
                         <Receipt size={16} className="text-pos-ink-2" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-pos-ink tabular-nums">
                          {o.orderNo}
                        </div>
                        <div className="text-xs text-pos-ink-3 mt-0.5 tabular-nums">
                          {new Date(o.createdAt).toLocaleDateString(
                            'zh-CN',
                          )}{' '}
                          · {o.totalQty}件
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-pos-ink font-medium tabular-nums">
                        ¥{o.payAmount.toFixed(2)}
                      </div>
                      <div className="text-xs text-pos-ok">{o.status === 'completed' ? '已完成' : o.status}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-pos-ink-3 mb-0.5">{label}</div>
      <div className="text-pos-ink font-medium tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-pos-paper rounded-lg p-3 text-center">
      <div
        className={`text-base font-bold tabular-nums ${
          accent ? 'text-pos-accent' : 'text-pos-ink'
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-pos-ink-3 mt-1">{label}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pb-2 text-xs flex items-center gap-1.5 border-b-2 transition-colors -mb-px ${
        active
          ? 'text-pos-accent border-pos-accent font-medium'
          : 'text-pos-ink-3 border-transparent hover:text-pos-ink-2'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface LogItem {
  id: string;
  title: string;
  subtitle: string;
  amount: string;
  positive: boolean;
  time: string;
  extra: string;
}

function LogList({
  items,
  emptyText,
  unit,
}: {
  items: LogItem[];
  emptyText: string;
  unit?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="text-center text-pos-ink-3 text-xs py-6">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between py-2 border-b border-pos-line-soft last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-sm text-pos-ink">{item.title}</div>
            <div className="text-xs text-pos-ink-3 mt-0.5 flex items-center gap-2 tabular-nums">
              <span>{item.time}</span>
              {item.extra && <span>· {item.extra}</span>}
            </div>
          </div>
          <div
            className={`text-sm font-medium tabular-nums flex-shrink-0 ${
              item.positive ? 'text-pos-ok' : 'text-pos-danger'
            }`}
          >
            {item.amount}
            {unit && (
              <span className="text-xs font-normal ml-0.5">{unit}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
