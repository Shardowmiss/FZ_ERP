import React from 'react';

export interface MaterialListItem {
  code: string;
  name: string;
  spec?: string;
  unit: string;
  quantity: number;
  price?: number;
  amount?: number;
}

interface MaterialListProps {
  items: MaterialListItem[];
}

export const MaterialListTable: React.FC<MaterialListProps> = ({ items }) => {
  const totalQty = items.reduce((sum: number, it: MaterialListItem) => sum + (it.quantity || 0), 0);
  const totalAmount = items.reduce((sum: number, it: MaterialListItem) => sum + (it.amount || 0), 0);

  return (
    <table className="print-list-table">
      <thead>
        <tr>
          <th style={{ width: '8%' }}>序号</th>
          <th style={{ width: '15%' }}>物料编码</th>
          <th style={{ width: '25%' }}>物料名称</th>
          <th style={{ width: '12%' }}>规格</th>
          <th style={{ width: '8%' }}>单位</th>
          <th style={{ width: '10%' }}>数量</th>
          <th style={{ width: '12%' }}>单价</th>
          <th style={{ width: '10%' }}>金额</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item: MaterialListItem, idx: number) => (
          <tr key={idx}>
            <td className="print-td-center">{idx + 1}</td>
            <td>{item.code}</td>
            <td>{item.name}</td>
            <td>{item.spec || '-'}</td>
            <td className="print-td-center">{item.unit}</td>
            <td className="print-td-right">{item.quantity}</td>
            <td className="print-td-right">{item.price?.toFixed(2) || '-'}</td>
            <td className="print-td-right">{item.amount?.toFixed(2) || '-'}</td>
          </tr>
        ))}
        <tr className="print-tr-total">
          <td colSpan={5} className="print-td-right"><strong>合计</strong></td>
          <td className="print-td-right"><strong>{totalQty}</strong></td>
          <td />
          <td className="print-td-right"><strong>{totalAmount.toFixed(2)}</strong></td>
        </tr>
      </tbody>
    </table>
  );
};

export default MaterialListTable;
