import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PivotResponse, PivotRow } from '@shared/api.interface';
import { getFieldLabel, formatNumber } from './pivot-utils';

export interface PivotTableProps {
  response: PivotResponse;
  displayRows: PivotRow[];
  collapsedRows: Set<string>;
  onToggleRow: (key: string) => void;
  hasChildren: (row: PivotRow, idx: number) => boolean;
  structureKey: string;
}

export function PivotTable({
  response,
  displayRows,
  collapsedRows,
  onToggleRow,
  hasChildren,
  structureKey,
}: PivotTableProps) {
  const { colLabels, colKeys, rowFields, grandTotal } = response;
  const rowFieldCount = rowFields.length;

  return (
    <table key={structureKey} className="w-full text-sm border-collapse">
      <thead className="bg-gray-50 sticky top-0 z-10">
        {colLabels.map((levelLabels, levelIdx) => {
          const isLastLevel = levelIdx === colLabels.length - 1;
          const headerCells: React.ReactNode[] = [];
          for (let i = 0; i < rowFieldCount; i++) {
            const rf = rowFields[i];
            headerCells.push(
              <th
                key={`row-${rf}`}
                colSpan={isLastLevel ? undefined : rowFieldCount - i}
                className="px-3 py-2 font-medium text-gray-700 text-left whitespace-nowrap border-r border-gray-200 bg-gray-50"
              >
                <span>{isLastLevel ? getFieldLabel(rf) : ''}</span>
              </th>,
            );
            if (!isLastLevel) break;
          }
          levelLabels.forEach((label, idx) => {
            headerCells.push(
              <th
                key={`col-${levelIdx}-${idx}`}
                className="px-3 py-2 font-medium text-gray-700 text-right whitespace-nowrap border-r border-gray-100 bg-gray-50"
              >
                <span>{label || '-'}</span>
              </th>,
            );
          });
          return (
            <tr key={`hdr-${levelIdx}`} className="border-b border-gray-200">
              {headerCells}
            </tr>
          );
        })}
      </thead>
      <tbody>
        {displayRows.length === 0 && (
          <tr>
            <td
              colSpan={rowFieldCount + colKeys.length}
              className="text-center py-8 text-gray-400"
            >
              暂无数据
            </td>
          </tr>
        )}
        {displayRows.map((row, rowIdx) => {
          const rowKey = row.rowValues.join('|');
          const isSubtotal = row.isSubtotal;
          const isGrandTotal = row.isGrandTotal;
          const expandable = hasChildren(row, rowIdx);
          const uniqueKey = `${rowKey}-${rowIdx}-${isSubtotal ? 'sub' : ''}${isGrandTotal ? 'gt' : ''}`;

          return (
            <tr
              key={uniqueKey}
              className={`border-b border-gray-100 h-9 ${
                isGrandTotal
                  ? 'bg-blue-500 text-white font-bold'
                  : isSubtotal
                    ? 'bg-gray-100 font-semibold text-gray-700'
                    : rowIdx % 2 === 0
                      ? 'bg-white hover:bg-blue-50/50'
                      : 'bg-gray-50/30 hover:bg-blue-50/50'
              }`}
            >
              {rowFields.map((rf, rfIdx) => {
                const val = row.rowValues[rfIdx] ?? '';
                const isLastField = rfIdx === rowFieldCount - 1;
                const showExpand =
                  isLastField && expandable && !isSubtotal && !isGrandTotal;

                return (
                  <td
                    key={rf}
                    className={`px-3 whitespace-nowrap border-r border-gray-100 ${
                      isGrandTotal
                        ? 'text-white'
                        : isSubtotal
                          ? 'text-gray-700'
                          : 'text-gray-700'
                    }`}
                    style={{ paddingLeft: rfIdx * 16 + 12 }}
                  >
                    {showExpand && (
                      <button
                        onClick={() => onToggleRow(rowKey)}
                        className="mr-1 -ml-1 p-0.5 inline-block hover:bg-gray-200 rounded"
                      >
                        {collapsedRows.has(rowKey) ? (
                          <ChevronRight
                            size={12}
                            className={
                              isGrandTotal ? 'text-white' : 'text-gray-500'
                            }
                          />
                        ) : (
                          <ChevronDown
                            size={12}
                            className={
                              isGrandTotal ? 'text-white' : 'text-gray-500'
                            }
                          />
                        )}
                      </button>
                    )}
                    {val || (isSubtotal && isLastField ? '小计' : '') || '-'}
                  </td>
                );
              })}

              {colKeys.map((colKey) => {
                const cell = row.cells[colKey];
                return (
                  <td
                    key={colKey}
                    className={`px-3 text-right whitespace-nowrap border-r border-gray-100 tabular-nums ${
                      isGrandTotal
                        ? 'text-white'
                        : isSubtotal
                          ? 'text-gray-700'
                          : 'text-gray-700'
                    }`}
                  >
                    {cell ? formatNumber(cell.value) : '-'}
                  </td>
                );
              })}
            </tr>
          );
        })}

        {grandTotal && Object.keys(grandTotal).length > 0 && (
          <tr
            key="grand-total"
            className="border-t-2 border-gray-300 bg-blue-500 text-white font-bold h-10"
          >
            <td
              colSpan={rowFieldCount}
              className="px-3 text-right whitespace-nowrap border-r border-blue-400"
            >
              总计
            </td>
            {colKeys.map((colKey) => {
              const cell = grandTotal[colKey];
              return (
                <td
                  key={colKey}
                  className="px-3 text-right whitespace-nowrap border-r border-blue-400 tabular-nums"
                >
                  {cell ? formatNumber(cell.value) : '-'}
                </td>
              );
            })}
          </tr>
        )}
      </tbody>
    </table>
  );
}
