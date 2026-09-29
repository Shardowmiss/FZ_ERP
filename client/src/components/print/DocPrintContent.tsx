import React from 'react';
import { SkuMatrixTable, type SkuMatrixItem } from './SkuMatrixTable';
import { MaterialListTable, type MaterialListItem } from './MaterialListTable';
import { PrintDocHeader, PrintDocFooter } from './PrintDocLayout';

export interface SkuDocPrintProps {
  docType: string;
  docNo: string;
  docDate: string;
  partnerLabel?: string;
  partnerName?: string;
  warehouseName?: string;
  operator?: string;
  remark?: string;
  extraFields?: { label: string; value: string }[];
  items: SkuMatrixItem[];
  totalQty?: number;
  totalAmount?: number;
  showAmount?: boolean;
  signLabels?: string[];
  landscape?: boolean;
  extraSummary?: { label: string; value: string }[];
  showAllSizes?: boolean;
  allSizesByStyle?: Record<string, string[]>;
}

export const SkuDocPrintContent: React.FC<SkuDocPrintProps> = ({
  docType, docNo, docDate,
  partnerLabel = '客户', partnerName, warehouseName, operator, remark,
  extraFields = [], items, totalQty, totalAmount,
  showAmount = true, signLabels = ['制单人', '审核人', '经办人'],
  extraSummary = [],
  showAllSizes = false,
  allSizesByStyle = {},
}) => {
  const calcTotalQty = totalQty ?? items.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <div>
      <PrintDocHeader
        docType={docType}
        docNo={docNo}
        docDate={docDate}
        partnerLabel={partnerLabel}
        partnerName={partnerName}
        warehouseName={warehouseName}
        operator={operator}
        remark={remark}
        extraFields={extraFields}
      />
      <div className="print-section-title">商品明细</div>
      <SkuMatrixTable items={items} showAllSizes={showAllSizes} allSizesByStyle={allSizesByStyle} />
      <PrintDocFooter
        totalQty={calcTotalQty}
        totalAmount={totalAmount}
        showAmount={showAmount}
        signLabels={signLabels}
        extraSummary={extraSummary}
      />
    </div>
  );
};

export interface MaterialDocPrintProps {
  docType: string;
  docNo: string;
  docDate: string;
  partnerLabel?: string;
  partnerName?: string;
  warehouseName?: string;
  operator?: string;
  remark?: string;
  extraFields?: { label: string; value: string }[];
  items: MaterialListItem[];
  totalAmount?: number;
  signLabels?: string[];
  extraSummary?: { label: string; value: string }[];
}

export const MaterialDocPrintContent: React.FC<MaterialDocPrintProps> = ({
  docType, docNo, docDate,
  partnerLabel = '供应商', partnerName, warehouseName, operator, remark,
  extraFields = [], items, totalAmount,
  signLabels = ['制单人', '审核人', '经办人'],
  extraSummary = [],
}) => {
  return (
    <div>
      <PrintDocHeader
        docType={docType}
        docNo={docNo}
        docDate={docDate}
        partnerLabel={partnerLabel}
        partnerName={partnerName}
        warehouseName={warehouseName}
        operator={operator}
        remark={remark}
        extraFields={extraFields}
      />
      <div className="print-section-title">物料明细</div>
      <MaterialListTable items={items} />
      <PrintDocFooter
        totalAmount={totalAmount}
        signLabels={signLabels}
        extraSummary={extraSummary}
      />
    </div>
  );
};

export default SkuDocPrintContent;
