import {
  X,
  ChevronDown,
  ChevronRight,
  Sigma,
  Filter,
  Rows3,
  Columns3,
  Calculator,
  Box,
  GripVertical,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type {
  PivotValueConfig,
  PivotAggType,
} from '@shared/api.interface';
import { AGG_OPTIONS } from './pivot-utils';

export type DropZone = 'filters' | 'rows' | 'cols' | 'values';

export interface DropZonePanelProps {
  title: string;
  icon: React.ReactNode;
  hint: string;
  zone: DropZone;
  items: { key: string; label: string }[];
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent, zone: DropZone) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, zone: DropZone, targetIndex: number) => void;
  onRemove: (key: string) => void;
  onDragStartFromZone: (e: React.DragEvent, key: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function DropZonePanel({
  title,
  icon,
  hint,
  zone,
  items,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemove,
  onDragStartFromZone,
  onReorder,
}: DropZonePanelProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [insertAfter, setInsertAfter] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);

  const handleItemDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    setDragOverIndex(index);
    setInsertAfter(e.clientX > midX);
    onDragOver(e, zone);
  };

  const handleZoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver(e, zone);
  };

  const handleZoneDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (zoneRef.current && related && zoneRef.current.contains(related)) return;
    setDragOverIndex(null);
    setInsertAfter(false);
    onDragLeave();
  };

  const handleZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const fromZone = e.dataTransfer.getData('fromZone') as DropZone | '';
    const targetIdx =
      dragOverIndex === null
        ? items.length
        : insertAfter
          ? dragOverIndex + 1
          : dragOverIndex;

    if (fromZone && fromZone === zone) {
      const fieldKey = e.dataTransfer.getData('fieldKey');
      const fromIdx = items.findIndex((it) => it.key === fieldKey);
      if (fromIdx >= 0) {
        let toIdx = targetIdx;
        if (fromIdx < toIdx) toIdx -= 1;
        if (fromIdx !== toIdx) onReorder(fromIdx, toIdx);
      }
    } else {
      onDrop(e, zone, targetIdx);
    }

    setDragOverIndex(null);
    setInsertAfter(false);
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-gray-500">{icon}</span>
        <span className="text-sm font-medium text-gray-700">{title}</span>
      </div>
      <div
        ref={zoneRef}
        onDragOver={handleZoneDragOver}
        onDragLeave={handleZoneDragLeave}
        onDrop={handleZoneDrop}
        className={`min-h-[60px] rounded px-2 py-1.5 border-2 border-dashed transition-colors flex flex-wrap gap-1.5 items-start content-start ${
          isDragOver
            ? 'border-primary/70 bg-blue-50'
            : 'border-gray-200 bg-gray-50/50 hover:border-gray-300'
        }`}
      >
        <div className="flex flex-wrap gap-1.5 items-center w-full">
          {items.length === 0 ? (
            <span className="text-xs text-gray-400 px-2">{hint}</span>
          ) : (
            items.map((item, index) => (
              <div key={item.key} className="relative flex items-center">
                {dragOverIndex === index && !insertAfter && (
                  <div className="absolute -left-0.5 top-0 bottom-0 w-0.5 bg-primary rounded z-10" />
                )}
                <div
                  draggable
                  onDragStart={(e) => onDragStartFromZone(e, item.key)}
                  onDragOver={(e) => handleItemDragOver(e, index)}
                  className="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs text-gray-700 cursor-grab group"
                >
                  <GripVertical
                    size={12}
                    className="text-gray-400 flex-shrink-0"
                  />
                  <span>{item.label}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(item.key);
                    }}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
                {dragOverIndex === index && insertAfter && (
                  <div className="absolute -right-0.5 top-0 bottom-0 w-0.5 bg-primary rounded z-10" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export interface ValueDropZonePanelProps {
  title: string;
  icon: React.ReactNode;
  hint: string;
  zone: DropZone;
  values: PivotValueConfig[];
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent, zone: DropZone) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, zone: DropZone, targetIndex: number) => void;
  onRemove: (key: string) => void;
  onChangeAgg: (key: string, agg: PivotAggType) => void;
  onDragStartFromZone: (e: React.DragEvent, key: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function ValueDropZonePanel({
  title,
  icon,
  hint,
  zone,
  values,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemove,
  onChangeAgg,
  onDragStartFromZone,
  onReorder,
}: ValueDropZonePanelProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [insertAfter, setInsertAfter] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);

  const handleItemDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    setDragOverIndex(index);
    setInsertAfter(e.clientX > midX);
    onDragOver(e, zone);
  };

  const handleZoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver(e, zone);
  };

  const handleZoneDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (zoneRef.current && related && zoneRef.current.contains(related)) return;
    setDragOverIndex(null);
    setInsertAfter(false);
    onDragLeave();
  };

  const handleZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const fromZone = e.dataTransfer.getData('fromZone') as DropZone | '';
    const targetIdx =
      dragOverIndex === null
        ? values.length
        : insertAfter
          ? dragOverIndex + 1
          : dragOverIndex;

    if (fromZone && fromZone === zone) {
      const fieldKey = e.dataTransfer.getData('fieldKey');
      const fromIdx = values.findIndex((v) => v.key === fieldKey);
      if (fromIdx >= 0) {
        let toIdx = targetIdx;
        if (fromIdx < toIdx) toIdx -= 1;
        if (fromIdx !== toIdx) onReorder(fromIdx, toIdx);
      }
    } else {
      onDrop(e, zone, targetIdx);
    }

    setDragOverIndex(null);
    setInsertAfter(false);
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-gray-500">{icon}</span>
        <span className="text-sm font-medium text-gray-700">{title}</span>
      </div>
      <div
        ref={zoneRef}
        onDragOver={handleZoneDragOver}
        onDragLeave={handleZoneDragLeave}
        onDrop={handleZoneDrop}
        className={`min-h-[60px] rounded px-2 py-1.5 border-2 border-dashed transition-colors flex flex-wrap gap-1.5 items-start content-start ${
          isDragOver
            ? 'border-green-400 bg-green-50'
            : 'border-gray-200 bg-gray-50/50 hover:border-gray-300'
        }`}
      >
        <div className="flex flex-wrap gap-1.5 items-center w-full">
          {values.length === 0 ? (
            <span className="text-xs text-gray-400 px-2">{hint}</span>
          ) : (
            values.map((v, index) => (
              <div key={v.key} className="relative flex items-center">
                {dragOverIndex === index && !insertAfter && (
                  <div className="absolute -left-0.5 top-0 bottom-0 w-0.5 bg-primary rounded z-10" />
                )}
                <div
                  draggable
                  onDragStart={(e) => onDragStartFromZone(e, v.key)}
                  onDragOver={(e) => handleItemDragOver(e, index)}
                  className="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs text-gray-700 cursor-grab"
                >
                  <GripVertical
                    size={12}
                    className="text-gray-400 flex-shrink-0"
                  />
                  <Sigma size={12} className="text-green-600" />
                  <span>{v.label}</span>
                  <select
                    value={v.agg}
                    onChange={(e) =>
                      onChangeAgg(v.key, e.target.value as PivotAggType)
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="border border-gray-200 rounded px-1 py-0.5 text-xs bg-gray-50 focus:outline-none focus:border-primary/70"
                  >
                    {AGG_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(v.key);
                    }}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
                {dragOverIndex === index && insertAfter && (
                  <div className="absolute -right-0.5 top-0 bottom-0 w-0.5 bg-primary rounded z-10" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface FieldPanelProps {
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onDragStart: (e: React.DragEvent, fieldKey: string) => void;
  onRemoveFromZone?: (zone: DropZone, fieldKey: string) => void;
  dimensionGroups: { key: string; label: string; fields: string[] }[];
  dimensionFields: {
    key: string;
    label: string;
    type: string;
    category: string;
  }[];
  measureFields: {
    key: string;
    label: string;
    type: string;
    category: string;
  }[];
}

export function FieldPanel({
  collapsedGroups,
  onToggleGroup,
  onDragStart,
  onRemoveFromZone,
  dimensionGroups,
  dimensionFields,
  measureFields,
}: FieldPanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handlePanelDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const fromZone = e.dataTransfer.getData('fromZone');
    if (fromZone) setIsDragOver(true);
  };

  const handlePanelDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    const target = e.currentTarget as HTMLElement;
    if (related && target.contains(related)) return;
    setIsDragOver(false);
  };

  const handlePanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fieldKey = e.dataTransfer.getData('fieldKey');
    const fromZone = e.dataTransfer.getData('fromZone') as DropZone | '';
    setIsDragOver(false);
    if (fromZone && fieldKey && onRemoveFromZone) {
      onRemoveFromZone(fromZone, fieldKey);
    }
  };

  return (
    <div
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
      className={`w-[220px] flex-shrink-0 bg-white rounded border flex flex-col overflow-hidden transition-colors ${
        isDragOver ? 'border-red-400 bg-red-50/30' : 'border-gray-200'
      }`}
      style={{ minHeight: 0 }}
    >
      <div className="px-3 py-2.5 border-b border-gray-200 bg-gray-50">
        <span className="text-sm font-medium text-gray-700">
          字段列表
          {isDragOver && (
            <span className="ml-2 text-xs text-red-500">拖回此处删除</span>
          )}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {dimensionGroups.map((group) => (
          <div key={group.key} className="mb-1">
            <div
              className="flex items-center gap-1 px-2 py-1.5 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50 rounded"
              onClick={() => onToggleGroup(group.key)}
            >
              {collapsedGroups[group.key] ? (
                <ChevronRight size={14} className="text-gray-400" />
              ) : (
                <ChevronDown size={14} className="text-gray-400" />
              )}
              <Box size={14} className="text-primary" />
              <span>{group.label}</span>
            </div>
            <AnimatePresence initial={false}>
              {!collapsedGroups[group.key] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="pl-6 pr-1 py-1 space-y-1">
                    {group.fields.map((fieldKey) => {
                      const field = dimensionFields.find(
                        (f) => f.key === fieldKey,
                      );
                      if (!field) return null;
                      return (
                        <div
                          key={fieldKey}
                          draggable
                          onDragStart={(e) => onDragStart(e, fieldKey)}
                          className="flex items-center gap-1 px-2 py-1 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded text-xs text-gray-700 cursor-grab active:cursor-grabbing transition-colors"
                        >
                          <GripVertical
                            size={12}
                            className="text-gray-400 flex-shrink-0"
                          />
                          <Box
                            size={12}
                            className="text-primary flex-shrink-0"
                          />
                          <span className="truncate">{field.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}

        <div className="mb-1">
          <div
            className="flex items-center gap-1 px-2 py-1.5 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50 rounded"
            onClick={() => onToggleGroup('measure')}
          >
            {collapsedGroups['measure'] ? (
              <ChevronRight size={14} className="text-gray-400" />
            ) : (
              <ChevronDown size={14} className="text-gray-400" />
            )}
            <Sigma size={14} className="text-green-600" />
            <span>指标字段</span>
          </div>
          <AnimatePresence initial={false}>
            {!collapsedGroups['measure'] && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="pl-6 pr-1 py-1 space-y-1">
                  {measureFields.map((field) => (
                    <div
                      key={field.key}
                      draggable
                      onDragStart={(e) => onDragStart(e, field.key)}
                      className="flex items-center gap-1 px-2 py-1 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded text-xs text-gray-700 cursor-grab active:cursor-grabbing transition-colors"
                    >
                      <GripVertical
                        size={12}
                        className="text-gray-400 flex-shrink-0"
                      />
                      <Sigma
                        size={12}
                        className="text-green-600 flex-shrink-0"
                      />
                      <span className="truncate">{field.label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export const zoneIcons = {
  filters: <Filter size={14} />,
  rows: <Rows3 size={14} />,
  cols: <Columns3 size={14} />,
  values: <Calculator size={14} />,
};
