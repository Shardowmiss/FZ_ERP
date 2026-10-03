import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@client/src/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@client/src/components/ui/table';
import type { CodeRuleSegment, CodeRuleSegmentType, SubCategoryCode, BrandCode, StyleAttrDef, CodeMappingConfig } from '@shared/api.interface';

// ===== 段配置组件 =====
interface SegmentConfigProps {
  segment: CodeRuleSegment;
  onChange: (config: CodeRuleSegment['config']) => void;
  mapping?: CodeMappingConfig;
}

export const SegmentConfig: React.FC<SegmentConfigProps> = ({ segment, onChange, mapping }) => {
  const cfg = segment.config || {};

  if (segment.type === 'fixed') {
    return (
      <Input
        className="w-40"
        placeholder="固定字符值"
        value={cfg.value || ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...cfg, value: e.target.value })}
      />
    );
  }

  if (segment.type === 'year') {
    return (
      <Select value={cfg.yearFormat || '4'} onValueChange={(val: '4' | '2') => onChange({ ...cfg, yearFormat: val })}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="4">4位（2026）</SelectItem>
          <SelectItem value="2">2位（26）</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (segment.type === 'serial') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">位数</span>
          <Input
            type="number"
            className="w-20"
            value={cfg.serialDigits ?? 4}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...cfg, serialDigits: Number(e.target.value) })
            }
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">重置</span>
          <Select
            value={cfg.serialReset || 'year'}
            onValueChange={(val: 'year' | 'category' | 'never') => onChange({ ...cfg, serialReset: val })}
          >
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="year">按年</SelectItem>
              <SelectItem value="category">按品类</SelectItem>
              <SelectItem value="never">从不</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (segment.type === 'separator') {
    return (
      <Select value={cfg.separator ?? '-'} onValueChange={(val: '' | '-' | '/') => onChange({ ...cfg, separator: val })}>
        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">无</SelectItem>
          <SelectItem value="-">-</SelectItem>
          <SelectItem value="/">/</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (segment.type === 'attribute') {
    const attrDefs: StyleAttrDef[] = (cfg as unknown as { _attrDefs?: StyleAttrDef[] })._attrDefs || [];
    return (
      <Select value={cfg.attrCode || ''} onValueChange={(val: string) => onChange({ ...cfg, attrCode: val })}>
        <SelectTrigger className="w-40"><SelectValue placeholder="选择属性" /></SelectTrigger>
        <SelectContent>
          {attrDefs.map((def: StyleAttrDef) => (
            <SelectItem key={def.id} value={def.attrCode}>{def.attrName}（{def.attrCode}）</SelectItem>
          ))}
          {attrDefs.length === 0 && (
            <SelectItem value="_empty" disabled>暂无可选属性（请先在「款号属性维护→动态属性」配置）</SelectItem>
          )}
        </SelectContent>
      </Select>
    );
  }

  const hintMap: Record<string, string> = {
    season: '映射在下方「季节编码」Tab 配置',
    category: '映射在下方「品类编码」Tab 配置',
    subCategory: '映射在下方「小类编码」Tab 配置',
    fit: '映射在下方「版型编码」Tab 配置',
    brand: '映射在下方「品牌编码」Tab 配置',
  };
  const countMap: Record<string, number> = {
    season: mapping?.seasons?.length ?? 0,
    category: mapping?.categories?.length ?? 0,
    subCategory: mapping?.subCategories?.length ?? 0,
    fit: mapping?.fits?.length ?? 0,
    brand: mapping?.brands?.length ?? 0,
  };
  const hint = hintMap[segment.type] || '';
  const cnt = countMap[segment.type];
  return (
    <span className="text-xs text-gray-400">
      {hint}
      {hint && cnt > 0 ? `（已配置 ${cnt} 项）` : ''}
    </span>
  );
};

// ===== 映射表格组件 =====
interface MappingTableProps<T extends { name: string; code: string }> {
  columns: string[];
  data: T[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<T>) => void;
  extraKey?: string;
}

export function MappingTable<T extends { name: string; code: string }>(
  props: MappingTableProps<T>
) {
  const { columns, data, onAdd, onRemove, onUpdate, extraKey } = props;
  const hasExtra = Boolean(extraKey) && columns.length === 3;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus size={16} className="mr-1" /> 新增行
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col: string) => (
              <TableHead key={col} className="text-xs h-9">{col}</TableHead>
            ))}
            <TableHead className="text-xs h-9 w-16 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item: T, index: number) => (
            <TableRow key={index}>
              {hasExtra && extraKey && (
                <TableCell className="h-10">
                  <Input
                    className="h-8"
                    value={String((item as Record<string, unknown>)[extraKey] || '')}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onUpdate(index, { [extraKey]: e.target.value } as Partial<T>)
                    }
                  />
                </TableCell>
              )}
              <TableCell className="h-10">
                <Input className="h-8" value={item.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onUpdate(index, { name: e.target.value } as Partial<T>)
                  } />
              </TableCell>
              <TableCell className="h-10">
                <Input className="h-8 font-mono" value={item.code}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onUpdate(index, { code: e.target.value } as Partial<T>)
                  } />
              </TableCell>
              <TableCell className="h-10 text-right">
                <Button variant="ghost" size="icon"
                  className="h-8 w-8 text-red-500 hover:text-red-600"
                  onClick={() => onRemove(index)}>
                  <Trash2 size={14} />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export const SEGMENT_TYPE_OPTIONS: { value: CodeRuleSegmentType; label: string }[] = [
  { value: 'fixed', label: '固定字符' },
  { value: 'year', label: '年份' },
  { value: 'season', label: '季节' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '商品大类' },
  { value: 'subCategory', label: '商品小类' },
  { value: 'fit', label: '版型' },
  { value: 'attribute', label: '动态属性' },
  { value: 'serial', label: '流水号' },
  { value: 'separator', label: '连接符' },
];

export const SEGMENT_NAMES: Record<CodeRuleSegmentType, string> = {
  fixed: '固定字符', year: '年份', season: '季节', brand: '品牌', category: '商品大类',
  subCategory: '商品小类', fit: '版型', attribute: '动态属性', serial: '流水号', separator: '连接符',
};

export function ReadOnlyMapping<T extends { name: string; code: string }>(props: { columns: string[]; data: T[] }) {
  const { columns, data } = props;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col: string) => (
            <TableHead key={col} className="text-xs h-9">{col}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-10 text-center text-gray-400 text-sm">
              暂无数据
            </TableCell>
          </TableRow>
        ) : (
          data.map((item: T, index: number) => (
            <TableRow key={index}>
              <TableCell className="h-10 text-sm">{item.name}</TableCell>
              <TableCell className="h-10 text-sm font-mono">{item.code}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function BrandMappingTable(props: { data: BrandCode[] }) {
  const { data } = props;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs h-9">属性编码</TableHead>
          <TableHead className="text-xs h-9">属性名称</TableHead>
          <TableHead className="text-xs h-9 w-24 text-center">排序号</TableHead>
          <TableHead className="text-xs h-9 w-24 text-center">状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="h-10 text-center text-gray-400 text-sm">
              暂无数据
            </TableCell>
          </TableRow>
        ) : (
          data.map((item: BrandCode, index: number) => (
            <TableRow key={index}>
              <TableCell className="h-10 text-sm font-mono">{item.code}</TableCell>
              <TableCell className="h-10 text-sm">{item.name}</TableCell>
              <TableCell className="h-10 text-sm text-center">{item.sortOrder ?? '-'}</TableCell>
              <TableCell className="h-10 text-sm text-center">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  item.status === 'active'
                    ? 'bg-green-50 text-green-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {item.status === 'active' ? '启用' : '禁用'}
                </span>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function ReadOnlySubCategoryMapping(props: { data: SubCategoryCode[] }) {
  const { data } = props;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs h-9">所属大类</TableHead>
          <TableHead className="text-xs h-9">名称</TableHead>
          <TableHead className="text-xs h-9">代码</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={3} className="h-10 text-center text-gray-400 text-sm">
              暂无数据
            </TableCell>
          </TableRow>
        ) : (
          data.map((item: SubCategoryCode, index: number) => (
            <TableRow key={index}>
              <TableCell className="h-10 text-sm">{item.category}</TableCell>
              <TableCell className="h-10 text-sm">{item.name}</TableCell>
              <TableCell className="h-10 text-sm font-mono">{item.code}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
