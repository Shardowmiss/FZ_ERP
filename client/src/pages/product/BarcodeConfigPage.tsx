import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Barcode as BarcodeIcon } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Card } from '@client/src/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@client/src/components/ui/table';
import { Input } from '@client/src/components/ui/input';
import { baseApi, productApi } from '@client/src/api';
import { errMsg } from '@/utils/errMsg';
import type { StyleBarcodeConfigDto, StyleBarcodeDto, SizeGroup } from '@shared/api.interface';

interface ColorRow { name: string; value?: string; }

const BarcodeConfigPage: React.FC = () => {
  const [styleOptions, setStyleOptions] = useState<Array<{ id: string; styleNo: string; name: string }>>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>('');
  const [sizeGroups, setSizeGroups] = useState<SizeGroup[]>([]);
  const [colors, setColors] = useState<ColorRow[]>([]);
  const [selectedSizeGroupIds, setSelectedSizeGroupIds] = useState<string[]>([]);
  const [barcodePrefix, setBarcodePrefix] = useState<string>('');
  const [config, setConfig] = useState<StyleBarcodeConfigDto | null>(null);
  const [barcodes, setBarcodes] = useState<StyleBarcodeDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // 初始化：款号选项 + 尺码组列表
  useEffect(() => {
    const load = async () => {
      try {
        const [styles, sgRes] = await Promise.all([
          baseApi.style.options(),
          baseApi.sizeGroup.list({ page: 1, pageSize: 200 }),
        ]);
        setStyleOptions(styles || []);
        setSizeGroups((sgRes?.items as SizeGroup[]) || []);
      } catch (e) {
        toast(errMsg(e, '加载基础数据失败'));
      }
    };
    load();
  }, []);

  // 选择款号后加载其条形码配置
  const loadConfig = useCallback(async (styleId: string) => {
    if (!styleId) {
      setConfig(null);
      setBarcodes([]);
      setColors([]);
      setSelectedSizeGroupIds([]);
      setBarcodePrefix('');
      return;
    }
    setLoading(true);
    try {
      const res = await productApi.barcodeConfig.getByStyle(styleId);
      setConfig(res.config);
      setBarcodes(res.barcodes || []);
      if (res.config) {
        setColors((res.config.colors as ColorRow[]) || []);
        setSelectedSizeGroupIds(res.config.sizeGroupIds || []);
        setBarcodePrefix(res.config.barcodePrefix || '');
      } else {
        setColors([]);
        setSelectedSizeGroupIds([]);
        setBarcodePrefix('');
      }
    } catch (e) {
      toast(errMsg(e, '加载条形码配置失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectStyle = (id: string) => {
    setSelectedStyleId(id);
    loadConfig(id);
  };

  const addColor = () => setColors((c) => [...c, { name: '', value: '' }]);
  const updateColor = (idx: number, patch: Partial<ColorRow>) =>
    setColors((c) => c.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const removeColor = (idx: number) => setColors((c) => c.filter((_, i) => i !== idx));

  const toggleSizeGroup = (id: string) =>
    setSelectedSizeGroupIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );

  const handleSave = async () => {
    if (!selectedStyleId) { toast('请先选择款号'); return; }
    if (colors.length === 0) { toast('请至少配置一个颜色'); return; }
    if (selectedSizeGroupIds.length === 0) { toast('请至少选择一个尺码组'); return; }
    setSaving(true);
    try {
      const saved = await productApi.barcodeConfig.save({
        styleId: selectedStyleId,
        colors,
        sizeGroupIds: selectedSizeGroupIds,
        barcodePrefix: barcodePrefix || undefined,
      });
      setConfig(saved);
      toast('配置已保存');
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedStyleId) { toast('请先选择款号'); return; }
    setGenerating(true);
    try {
      const res = await productApi.barcodeConfig.generate({ styleId: selectedStyleId });
      setBarcodes(res.barcodes || []);
      toast(`已生成 ${res.generated} 条条码`);
    } catch (e) {
      toast(errMsg(e, '生成失败'));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarcodeIcon size={20} className="text-primary" />
          <h1 className="text-xl font-semibold text-gray-800">条形码管理</h1>
        </div>
      </div>

      {/* 款号选择 */}
      <Card className="p-5">
        <label className="block text-sm text-gray-700 mb-1">选择款号</label>
        <select
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          value={selectedStyleId}
          onChange={(e) => handleSelectStyle(e.target.value)}
        >
          <option value="">请选择款号</option>
          {styleOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
          ))}
        </select>
      </Card>

      {selectedStyleId && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-medium text-gray-800">配置颜色与尺码组</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存配置'}
              </Button>
              <Button size="sm" onClick={handleGenerate} disabled={generating}>
                {generating ? '生成中...' : '生成条码矩阵'}
              </Button>
            </div>
          </div>

          {/* 颜色配置 */}
          <div className="mb-2 text-sm font-medium text-gray-700">颜色列表</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs h-8 w-1/2">颜色名称</TableHead>
                <TableHead className="text-xs h-8 w-1/2">颜色编码（可选）</TableHead>
                <TableHead className="text-xs h-8 w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {colors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-gray-400 text-center py-4">
                    暂无颜色，点击下方「新增颜色」
                  </TableCell>
                </TableRow>
              )}
              {colors.map((c, idx) => (
                <TableRow key={idx}>
                  <TableCell className="h-10">
                    <Input value={c.name} placeholder="如 黑色"
                      onChange={(e) => updateColor(idx, { name: e.target.value })} />
                  </TableCell>
                  <TableCell className="h-10">
                    <Input value={c.value || ''} placeholder="如 BLK"
                      onChange={(e) => updateColor(idx, { value: e.target.value })} />
                  </TableCell>
                  <TableCell className="h-10">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500"
                      onClick={() => removeColor(idx)}>
                      <Trash2 size={16} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button variant="outline" size="sm" className="mt-2" onClick={addColor}>
            <Plus size={16} className="mr-1" /> 新增颜色
          </Button>

          {/* 尺码组选择 */}
          <div className="mt-5 mb-2 text-sm font-medium text-gray-700">尺码组（可多选）</div>
          <div className="flex flex-wrap gap-3">
            {sizeGroups.map((sg) => (
              <label key={sg.id} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer border border-gray-200 rounded px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={selectedSizeGroupIds.includes(sg.id)}
                  onChange={() => toggleSizeGroup(sg.id)}
                />
                {sg.name}（{sg.code}）
              </label>
            ))}
            {sizeGroups.length === 0 && (
              <span className="text-sm text-gray-400">暂无尺码组</span>
            )}
          </div>

          {/* 条码前缀 */}
          <div className="mt-5">
            <label className="block text-sm text-gray-700 mb-1">条码前缀（可选，默认用款号）</label>
            <Input className="w-64" value={barcodePrefix}
              placeholder="留空则使用款号作为前缀"
              onChange={(e) => setBarcodePrefix(e.target.value)} />
          </div>
        </Card>
      )}

      {/* 条码矩阵 */}
      {selectedStyleId && (
        <Card className="p-5">
          <h2 className="text-base font-medium text-gray-800 mb-4">
            条码矩阵{config ? `（已生成 ${barcodes.length} 条）` : '（未保存配置）'}
          </h2>
          {loading ? (
            <div className="text-sm text-gray-400 py-4">加载中...</div>
          ) : barcodes.length === 0 ? (
            <div className="text-sm text-gray-400 py-4 text-center">
              暂未生成条码，请先「保存配置」并点击「生成条码矩阵」
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs h-8">颜色</TableHead>
                  <TableHead className="text-xs h-8">颜色编码</TableHead>
                  <TableHead className="text-xs h-8">尺码</TableHead>
                  <TableHead className="text-xs h-8">条码</TableHead>
                  <TableHead className="text-xs h-8">启用</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {barcodes.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-sm h-9">{b.colorName}</TableCell>
                    <TableCell className="text-sm h-9">{b.colorValue || '—'}</TableCell>
                    <TableCell className="text-sm h-9">{b.size}</TableCell>
                    <TableCell className="text-sm h-9 font-mono">{b.barcode}</TableCell>
                    <TableCell className="text-sm h-9">{b.enabled ? '是' : '否'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
};

export default BarcodeConfigPage;
