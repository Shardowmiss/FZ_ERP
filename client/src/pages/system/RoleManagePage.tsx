import React, { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
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
import { Textarea } from '@client/src/components/ui/textarea';
import { Badge } from '@client/src/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@client/src/components/ui/select';
import { rbacApi } from '@client/src/api';
import type { RbacRole } from '@shared/api.interface';
import { errMsg } from '@/utils/errMsg';

const statusLabel: Record<string, string> = { active: '启用', inactive: '禁用' };

const getStatusBadgeVariant = (
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'active') return 'default';
  return 'secondary';
};

const RoleManagePage: React.FC = () => {
  const [list, setList] = useState<RbacRole[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [keyword, setKeyword] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  const [showModal, setShowModal] = useState<boolean>(false);
  const [editId, setEditId] = useState<string>('');
  const [formCode, setFormCode] = useState<string>('');
  const [formName, setFormName] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formStatus, setFormStatus] = useState<string>('active');

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: { page: number; pageSize: number; keyword?: string; status?: string } = {
        page,
        pageSize,
      };
      if (keyword) params.keyword = keyword;
      if (filterStatus) params.status = filterStatus;
      const res = await rbacApi.roles.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, keyword, filterStatus]);

  const openAdd = (): void => {
    setEditId('');
    setFormCode('');
    setFormName('');
    setFormDescription('');
    setFormStatus('active');
    setShowModal(true);
  };

  const openEdit = async (id: string): Promise<void> => {
    try {
      const role = await rbacApi.roles.get(id);
      setEditId(id);
      setFormCode(role.code);
      setFormName(role.name);
      setFormDescription(role.description ?? '');
      setFormStatus(role.status);
      setShowModal(true);
    } catch (e) {
      toast(errMsg(e, '加载角色信息失败'));
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!editId && !formCode.trim()) {
      toast('请输入角色编码');
      return;
    }
    if (!formName.trim()) {
      toast('请输入角色名称');
      return;
    }
    const data: {
      code: string;
      name: string;
      description?: string;
      status: string;
    } = {
      code: formCode.trim(),
      name: formName.trim(),
      description: formDescription || undefined,
      status: formStatus,
    };
    try {
      if (editId) {
        await rbacApi.roles.update(editId, {
          name: data.name,
          description: data.description,
          status: data.status,
        });
      } else {
        await rbacApi.roles.create(data);
      }
      toast('保存成功');
      setShowModal(false);
      fetchList();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    }
  };

  const handleToggleStatus = async (role: RbacRole): Promise<void> => {
    const newStatus = role.status === 'active' ? 'inactive' : 'active';
    const action = newStatus === 'active' ? '启用' : '禁用';
    const confirmed = await showConfirm(`确定${action}该角色吗？`);
    if (!confirmed) return;
    try {
      await rbacApi.roles.update(role.id, { status: newStatus });
      toast(`${action}成功`);
      fetchList();
    } catch {
      toast(`${action}失败`);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    const confirmed = await showConfirm('确定删除该角色吗？');
    if (!confirmed) return;
    try {
      await rbacApi.roles.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* 搜索栏 */}
      <div className="bg-white rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">角色管理</h1>
          <Button onClick={openAdd} className="flex items-center gap-1">
            <Plus size={16} /> 新增角色
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">状态：</span>
            <Select value={filterStatus} onValueChange={(val: string) => { setFilterStatus(val); setPage(1); }}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部</SelectItem>
                <SelectItem value="active">启用</SelectItem>
                <SelectItem value="inactive">禁用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              value={keyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              placeholder="搜索角色编码/名称"
              className="pl-8 w-56 h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600 bg-gray-50">
              <th className="text-left py-2.5 px-4 font-medium">角色编码</th>
              <th className="text-left py-2.5 px-4 font-medium">角色名称</th>
              <th className="text-left py-2.5 px-4 font-medium">角色描述</th>
              <th className="text-left py-2.5 px-4 font-medium">状态</th>
              <th className="text-left py-2.5 px-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              list.map((item: RbacRole) => (
                <tr
                  key={item.id}
                  className="border-b border-gray-100 h-10 hover:bg-gray-50"
                >
                  <td className="py-2 px-4 font-medium text-gray-800">{item.code}</td>
                  <td className="py-2 px-4">{item.name}</td>
                  <td className="py-2 px-4 text-gray-500">{item.description || '-'}</td>
                  <td className="py-2 px-4">
                    <Badge variant={getStatusBadgeVariant(item.status)}>
                      {statusLabel[item.status] ?? item.status}
                    </Badge>
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => openEdit(item.id)}
                        className="text-primary hover:text-blue-600"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleToggleStatus(item)}
                        className="text-orange-500 hover:text-orange-600"
                      >
                        {item.status === 'active' ? '禁用' : '启用'}
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-end px-4 py-3 border-t border-gray-100 text-sm">
          <span className="text-gray-500 mr-4">共 {total} 条</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p: number) => Math.max(1, p - 1))}
            className="mr-2"
          >
            上一页
          </Button>
          <span className="text-gray-600 mr-2">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
          >
            下一页
          </Button>
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? '编辑角色' : '新增角色'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                角色编码 <span className="text-red-500">*</span>
              </label>
              <Input
                value={formCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormCode(e.target.value)}
                placeholder="请输入角色编码"
                disabled={!!editId}
                className={editId ? 'bg-gray-50' : ''}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                角色名称 <span className="text-red-500">*</span>
              </label>
              <Input
                value={formName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)}
                placeholder="请输入角色名称"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">状态</label>
              <Select value={formStatus} onValueChange={(val: string) => setFormStatus(val)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="inactive">禁用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">角色描述</label>
              <Textarea
                value={formDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormDescription(e.target.value)}
                placeholder="请输入角色描述"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              取消
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RoleManagePage;
