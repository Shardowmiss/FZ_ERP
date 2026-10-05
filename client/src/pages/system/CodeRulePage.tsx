import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ChevronUp, ChevronDown, Settings } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Switch } from '@client/src/components/ui/switch';
import { Card } from '@client/src/components/ui/card';
import { StatusBadge } from '@client/src/components/ui/status-badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@client/src/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@client/src/components/ui/table';
import { systemApi } from '@client/src/api';
import { baseApi } from '@client/src/api/base';
import { errMsg } from '@/utils/errMsg';
import {
  SegmentConfig, SEGMENT_NAMES, SEGMENT_TYPE_OPTIONS,
} from './CodeRuleComponents';
import type {
  CodeRule,
  CodeRuleSegment,
  CodeRuleSegmentType,
  CodeMappingConfig,
  SeasonCode,
  CategoryCode,
  SubCategoryCode,
  FitCode,
  BrandCode,
  StyleAttrDef,
} from '@shared/api.interface';

const genId = (): string => Math.random().toString(36).slice(2, 10);

const defaultSegments: CodeRuleSegment[] = [
  { id: genId(), type: 'fixed', enabled: true, order: 0, config: { value: 'GS' } },
  { id: genId(), type: 'year', enabled: true, order: 1, config: { yearFormat: '4' } },
  { id: genId(), type: 'separator', enabled: true, order: 2, config: { separator: '-' } },
  { id: genId(), type: 'season', enabled: true, order: 3 },
  { id: genId(), type: 'separator', enabled: true, order: 4, config: { separator: '-' } },
  { id: genId(), type: 'category', enabled: true, order: 5 },
  { id: genId(), type: 'subCategory', enabled: true, order: 6 },
  { id: genId(), type: 'serial', enabled: true, order: 7, config: { serialDigits: 4, serialReset: 'year' } },
];

const defaultMapping: CodeMappingConfig = {
  years: [
    { name: '2024年', code: '2024' }, { name: '2025年', code: '2025' }, { name: '2026年', code: '2026' },
  ],
  seasons: [
    { name: '春', code: 'SP' }, { name: '夏', code: 'SU' },
    { name: '秋', code: 'AU' }, { name: '冬', code: 'WI' },
  ],
  categories: [
    { name: '上衣', code: 'SY' }, { name: '裤装', code: 'KZ' },
    { name: '裙装', code: 'QZ' }, { name: '外套', code: 'WT' },
  ],
  subCategories: [
    { category: '上衣', name: 'T恤', code: 'TX' },
    { category: '上衣', name: '衬衫', code: 'CS' },
    { category: '裤装', name: '牛仔裤', code: 'Nzk' },
  ],
   fits: [
     { name: '修身', code: 'X' }, { name: '常规', code: 'B' },
     { name: '宽松', code: 'K' }, { name: 'Oversize', code: 'O' },
   ],
   brands: [
     { name: '默认品牌', code: 'DEF' },
   ],
  colors: [
    { name: '黑色', code: 'BLK' }, { name: '白色', code: 'WHT' }, { name: '灰色', code: 'GRY' },
  ],
  sizes: [
    { name: 'S', code: 'S' }, { name: 'M', code: 'M' }, { name: 'L', code: 'L' }, { name: 'XL', code: 'XL' },
  ],
  attrValues: {},
};

const previewParams = {
  year: String(new Date().getFullYear()),
  season: '夏',
  category: '上衣',
  subCategory: 'T恤',
  fit: '常规',
  brand: '本白',
  serialNo: '0001',
};

const CodeRulePage: React.FC = () => {
  const [segments, setSegments] = useState<CodeRuleSegment[]>(defaultSegments);
  const [mapping, setMapping] = useState<CodeMappingConfig>(defaultMapping);
  const [saving, setSaving] = useState(false);
  const [ruleId, setRuleId] = useState<string>('');
  const [rules, setRules] = useState<CodeRule[]>([]);
  const [ruleName, setRuleName] = useState<string>('默认款号规则');
  const [isDefault, setIsDefault] = useState<boolean>(true);
  const [brandOptions, setBrandOptions] = useState<BrandCode[]>([]);
  const [attrDefs, setAttrDefs] = useState<StyleAttrDef[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');

  useEffect(() => {
    const load = async () => {
      try {
        const [listRes, defaultRes, mapRes, brandRes, attrRes] = await Promise.all([
          systemApi.codeRule.list(),
          systemApi.codeRule.getDefaultRule(),
          systemApi.codeRule.getMapping(),
          systemApi.codeRule.getBrandOptions(),
          baseApi.styleAttrDef.listWithValues(true),
        ]);
        // 多套规则支持：列表 + 默认规则（保证至少一条可选）
        const allRules = listRes?.length ? listRes : [defaultRes];
        setRules(allRules);
        const selId = defaultRes.id;
        setSelectedRuleId(selId);
        setRuleId(selId);
        const sel = allRules.find((r: CodeRule) => r.id === selId) ?? defaultRes;
        if (sel?.segments?.length) setSegments(sel.segments);
        setRuleName(sel?.name ?? '默认款号规则');
        setIsDefault(sel?.isDefault ?? true);
        if (mapRes) setMapping(mapRes);
        if (brandRes) setBrandOptions(brandRes);
        if (attrRes) setAttrDefs([...attrRes].sort((a, b) => a.sortOrder - b.sortOrder));
      } catch {
        // 使用默认值
      }
    };
    load();
  }, []);

  // 选中某条规则 → 加载其详情（编码段）
  const selectRule = async (id: string) => {
    if (!id) return;
    setSelectedRuleId(id);
    setRuleId(id);
    try {
      const rule = await systemApi.codeRule.get(id);
      if (rule?.segments?.length) setSegments(rule.segments);
      setRuleName(rule?.name ?? '');
      setIsDefault(rule?.isDefault ?? false);
    } catch {
      // 保持当前
    }
  };

  // 保存后刷新主纪录列表，并重新选中刚保存的规则
  const reloadList = async (selectId?: string) => {
    const [listRes, defaultRes] = await Promise.all([
      systemApi.codeRule.list(),
      systemApi.codeRule.getDefaultRule(),
    ]);
    const allRules = listRes?.length ? listRes : [defaultRes];
    setRules(allRules);
    const id = selectId || defaultRes.id;
    setSelectedRuleId(id);
    setRuleId(id);
    const sel = allRules.find((r: CodeRule) => r.id === id) ?? defaultRes;
    if (sel?.segments?.length) setSegments(sel.segments);
    setRuleName(sel?.name ?? '');
    setIsDefault(sel?.isDefault ?? false);
  };

  const newRule = () => {
    setSelectedRuleId('');
    setRuleId('');
    setSegments(defaultSegments);
    setRuleName('');
    setIsDefault(false);
  };

  const addSegment = () => {
    const nextOrder = segments.length > 0 ? Math.max(...segments.map((s: CodeRuleSegment) => s.order)) + 1 : 0;
    setSegments([...segments, {
      id: genId(), type: 'fixed', enabled: true, order: nextOrder, config: { value: '' },
    }]);
  };

  // 将 attrDefs 注入到每个 attribute 段的 config 中，供 SegmentConfig 渲染使用（仅前端渲染用，保存时剥离）
  const segmentsWithAttrDefs = useMemo(
    () => segments.map((s: CodeRuleSegment) => {
      if (s.type !== 'attribute') return s;
      return { ...s, config: { ...s.config, _attrDefs: attrDefs as unknown as undefined } };
    }),
    [segments, attrDefs]
  );

  const removeSegment = (id: string) => {
    setSegments(segments.filter((s: CodeRuleSegment) => s.id !== id));
  };

  const moveSegment = (index: number, direction: 'up' | 'down') => {
    const sorted = [...segments].sort((a: CodeRuleSegment, b: CodeRuleSegment) => a.order - b.order);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    [sorted[index], sorted[targetIndex]] = [sorted[targetIndex], sorted[index]];
    setSegments(sorted.map((s: CodeRuleSegment, i: number) => ({ ...s, order: i })));
  };

  const updateSegment = (id: string, patch: Partial<CodeRuleSegment>) => {
    setSegments(segments.map((s: CodeRuleSegment) => {
      if (s.id !== id) return s;
      const newConfig = { ...s.config, ...patch.config };
      // 剥离前端渲染用的 _attrDefs
      delete (newConfig as unknown as { _attrDefs?: unknown })._attrDefs;
      return { ...s, ...patch, config: newConfig };
    }));
  };

  const sortedSegments = useMemo(
    () => [...segmentsWithAttrDefs].sort((a, b) => a.order - b.order),
    [segmentsWithAttrDefs]
  );

  // 前端预览拼接
  const preview = useMemo(() => {
    const getValue = (seg: CodeRuleSegment): string => {
      if (!seg.enabled) return '';
      const cfg = seg.config || {};
      switch (seg.type) {
        case 'fixed': return cfg.value || '';
        case 'year': return cfg.yearFormat === '2' ? previewParams.year.slice(-2) : previewParams.year;
        case 'season':
          return mapping.seasons.find((s: SeasonCode) => s.name === previewParams.season)?.code || '';
        case 'category':
          return mapping.categories.find((c: CategoryCode) => c.name === previewParams.category)?.code || '';
        case 'subCategory':
          return mapping.subCategories.find((s: SubCategoryCode) => s.name === previewParams.subCategory)?.code || '';
        case 'fit':
          return mapping.fits.find((f: FitCode) => f.name === previewParams.fit)?.code || '';
        case 'brand':
          return mapping.brands.find((b: BrandCode) => b.name === previewParams.brand)?.code || '';
        case 'attribute': {
          const code = cfg.attrCode || '';
          if (!code) return '';
          const def = attrDefs.find((d: StyleAttrDef) => d.attrCode === code);
          // 预览时取第一个值的 code 作为示例
          if (def?.values && def.values.length > 0) return def.values[0].valueCode;
          return '';
        }
        case 'serial': {
          const d = cfg.serialDigits || 4;
          return previewParams.serialNo?.padStart(d, '0').slice(-d) || '';
        }
        case 'separator': return cfg.separator || '';
        default: return '';
      }
    };
    const breakdown = sortedSegments.map((seg: CodeRuleSegment) => {
      let segmentName = SEGMENT_NAMES[seg.type];
      if (seg.type === 'attribute' && seg.config?.attrCode) {
        const def = attrDefs.find((d: StyleAttrDef) => d.attrCode === seg.config?.attrCode);
        if (def) segmentName = def.attrName;
      }
      return { segmentType: seg.type, segmentName, value: getValue(seg) };
    });
    const styleNo = sortedSegments
      .filter((s: CodeRuleSegment) => s.enabled)
      .map((s: CodeRuleSegment) => getValue(s))
      .join('');
    return { styleNo, breakdown };
  }, [sortedSegments, mapping, attrDefs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 仅「修改」时带 id；「新建」(ruleId 为空) 不传 id，由后端走 INSERT。
      // 旧逻辑 id: ruleId || genUuid() 会给新建也伪造随机 uuid，导致后端 UPDATE 0 行报「规则不存在」。
      const ruleData = {
        ...(ruleId ? { id: ruleId } : {}),
        name: ruleName.trim() || (isDefault ? '默认款号规则' : '未命名规则'),
        segments: sortedSegments,
        isDefault,
        createdAt: '',
        updatedAt: '',
      } as CodeRule;
      const colorSizeMapping: CodeMappingConfig = {
        ...mapping,
        seasons: [],
        categories: [],
        subCategories: [],
        fits: [],
      };
      const saved = await systemApi.codeRule.saveRule(ruleData);
      await systemApi.codeRule.saveMapping(colorSizeMapping);
      toast('保存成功');
      // 保存后刷新主纪录列表并重新选中刚保存的规则（含新建）
      await reloadList(saved?.id || ruleId || undefined);
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-primary" />
        <h1 className="text-xl font-semibold text-gray-800">款号编码规则</h1>
      </div>

      {/* 上半部分：编码规则主纪录列表 */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-gray-800">编码规则列表（{rules.length}）</h2>
          <Button variant="outline" size="sm" onClick={newRule}>
            <Plus size={16} className="mr-1" /> 新建规则
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>规则名称</TableHead>
              <TableHead>默认</TableHead>
              <TableHead>段数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>更新时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-12 text-center text-gray-400">暂无编码规则</TableCell>
              </TableRow>
            ) : (
              rules.map((r: CodeRule) => (
                <TableRow
                  key={r.id}
                  data-state={selectedRuleId === r.id ? 'selected' : undefined}
                  className={selectedRuleId === r.id ? 'cursor-pointer bg-primary/5' : 'cursor-pointer hover:bg-gray-50'}
                  onClick={() => selectRule(r.id)}
                >
                  <TableCell className="font-medium text-gray-800">{r.name}</TableCell>
                  <TableCell>
                    {r.isDefault ? <StatusBadge tone="ok">默认</StatusBadge> : <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell>{r.segments?.length ?? 0}</TableCell>
                  <TableCell className="text-gray-500">{r.createdAt?.replace('T', ' ').slice(0, 19) || '-'}</TableCell>
                  <TableCell className="text-gray-500">{r.updatedAt?.replace('T', ' ').slice(0, 19) || '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 下半部分：选中规则的详细内容（可编辑） */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-base font-medium text-gray-800">规则详情</h2>
          <div className="flex items-center gap-3">
            <input
              className="h-9 rounded-md border border-gray-300 px-3 text-sm w-44"
              placeholder="规则名称"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <Switch checked={isDefault} onCheckedChange={(c: boolean) => setIsDefault(c)} />
              设为默认
            </label>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>

        {ruleId === '' && (
          <div className="text-xs text-amber-600 bg-amber-50 rounded p-2">
            当前为「新建规则」状态，编辑完成后点击「保存」即可创建。
          </div>
        )}

        <div className="flex gap-5">
          {/* 左侧：编码段配置 */}
          <Card className="flex-1 p-5" style={{ flexBasis: '70%' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-medium text-gray-800">编码段配置</h2>
              <Button variant="outline" size="sm" onClick={addSegment}>
                <Plus size={16} className="mr-1" /> 新增段
              </Button>
            </div>
            <div className="space-y-3">
              {sortedSegments.map((seg: CodeRuleSegment, index: number) => (
                <div
                  key={seg.id}
                  className={`flex items-center gap-3 p-3 border rounded-lg ${
                    seg.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}
                >
                  <Switch checked={seg.enabled}
                    onCheckedChange={(checked: boolean) => updateSegment(seg.id, { enabled: checked })} />
                  <span className="text-xs text-gray-400 w-6 text-center">{index + 1}</span>
                  <Select value={seg.type}
                    onValueChange={(val: CodeRuleSegmentType) => {
                      const base: Partial<CodeRuleSegment> = { type: val };
                      if (val === 'fixed') base.config = { value: '' };
                      if (val === 'year') base.config = { yearFormat: '4' };
                      if (val === 'serial') base.config = { serialDigits: 4, serialReset: 'year' };
                      if (val === 'separator') base.config = { separator: '-' };
                      if (val === 'attribute') base.config = { attrCode: '' };
                      updateSegment(seg.id, base);
                    }}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SEGMENT_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <SegmentConfig segment={seg} mapping={mapping} onChange={(cfg) => updateSegment(seg.id, { config: cfg })} />
                  <div className="flex-1" />
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => moveSegment(index, 'up')} disabled={index === 0}>
                      <ChevronUp size={16} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => moveSegment(index, 'down')} disabled={index === sortedSegments.length - 1}>
                      <ChevronDown size={16} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600"
                      onClick={() => removeSegment(seg.id)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* 右侧：预览 */}
          <Card className="p-5" style={{ flexBasis: '30%' }}>
            <h2 className="text-base font-medium text-gray-800 mb-4">款号预览</h2>
            <div className="text-center py-6 bg-blue-50 rounded-lg mb-4">
              <div className="text-3xl font-bold text-primary tracking-wider">
                {preview.styleNo || '—'}
              </div>
              <div className="text-xs text-gray-500 mt-2">示例款号</div>
            </div>
            <div className="text-xs text-gray-500 mb-2">各段拆解</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs h-8">段名称</TableHead>
                  <TableHead className="text-xs h-8 text-right">值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.breakdown.map((item, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="text-sm h-8">{item.segmentName}</TableCell>
                    <TableCell className="text-sm h-8 text-right font-mono">
                      {item.value || <span className="text-gray-300">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-xs text-gray-500 mt-2 text-right">各段拆解</div>
            {sortedSegments.some((s: CodeRuleSegment) => s.type === 'brand' && s.enabled) && (
               <div className="mt-3 text-xs text-amber-600 bg-amber-50 rounded p-2">
                 品牌段在新建款号时，将根据所选品牌自动替换为对应编码
               </div>
             )}
            {sortedSegments.some((s: CodeRuleSegment) => s.type === 'attribute' && s.enabled) && (
               <div className="mt-3 text-xs text-amber-600 bg-amber-50 rounded p-2">
                 动态属性段在新建款号时，将根据所选属性值的编码自动替换
               </div>
             )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CodeRulePage;
