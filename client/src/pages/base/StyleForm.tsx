import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { systemApi } from '@client/src/api';
import { baseApi } from '@client/src/api/base';
import type {
  Style, ColorGroup, SizeGroup,
  StyleCodePreviewResult, StyleCreateAutoRequest,
  StyleAttribute, StyleAttrDef,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { errMsg } from '@/utils/errMsg';

const CURRENT_YEAR = String(new Date().getFullYear());

export const inputCls = "w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary";
export const labelCls = "block text-sm text-gray-700 mb-1";
export const reqCls = "text-red-500";

interface AutoFormState {
  name: string;
  wave: string;
  tagPrice: number | '';
  costPrice: number | '';
  supplyPrice: number | '';
  colorGroupId: string;
  sizeGroupId: string;
  status: string;
  remark: string;
  attributes: Record<string, string>;
}

const defaultAutoForm: AutoFormState = {
  name: '', wave: '', tagPrice: '', costPrice: '', supplyPrice: '',
  colorGroupId: '', sizeGroupId: '', status: 'active', remark: '',
  attributes: {},
};

export interface AutoCreateFormHandle {
  submit: () => Promise<void>;
}

interface AutoCreateFormProps {
  colorGroups: ColorGroup[];
  sizeGroups: SizeGroup[];
  brandOptions: StyleAttribute[];
  onSave: (data: StyleCreateAutoRequest) => Promise<void>;
}

export const AutoCreateForm = forwardRef<AutoCreateFormHandle, AutoCreateFormProps>(
  ({ colorGroups, sizeGroups, onSave }, ref) => {
    const [form, setForm] = useState<AutoFormState>({ ...defaultAutoForm });
    const [preview, setPreview] = useState<StyleCodePreviewResult | null>(null);
    const [loading, setLoading] = useState(false);
    const timerRef = useRef<number | null>(null);

    const [attrDefs, setAttrDefs] = useState<StyleAttrDef[]>([]);

    useEffect(() => {
      const loadAttrs = async () => {
        try {
          const defs = await baseApi.styleAttrDef.listWithValues(true);
          const sorted = [...defs].sort((a: StyleAttrDef, b: StyleAttrDef) => a.sortOrder - b.sortOrder);
          setAttrDefs(sorted);
          // 初始化 attributes 默认值
          const initAttrs: Record<string, string> = {};
          sorted.forEach((def: StyleAttrDef) => {
            initAttrs[def.attrCode.toLowerCase()] = '';
          });
          // 默认年份：若属性列表中有 YEAR 且值包含当前年份，默认选中
          const yearDef = sorted.find((d: StyleAttrDef) => d.attrCode.toUpperCase() === 'YEAR');
          if (yearDef?.values && yearDef.values.length > 0) {
            const current = yearDef.values.find(
              (v) => v.valueName === CURRENT_YEAR || v.valueCode === CURRENT_YEAR
            );
            initAttrs['year'] = current ? current.valueName : yearDef.values[0].valueName;
          }
          setForm((f) => ({ ...f, attributes: initAttrs }));
        } catch (e) {
          toast(errMsg(e, '加载属性定义失败'));
        }
      };
      loadAttrs();
    }, []);

    const canPreview = useMemo(() => {
      return attrDefs.length > 0 && attrDefs.every(
        (def: StyleAttrDef) => form.attributes[def.attrCode.toLowerCase()]
      );
    }, [attrDefs, form.attributes]);

    const requestPreview = useCallback(async (f: AutoFormState) => {
      setLoading(true);
      try {
        const res = await systemApi.codeRule.previewStyleCode({
          year: f.attributes['year'] || '',
          season: f.attributes['season'] || '',
          category: f.attributes['category'] || '',
          subCategory: f.attributes['subcategory'] || f.attributes['sub_category'] || '',
          fit: f.attributes['fit'] || '',
          brand: f.attributes['brand'] || undefined,
          attributes: f.attributes,
        });
        setPreview(res);
      } catch {
        setPreview(null);
      } finally {
        setLoading(false);
      }
    }, []);

    const schedulePreview = (f: AutoFormState) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => requestPreview(f), 300);
    };

    useEffect(() => {
      if (canPreview) {
        schedulePreview(form);
      } else {
        setPreview(null);
      }
    }, [form.attributes, canPreview, form, requestPreview]);

    const updateAttr = (attrCode: string, value: string) => {
      const nextAttrs = { ...form.attributes, [attrCode]: value };
      // 大类变化时清空小类（若存在）
      if (attrCode === 'category') {
        if (nextAttrs['subcategory'] !== undefined) nextAttrs['subcategory'] = '';
        if (nextAttrs['sub_category'] !== undefined) nextAttrs['sub_category'] = '';
      }
      setForm({ ...form, attributes: nextAttrs });
    };

    const update = <K extends keyof AutoFormState>(key: K, value: AutoFormState[K]) => {
      setForm({ ...form, [key]: value });
    };

    const submit = useCallback(async () => {
      if (!form.name.trim()) { toast('请输入款名'); return; }
      const allFilled = attrDefs.every(
        (def: StyleAttrDef) => form.attributes[def.attrCode.toLowerCase()]
      );
      if (!allFilled) { toast('请完善属性后再保存'); return; }
      if (!form.colorGroupId) { toast('请选择颜色组'); return; }
      if (!form.sizeGroupId) { toast('请选择尺码组'); return; }
      await onSave({
        name: form.name,
        year: form.attributes['year'] || '',
        season: form.attributes['season'] || '',
        category: form.attributes['category'] || '',
        subCategory: form.attributes['subcategory'] || form.attributes['sub_category'] || '',
        fit: form.attributes['fit'] || '',
        brand: form.attributes['brand'] || undefined,
        wave: form.wave || undefined,
        tagPrice: Number(form.tagPrice) || 0,
        costPrice: Number(form.costPrice) || 0,
        supplyPrice: Number(form.supplyPrice) || 0,
        colorGroupId: form.colorGroupId, sizeGroupId: form.sizeGroupId,
        remark: form.remark || undefined, skus: [],
        attributes: form.attributes,
      });
    }, [form, attrDefs, onSave]);

    useImperativeHandle(ref, () => ({ submit }), [submit]);

    // 小类联动：如果存在 category 和 subCategory/subcategory 属性
    const [subCategoryValues, setSubCategoryValues] = useState<Array<{ valueCode: string; valueName: string }>>([]);
    const categoryVal = form.attributes['category'] || '';
    const subCategoryAttr = useMemo(() => {
      return attrDefs.find((d: StyleAttrDef) =>
        d.attrCode.toLowerCase() === 'subcategory' || d.attrCode.toLowerCase() === 'sub_category'
      );
    }, [attrDefs]);

    useEffect(() => {
      if (!subCategoryAttr || !categoryVal) {
        setSubCategoryValues([]);
        return;
      }
      // 从动态属性定义中读取，所有值直接展示（动态属性不做父子联动，除非有 parentCode 机制）
      // 这里简单起见，所有值直接展示
      setSubCategoryValues(subCategoryAttr.values || []);
    }, [subCategoryAttr, categoryVal]);

    return (
      <div className="flex gap-5">
        <div className="flex-1" style={{ width: '60%' }}>
          <div className="grid grid-cols-2 gap-4">
            {attrDefs.map((def: StyleAttrDef) => {
              const key = def.attrCode.toLowerCase();
              const val = form.attributes[key] || '';
              const values = def.values || [];
              const isSubCat = key === 'subcategory' || key === 'sub_category';
              const disabled = isSubCat && !categoryVal;
              return (
                <div key={def.id}>
                  <label className={labelCls}>{def.attrName}<span className={reqCls}>*</span></label>
                  <select
                    className={inputCls}
                    value={val}
                    disabled={disabled}
                    onChange={(e) => updateAttr(key, e.target.value)}
                  >
                    <option value="">请选择</option>
                    {values.map((v) => (
                      <option key={v.id} value={v.valueName}>{v.valueName}（{v.valueCode}）</option>
                    ))}
                  </select>
                </div>
              );
            })}
            <div>
              <label className={labelCls}>款名<span className={reqCls}>*</span></label>
              <input type="text" className={inputCls} value={form.name} onChange={e => update('name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>波段</label>
              <input type="text" className={inputCls} value={form.wave} onChange={e => update('wave', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>吊牌价</label>
              <input type="number" step="0.01" className={inputCls} value={form.tagPrice}
                onChange={e => update('tagPrice', e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>成本价</label>
              <input type="number" step="0.01" className={inputCls} value={form.costPrice}
                onChange={e => update('costPrice', e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>供货价</label>
              <input type="number" step="0.01" className={inputCls} value={form.supplyPrice}
                onChange={e => update('supplyPrice', e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>颜色组<span className={reqCls}>*</span></label>
              <select className={inputCls} value={form.colorGroupId} onChange={e => update('colorGroupId', e.target.value)}>
                <option value="">请选择</option>
                {colorGroups.map(cg => <option key={cg.id} value={cg.id}>{cg.name} ({cg.code})</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>尺码组<span className={reqCls}>*</span></label>
              <select className={inputCls} value={form.sizeGroupId} onChange={e => update('sizeGroupId', e.target.value)}>
                <option value="">请选择</option>
                {sizeGroups.map(sg => <option key={sg.id} value={sg.id}>{sg.name} ({sg.code})</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>状态</label>
              <select className={inputCls} value={form.status} onChange={e => update('status', e.target.value)}>
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>备注</label>
              <textarea className={`${inputCls} resize-none`} rows={3} value={form.remark}
                onChange={e => update('remark', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ width: '40%' }}>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h4 className="text-sm font-medium text-gray-700 mb-3">款号预览</h4>
            <div className="text-center py-4 bg-white rounded border border-gray-200 mb-3">
              {canPreview ? (
                <div className="text-2xl font-bold text-blue-600 tracking-wider">
                  {loading ? '生成中...' : (preview?.styleNo || '---')}
                </div>
              ) : (
                <div className="text-gray-400 text-sm">请完善属性</div>
              )}
            </div>
            {canPreview && preview && preview.breakdown.length > 0 && (
              <div className="bg-white border border-gray-200 rounded mb-3 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="text-left px-3 py-2 font-medium">段名称</th>
                      <th className="text-left px-3 py-2 font-medium">值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.breakdown.map((seg, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 text-gray-600">{seg.segmentName}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-800">{seg.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-gray-400">款号由系统按编码规则自动生成</p>
          </div>
        </div>
      </div>
    );
  }
);

AutoCreateForm.displayName = 'AutoCreateForm';

interface ManualFormProps {
  form: Partial<Style>;
  editing: boolean;
  colorGroups: ColorGroup[];
  sizeGroups: SizeGroup[];
  brandOptions: StyleAttribute[];
  onChange: (patch: Partial<Style>) => void;
}

export const ManualForm: React.FC<ManualFormProps> = ({ form, editing, colorGroups, sizeGroups, brandOptions, onChange }) => {
  const [attrDefs, setAttrDefs] = useState<StyleAttrDef[]>([]);

  useEffect(() => {
    const loadAttrs = async () => {
      try {
        const defs = await baseApi.styleAttrDef.listWithValues(true);
        setAttrDefs([...defs].sort((a: StyleAttrDef, b: StyleAttrDef) => a.sortOrder - b.sortOrder));
      } catch {
        // non-critical
      }
    };
    loadAttrs();
  }, []);

  const attrs = form.attributes || {};

  const updateAttr = (attrCode: string, value: string) => {
    const nextAttrs = { ...attrs, [attrCode]: value };
    // 同步更新旧字段以保持兼容（后端也会做，但前端直接同步更直观）
    const patch: Partial<Style> = { attributes: nextAttrs };
    const lower = attrCode.toLowerCase();
    if (lower === 'year') patch.year = value;
    if (lower === 'season') patch.season = value;
    if (lower === 'category') patch.category = value;
    if (lower === 'subcategory' || lower === 'sub_category') patch.subCategory = value;
    if (lower === 'fit') patch.fit = value;
    if (lower === 'brand') patch.brand = value;
    onChange(patch);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>款号<span className={reqCls}>*</span></label>
          <input type="text" className={inputCls} value={form.styleNo || ''}
            onChange={e => onChange({ styleNo: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>款名<span className={reqCls}>*</span></label>
          <input type="text" className={inputCls} value={form.name || ''}
            onChange={e => onChange({ name: e.target.value })} />
        </div>
        {attrDefs.map((def: StyleAttrDef) => {
          const key = def.attrCode.toLowerCase();
          const val = attrs[key] || form[def.attrCode.toLowerCase() as keyof Style] as string || '';
          return (
            <div key={def.id}>
              <label className={labelCls}>{def.attrName}</label>
              <select className={inputCls} value={val}
                onChange={e => updateAttr(key, e.target.value)}>
                <option value="">请选择</option>
                {(def.values || []).map((v) => (
                  <option key={v.id} value={v.valueName}>{v.valueName}（{v.valueCode}）</option>
                ))}
              </select>
            </div>
          );
        })}
        <div>
          <label className={labelCls}>波段</label>
         <input type="text" className={inputCls} value={form.wave || ''}
           onChange={e => onChange({ wave: e.target.value })} />
       </div>
       <div>
         <label className={labelCls}>吊牌价</label>
         <input type="number" step="0.01" className={inputCls} value={form.tagPrice ?? ''}
           onChange={e => onChange({ tagPrice: Number(e.target.value) })} />
       </div>
       <div>
         <label className={labelCls}>成本价</label>
         <input type="number" step="0.01" className={inputCls} value={form.costPrice ?? ''}
           onChange={e => onChange({ costPrice: Number(e.target.value) })} />
       </div>
       <div>
         <label className={labelCls}>供货价</label>
         <input type="number" step="0.01" className={inputCls} value={form.supplyPrice ?? ''}
           onChange={e => onChange({ supplyPrice: Number(e.target.value) })} />
       </div>
       <div>
         <label className={labelCls}>颜色组<span className={reqCls}>*</span></label>
         <select className={inputCls} value={form.colorGroupId || ''} disabled={editing}
           onChange={e => onChange({ colorGroupId: e.target.value })}>
           <option value="">请选择</option>
           {colorGroups.map(cg => <option key={cg.id} value={cg.id}>{cg.name} ({cg.code})</option>)}
         </select>
       </div>
       <div>
         <label className={labelCls}>尺码组<span className={reqCls}>*</span></label>
         <select className={inputCls} value={form.sizeGroupId || ''} disabled={editing}
           onChange={e => onChange({ sizeGroupId: e.target.value })}>
           <option value="">请选择</option>
           {sizeGroups.map(sg => <option key={sg.id} value={sg.id}>{sg.name} ({sg.code})</option>)}
         </select>
       </div>
       <div>
         <label className={labelCls}>状态</label>
         <select className={inputCls} value={form.status || 'active'}
           onChange={e => onChange({ status: e.target.value })}>
           <option value="active">启用</option>
           <option value="inactive">停用</option>
         </select>
       </div>
       <div className="col-span-2">
         <label className={labelCls}>备注</label>
         <textarea className={`${inputCls} resize-none`} rows={3} value={form.remark || ''}
           onChange={e => onChange({ remark: e.target.value })} />
       </div>
      </div>
    </>
  );
};
