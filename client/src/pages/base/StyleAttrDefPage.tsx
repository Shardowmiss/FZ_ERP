import React, { useState, useEffect } from 'react';
import { baseApi } from '@client/src/api';
import type { StyleAttrDef, StyleAttrValue } from '@client/src/api/base';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@client/src/components/ui/table';
import { Switch } from '@client/src/components/ui/switch';
import { errMsg } from '@/utils/errMsg';
import {
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Plus,
} from 'lucide-react';

// ===== Attr Def Form =====
interface AttrDefForm {
  attrCode: string;
  attrName: string;
  sortOrder: number;
  status: string;
  remark: string;
}

const defaultAttrDefForm: AttrDefForm = {
  attrCode: '',
  attrName: '',
  sortOrder: 0,
  status: 'active',
  remark: '',
};

// ===== Attr Value Form =====
interface AttrValueForm {
  valueCode: string;
  valueName: string;
  sortOrder: number;
  status: string;
  remark: string;
}

const defaultAttrValueForm: AttrValueForm = {
  valueCode: '',
  valueName: '',
  sortOrder: 0,
  status: 'active',
  remark: '',
};

const StyleAttrDefPage: React.FC = () => {
  // ==== Attr Def list state ====
  const [attrDefs, setAttrDefs] = useState<StyleAttrDef[]>([]);
  const [attrDefsLoading, setAttrDefsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ==== Attr Def dialog state ====
  const [attrDefDialogOpen, setAttrDefDialogOpen] = useState(false);
  const [editingAttrDefId, setEditingAttrDefId] = useState<string | null>(null);
  const [attrDefForm, setAttrDefForm] = useState<AttrDefForm>(defaultAttrDefForm);
  const [attrDefSubmitting, setAttrDefSubmitting] = useState(false);

  // ==== Attr Value list state ====
  const [attrValues, setAttrValues] = useState<StyleAttrValue[]>([]);
  const [attrValuesLoading, setAttrValuesLoading] = useState(false);

  // ==== Attr Value dialog state ====
  const [attrValueDialogOpen, setAttrValueDialogOpen] = useState(false);
  const [editingAttrValueId, setEditingAttrValueId] = useState<string | null>(null);
  const [attrValueForm, setAttrValueForm] = useState<AttrValueForm>(defaultAttrValueForm);
  const [attrValueSubmitting, setAttrValueSubmitting] = useState(false);

  const selectedAttrDef = attrDefs.find((d) => d.id === selectedId) || null;

  // ====== Load attr def list ======
  const fetchAttrDefs = async () => {
    setAttrDefsLoading(true);
    try {
      const res: StyleAttrDef[] = await baseApi.styleAttrDef.list();
      const sorted = [...res].sort((a, b) => a.sortOrder - b.sortOrder);
      setAttrDefs(sorted);
      // auto-select first if nothing selected
      if (!selectedId && sorted.length > 0) {
        setSelectedId(sorted[0].id);
      }
    } catch (e) {
      toast.error('加载属性定义失败');
    } finally {
      setAttrDefsLoading(false);
    }
  };

  useEffect(() => {
    fetchAttrDefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== Load attr values when selected changes ======
  const fetchAttrValues = async (id: string) => {
    setAttrValuesLoading(true);
    try {
      const res: StyleAttrValue[] = await baseApi.styleAttrDef.listValues(id);
      const sorted = [...res].sort((a, b) => a.sortOrder - b.sortOrder);
      setAttrValues(sorted);
    } catch (e) {
      toast.error('加载属性值失败');
    } finally {
      setAttrValuesLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) {
      fetchAttrValues(selectedId);
    } else {
      setAttrValues([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ====== Attr Def CRUD ======
  const openAddAttrDef = () => {
    setEditingAttrDefId(null);
    const nextSort = attrDefs.length > 0
      ? Math.max(...attrDefs.map((d) => d.sortOrder)) + 1
      : 1;
    setAttrDefForm({ ...defaultAttrDefForm, sortOrder: nextSort });
    setAttrDefDialogOpen(true);
  };

  const openEditAttrDef = (item: StyleAttrDef) => {
    setEditingAttrDefId(item.id);
    setAttrDefForm({
      attrCode: item.attrCode,
      attrName: item.attrName,
      sortOrder: item.sortOrder,
      status: item.status,
      remark: item.remark || '',
    });
    setAttrDefDialogOpen(true);
  };

  const handleSaveAttrDef = async () => {
    if (attrDefSubmitting) return;
    if (!attrDefForm.attrCode.trim()) {
      toast.error('请输入属性编码');
      return;
    }
    if (!attrDefForm.attrName.trim()) {
      toast.error('请输入属性名称');
      return;
    }
    setAttrDefSubmitting(true);
    try {
      if (editingAttrDefId) {
        await baseApi.styleAttrDef.update(editingAttrDefId, attrDefForm);
        toast.success('更新成功');
      } else {
        const created = await baseApi.styleAttrDef.create(attrDefForm);
        if (!selectedId) {
          setSelectedId(created.id);
        }
        toast.success('新增成功');
      }
      setAttrDefDialogOpen(false);
      fetchAttrDefs();
    } catch (e) {
      toast.error(errMsg(e, '保存失败'));
    } finally {
      setAttrDefSubmitting(false);
    }
  };

  const handleDeleteAttrDef = async (item: StyleAttrDef) => {
    if (!await showConfirm(`确定要删除属性「${item.attrName}」吗？`)) return;
    try {
      const res = await baseApi.styleAttrDef.remove(item.id);
      if (res.disabled) {
        toast.warning(res.message || '该属性已被引用，已改为禁用状态');
      } else {
        toast.success('删除成功');
      }
      if (selectedId === item.id) {
        setSelectedId(null);
      }
      fetchAttrDefs();
    } catch (e) {
      toast.error(errMsg(e, '删除失败'));
    }
  };

  const handleMoveAttrDef = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= attrDefs.length) return;

    const newList = [...attrDefs];
    [newList[index], newList[newIndex]] = [newList[newIndex], newList[index]];

    // Optimistic update
    setAttrDefs(newList);

    const reorderItems = newList.map((item, i) => ({
      id: item.id,
      sortOrder: i + 1,
    }));

    try {
      await baseApi.styleAttrDef.reorder(reorderItems);
    } catch (e) {
      // Revert on failure
      setAttrDefs(attrDefs);
      toast.error(errMsg(e, '排序失败'));
    }
  };

  // ====== Attr Value CRUD ======
  const openAddAttrValue = () => {
    if (!selectedId) return;
    setEditingAttrValueId(null);
    const nextSort = attrValues.length > 0
      ? Math.max(...attrValues.map((v) => v.sortOrder)) + 1
      : 1;
    setAttrValueForm({ ...defaultAttrValueForm, sortOrder: nextSort });
    setAttrValueDialogOpen(true);
  };

  const openEditAttrValue = (item: StyleAttrValue) => {
    setEditingAttrValueId(item.id);
    setAttrValueForm({
      valueCode: item.valueCode,
      valueName: item.valueName,
      sortOrder: item.sortOrder,
      status: item.status,
      remark: item.remark || '',
    });
    setAttrValueDialogOpen(true);
  };

  const handleSaveAttrValue = async () => {
    if (attrValueSubmitting || !selectedId) return;
    if (!attrValueForm.valueCode.trim()) {
      toast.error('请输入值编码');
      return;
    }
    if (!attrValueForm.valueName.trim()) {
      toast.error('请输入值名称');
      return;
    }
    setAttrValueSubmitting(true);
    try {
      if (editingAttrValueId) {
        await baseApi.styleAttrDef.updateValue(editingAttrValueId, attrValueForm);
        toast.success('更新成功');
      } else {
        await baseApi.styleAttrDef.createValue(selectedId, attrValueForm);
        toast.success('新增成功');
      }
      setAttrValueDialogOpen(false);
      fetchAttrValues(selectedId);
    } catch (e) {
      toast.error(errMsg(e, '保存失败'));
    } finally {
      setAttrValueSubmitting(false);
    }
  };

  const handleDeleteAttrValue = async (item: StyleAttrValue) => {
    if (!await showConfirm(`确定要删除属性值「${item.valueName}」吗？`)) return;
    try {
      const res = await baseApi.styleAttrDef.removeValue(item.id);
      if (res.disabled) {
        toast.warning(res.message || '该属性值已被引用，已改为禁用状态');
      } else {
        toast.success('删除成功');
      }
      if (selectedId) {
        fetchAttrValues(selectedId);
      }
    } catch (e) {
      toast.error(errMsg(e, '删除失败'));
    }
  };

  const handleMoveAttrValue = async (index: number, direction: 'up' | 'down') => {
    if (!selectedId) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= attrValues.length) return;

    const newList = [...attrValues];
    [newList[index], newList[newIndex]] = [newList[newIndex], newList[index]];

    setAttrValues(newList);

    const reorderItems = newList.map((item, i) => ({
      id: item.id,
      sortOrder: i + 1,
    }));

    try {
      await baseApi.styleAttrDef.reorderValues(selectedId, reorderItems);
    } catch (e) {
      setAttrValues(attrValues);
      toast.error(errMsg(e, '排序失败'));
    }
  };

  // ====== Render helpers ======
  const renderStatusBadge = (status: string) => {
    if (status === 'active') {
      return (
        <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
          启用
        </span>
      );
    }
    return (
      <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
        禁用
      </span>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      {/* Page title */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">款号属性维护</h2>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-4">
        {/* ====== Left: Attr Def list ====== */}
        <div className="w-[300px] shrink-0 border border-gray-200 rounded-lg flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="font-medium text-gray-800">属性定义</h3>
            <Button
              size="sm"
              variant="default"
              onClick={openAddAttrDef}
              className="h-7 px-2 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              新增
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[calc(100vh-220px)]">
            {attrDefsLoading ? (
              <div className="text-center py-8 text-gray-400 text-sm">加载中...</div>
            ) : attrDefs.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">暂无属性定义</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {attrDefs.map((item, index) => (
                  <li
                    key={item.id}
                    className={`px-3 py-2.5 cursor-pointer transition-colors ${
                      selectedId === item.id
                        ? 'bg-blue-50 border-l-2 border-primary'
                        : 'hover:bg-gray-50 border-l-2 border-transparent'
                    }`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {item.attrName}
                          </span>
                          {renderStatusBadge(item.status)}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {item.attrCode}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 ml-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                          disabled={index === 0}
                          onClick={() => handleMoveAttrDef(index, 'up')}
                          title="上移"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                          disabled={index === attrDefs.length - 1}
                          onClick={() => handleMoveAttrDef(index, 'down')}
                          title="下移"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-primary hover:text-blue-700 hover:bg-blue-50"
                          onClick={() => openEditAttrDef(item)}
                          title="编辑"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDeleteAttrDef(item)}
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ====== Right: Attr Value table ====== */}
        <div className="flex-1 border border-gray-200 rounded-lg flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="font-medium text-gray-800">
              属性值
              {selectedAttrDef && (
                <span className="ml-2 text-sm text-gray-500 font-normal">
                  {selectedAttrDef.attrName}（{selectedAttrDef.attrCode}）
                </span>
              )}
            </h3>
            <Button
              size="sm"
              variant="default"
              onClick={openAddAttrValue}
              disabled={!selectedId}
              className="h-7 px-2 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              新增属性值
            </Button>
          </div>

          <div className="flex-1 overflow-auto">
            {!selectedId ? (
              <div className="text-center py-16 text-gray-400 text-sm">
                请先选择左侧属性定义
              </div>
            ) : attrValuesLoading ? (
              <div className="text-center py-16 text-gray-400 text-sm">加载中...</div>
            ) : attrValues.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">暂无属性值</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="w-16 text-gray-600">排序</TableHead>
                    <TableHead className="text-gray-600">值编码</TableHead>
                    <TableHead className="text-gray-600">值名称</TableHead>
                    <TableHead className="text-gray-600">状态</TableHead>
                    <TableHead className="text-gray-600">备注</TableHead>
                    <TableHead className="w-48 text-gray-600 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attrValues.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-gray-500">{item.sortOrder}</TableCell>
                      <TableCell className="font-medium">{item.valueCode}</TableCell>
                      <TableCell>{item.valueName}</TableCell>
                      <TableCell>{renderStatusBadge(item.status)}</TableCell>
                      <TableCell className="text-gray-500 text-xs max-w-[200px] truncate">
                        {item.remark || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                            disabled={index === 0}
                            onClick={() => handleMoveAttrValue(index, 'up')}
                            title="上移"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                            disabled={index === attrValues.length - 1}
                            onClick={() => handleMoveAttrValue(index, 'down')}
                            title="下移"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-primary hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => openEditAttrValue(item)}
                            title="编辑"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteAttrValue(item)}
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      {/* ====== Attr Def Dialog ====== */}
      <Dialog open={attrDefDialogOpen} onOpenChange={setAttrDefDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingAttrDefId ? '编辑属性定义' : '新增属性定义'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                属性编码 <span className="text-red-500">*</span>
              </label>
              <Input
                value={attrDefForm.attrCode}
                onChange={(e) => setAttrDefForm({ ...attrDefForm, attrCode: e.target.value })}
                placeholder="请输入属性编码"
                disabled={!!editingAttrDefId}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                属性名称 <span className="text-red-500">*</span>
              </label>
              <Input
                value={attrDefForm.attrName}
                onChange={(e) => setAttrDefForm({ ...attrDefForm, attrName: e.target.value })}
                placeholder="请输入属性名称"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">排序号</label>
              <Input
                type="number"
                value={attrDefForm.sortOrder}
                onChange={(e) => setAttrDefForm({ ...attrDefForm, sortOrder: Number(e.target.value) })}
                placeholder="请输入排序号"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">状态</label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={attrDefForm.status === 'active'}
                  onCheckedChange={(checked) =>
                    setAttrDefForm({
                      ...attrDefForm,
                      status: checked ? 'active' : 'inactive',
                    })
                  }
                />
                <span className="text-sm text-gray-600">
                  {attrDefForm.status === 'active' ? '启用' : '禁用'}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">备注</label>
              <Input
                value={attrDefForm.remark}
                onChange={(e) => setAttrDefForm({ ...attrDefForm, remark: e.target.value })}
                placeholder="请输入备注"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAttrDefDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="default"
              onClick={handleSaveAttrDef}
              disabled={attrDefSubmitting}
            >
              {attrDefSubmitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== Attr Value Dialog ====== */}
      <Dialog open={attrValueDialogOpen} onOpenChange={setAttrValueDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingAttrValueId ? '编辑属性值' : '新增属性值'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                值编码 <span className="text-red-500">*</span>
              </label>
              <Input
                value={attrValueForm.valueCode}
                onChange={(e) => setAttrValueForm({ ...attrValueForm, valueCode: e.target.value })}
                placeholder="请输入值编码"
                disabled={!!editingAttrValueId}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                值名称 <span className="text-red-500">*</span>
              </label>
              <Input
                value={attrValueForm.valueName}
                onChange={(e) => setAttrValueForm({ ...attrValueForm, valueName: e.target.value })}
                placeholder="请输入值名称"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">排序号</label>
              <Input
                type="number"
                value={attrValueForm.sortOrder}
                onChange={(e) => setAttrValueForm({ ...attrValueForm, sortOrder: Number(e.target.value) })}
                placeholder="请输入排序号"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">状态</label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={attrValueForm.status === 'active'}
                  onCheckedChange={(checked) =>
                    setAttrValueForm({
                      ...attrValueForm,
                      status: checked ? 'active' : 'inactive',
                    })
                  }
                />
                <span className="text-sm text-gray-600">
                  {attrValueForm.status === 'active' ? '启用' : '禁用'}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">备注</label>
              <Input
                value={attrValueForm.remark}
                onChange={(e) => setAttrValueForm({ ...attrValueForm, remark: e.target.value })}
                placeholder="请输入备注"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAttrValueDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="default"
              onClick={handleSaveAttrValue}
              disabled={attrValueSubmitting}
            >
              {attrValueSubmitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StyleAttrDefPage;
