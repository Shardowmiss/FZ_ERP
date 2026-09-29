import React from 'react';
import { amountToChinese, formatDate } from './printUtils';

interface PrintHeaderProps {
  docType: string;
  docNo: string;
  docDate: string;
  partnerLabel?: string;
  partnerName?: string;
  partnerAddress?: string;
  warehouseName?: string;
  operator?: string;
  remark?: string;
  extraFields?: { label: string; value: string }[];
}

export const PrintDocHeader: React.FC<PrintHeaderProps> = ({
  docType,
  docNo,
  docDate,
  partnerLabel = '客户',
  partnerName,
  partnerAddress,
  warehouseName,
  operator,
  remark,
  extraFields = [],
}) => {
  return (
    <div>
      <div className="print-title">{docType}</div>
      <div className="print-doc-header">
        <div className="print-header-row">
          <div><label>单据编号：</label>{docNo}</div>
        </div>
        <div className="print-header-row">
          <div><label>单据日期：</label>{formatDate(docDate)}</div>
        </div>
        {partnerName && (
          <div className="print-header-row">
            <div><label>{partnerLabel}：</label>{partnerName}</div>
          </div>
        )}
        {warehouseName && (
          <div className="print-header-row">
            <div><label>仓库：</label>{warehouseName}</div>
          </div>
        )}
        {partnerAddress && (
          <div className="print-header-row" style={{ flex: '1 1 100%' }}>
            <div><label>地址：</label>{partnerAddress}</div>
          </div>
        )}
        {operator && (
          <div className="print-header-row">
            <div><label>经办人：</label>{operator}</div>
          </div>
        )}
        {extraFields.map((f) => (
          <div key={f.label} className="print-header-row">
            <div><label>{f.label}：</label>{f.value}</div>
          </div>
        ))}
        {remark && (
          <div className="print-header-row" style={{ flex: '1 1 100%' }}>
            <div><label>备注：</label>{remark}</div>
          </div>
        )}
      </div>
    </div>
  );
};

interface PrintFooterProps {
  totalQty?: number;
  totalAmount?: number;
  showAmount?: boolean;
  signLabels?: string[];
  extraSummary?: { label: string; value: string }[];
}

export const PrintDocFooter: React.FC<PrintFooterProps> = ({
  totalQty,
  totalAmount,
  showAmount = true,
  signLabels = ['制单人', '审核人', '经办人'],
  extraSummary = [],
}) => {
  return (
    <div className="print-footer">
      <div className="print-summary">
        {totalQty !== undefined && (
          <div className="print-summary-row">
            <span><strong>总数量：</strong>{totalQty}</span>
          </div>
        )}
        {showAmount && totalAmount !== undefined && (
          <div className="print-summary-row">
            <span><strong>总金额：</strong>￥{totalAmount.toFixed(2)}</span>
            <span className="print-amount-cn">
              <strong>大写金额：</strong>{amountToChinese(totalAmount)}
            </span>
          </div>
        )}
        {extraSummary.map((s) => (
          <div key={s.label} className="print-summary-row">
            <span><strong>{s.label}：</strong>{s.value}</span>
          </div>
        ))}
      </div>
      <div className="print-sign-row">
        {signLabels.map((label: string) => (
          <div key={label} className="print-sign-item">
            {label}：<span>&nbsp;</span>
          </div>
        ))}
      </div>
      <div className="print-meta-row">
        <span>打印日期：{new Date().toLocaleDateString('zh-CN')}</span>
        <span>第 1 页 / 共 1 页</span>
      </div>
    </div>
  );
};

export default PrintDocHeader;
