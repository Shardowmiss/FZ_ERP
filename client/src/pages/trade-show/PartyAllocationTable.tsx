import React, { useMemo } from 'react';
import type { AllocationItem, Sku } from '@shared/api.interface';

interface PartyAllocationTableProps {
  items: AllocationItem[];
  skuList: Sku[];
  partyName: string;
  partyType: string;
  editing?: boolean;
  onAllocatedChange?: (itemId: string, value: number) => void;
}

const PartyAllocationTable: React.FC<PartyAllocationTableProps> = ({
  items,
  skuList,
  partyName,
  partyType,
  editing = false,
  onAllocatedChange,
}) => {
  const colors = useMemo(
    () => Array.from(new Set(skuList.map((s) => s.color))),
    [skuList],
  );
  const sizes = useMemo(
    () => Array.from(new Set(skuList.map((s) => s.size))),
    [skuList],
  );

  const getItemByColorSize = (
    color: string,
    size: string,
  ): AllocationItem | undefined => {
    return items.find((it) => it.color === color && it.size === size);
  };

  const groupPreTotal = items.reduce((sum, it) => sum + it.preQty, 0);
  const groupAllocTotal = items.reduce((sum, it) => sum + it.allocatedQty, 0);

  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <div className="px-4 py-2 bg-blue-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700">{partyName}</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              partyType === 'dealer'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-cyan-100 text-cyan-700'
            }`}
          >
            {partyType === 'dealer' ? '经销商' : '直营店'}
          </span>
        </div>
        <div className="text-sm text-gray-600">
          预订：
          <span className="font-medium">{groupPreTotal}</span>
          {' / '}
          已分配：
          <span className="font-medium text-green-600">{groupAllocTotal}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium">
              <th className="text-left px-3 py-2 border-b border-r border-gray-200 w-20">
                颜色 / 尺码
              </th>
              {sizes.map((size) => (
                <th
                  key={size}
                  className="text-center px-2 py-2 border-b border-r border-gray-200 w-28"
                >
                  {size}
                  <div className="text-[10px] text-gray-400 font-normal">
                    预订 / 分配
                  </div>
                </th>
              ))}
              <th className="text-center px-3 py-2 border-b border-gray-200 w-24 bg-blue-50">
                合计
                <div className="text-[10px] text-gray-400 font-normal">
                  预订 / 分配
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => {
              const rowPre = sizes.reduce(
                (sum, s) =>
                  sum + (getItemByColorSize(color, s)?.preQty || 0),
                0,
              );
              const rowAlloc = sizes.reduce(
                (sum, s) =>
                  sum + (getItemByColorSize(color, s)?.allocatedQty || 0),
                0,
              );
              return (
                <tr key={color} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-700 bg-gray-50">
                    {color}
                  </td>
                  {sizes.map((size) => {
                    const it = getItemByColorSize(color, size);
                    const pre = it?.preQty || 0;
                    const alloc = it?.allocatedQty || 0;
                    return (
                      <td
                        key={size}
                        className="px-2 py-2 border-b border-r border-gray-200"
                      >
                        <div className="text-xs text-gray-500 text-center mb-1">
                          {pre}
                        </div>
                        {editing && it ? (
                          <input
                            type="number"
                            min={0}
                            value={alloc}
                            onChange={(e) =>
                              onAllocatedChange?.(
                                it.id,
                                Number(e.target.value) || 0,
                              )
                            }
                            className="w-full px-1 py-1 text-center border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                          />
                        ) : (
                          <div
                            className={`text-center font-medium ${
                              alloc > 0
                                ? 'text-green-600'
                                : 'text-gray-400'
                            }`}
                          >
                            {alloc}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 border-b border-gray-200 text-center bg-blue-50">
                    <div className="text-xs text-gray-500">{rowPre}</div>
                    <div className="font-medium text-blue-600">
                      {rowAlloc}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PartyAllocationTable;
