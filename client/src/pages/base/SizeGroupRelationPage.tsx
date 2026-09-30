import React, { useState, useEffect, useCallback } from 'react';
import { baseApi } from '@client/src/api';
import type { SizeGroup, SizeGroupSize, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { errMsg } from '@/utils/errMsg';

interface SizeOption {
  id: string;
  code: string;
  name: string;
}

const SizeGroupRelationPage: React.FC = () => {
  const [groups, setGroups] = useState<SizeGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<SizeGroupSize[]>([]);
  const [sizeOptions, setSizeOptions] = useState<SizeOption[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedSizeId, setSelectedSizeId] = useState<string>('');

  const loadGroups = useCallback(async () => {
    setGroupLoading(true);
    try {
      const res: PaginationResult<SizeGroup> = await baseApi.sizeGroup.list({ page: 1, pageSize: 200 });
      setGroups(res.items);
      if (!selectedGroupId && res.items.length > 0) {
        setSelectedGroupId(res.items[0].id);
      }
    } catch (e) {
      toast(errMsg(e, '加载尺码组失败'));
    } finally {
      setGroupLoading(false);
    }
  }, [selectedGroupId]);

  const loadMembers = useCallback(async (groupId: string) => {
    setMemberLoading(true);
    try {
      const res = await baseApi.sizeGroup.members(groupId);
      setMembers(res);
    } catch (e) {
      toast(errMsg(e, '加载关系失败'));
    } finally {
      setMemberLoading(false);
    }
  }, []);

  const loadSizeOptions = useCallback(async () => {
    try {
      const res = await baseApi.size.options();
      setSizeOptions(res);
    } catch (e) {
      toast(errMsg(e, '加载尺码选项失败'));
    }
  }, []);

  useEffect(() => {
    loadGroups();
    loadSizeOptions();
  }, [loadGroups, loadSizeOptions]);

  useEffect(() => {
    if (selectedGroupId) {
      loadMembers(selectedGroupId);
    } else {
      setMembers([]);
    }
  }, [selectedGroupId, loadMembers]);

  const handleRemove = async (sizeId: string) => {
    if (!selectedGroupId) return;
    if (!await showConfirm('确定从该尺码组移除该尺码吗？')) return;
    try {
      const res = await baseApi.sizeGroup.removeMember(selectedGroupId, sizeId);
      setMembers(res);
    } catch (e) {
      toast(errMsg(e, '移除失败'));
    }
  };

  const handleAdd = async () => {
    if (!selectedGroupId) { toast('请先选择尺码组'); return; }
    if (!selectedSizeId) { toast('请选择要添加的尺码'); return; }
    try {
      const res = await baseApi.sizeGroup.addMember(selectedGroupId, selectedSizeId);
      setMembers(res);
      setAddOpen(false);
      setSelectedSizeId('');
    } catch (e) {
      toast(errMsg(e, '添加失败'));
    }
  };

  const availableOptions = sizeOptions.filter(
    (o) => !members.some((m) => m.sizeId === o.id),
  );

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">尺码组与尺码关系</h2>
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setAddOpen(true)}
          disabled={!selectedGroupId}
        >
          + 添加尺码
        </button>
      </div>

      <div className="flex gap-4">
        {/* 左侧：尺码组列表 */}
        <div className="w-60 shrink-0 border border-gray-200 rounded">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-600">
            尺码组
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {groupLoading ? (
              <div className="px-3 py-4 text-center text-gray-400 text-sm">加载中...</div>
            ) : groups.length === 0 ? (
              <div className="px-3 py-4 text-center text-gray-400 text-sm">暂无尺码组</div>
            ) : (
              groups.map((g) => (
                <div
                  key={g.id}
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`px-3 py-2 text-sm cursor-pointer border-b border-gray-100 ${
                    selectedGroupId === g.id ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-gray-400">{g.code}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧：成员关系 */}
        <div className="flex-1">
          {!selectedGroupId ? (
            <div className="text-center py-16 text-gray-400 text-sm">请选择左侧尺码组</div>
          ) : (
            <TableContainer>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 font-medium">
                    <th className="text-left px-4 py-3 border-b border-gray-200">尺码编码</th>
                    <th className="text-left px-4 py-3 border-b border-gray-200">尺码名称</th>
                    <th className="text-left px-4 py-3 border-b border-gray-200">排序</th>
                    <th className="text-left px-4 py-3 border-b border-gray-200 w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {memberLoading ? (
                    <tr><td colSpan={4} className="text-center py-8 text-gray-400">加载中...</td></tr>
                  ) : members.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-gray-400">该尺码组暂未关联尺码</td></tr>
                  ) : (
                    members.map((m) => (
                      <tr key={m.sizeId} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-3">{m.sizeCode}</td>
                        <td className="px-4 py-3">{m.sizeName}</td>
                        <td className="px-4 py-3 text-gray-600">{m.sortOrder ?? 0}</td>
                        <td className="px-4 py-3">
                          <button className="text-red-500 hover:text-red-700" onClick={() => handleRemove(m.sizeId)}>移除</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableContainer>
          )}
        </div>
      </div>

      {addOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[420px] max-w-[95vw] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">添加尺码</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={() => setAddOpen(false)}>×</button>
            </div>
            <div className="p-5">
              {availableOptions.length === 0 ? (
                <div className="text-sm text-gray-500 py-4 text-center">
                  暂无可用尺码（所有尺码已加入该尺码组）
                </div>
              ) : (
                <select
                  value={selectedSizeId}
                  onChange={(e) => setSelectedSizeId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                >
                  <option value="">请选择尺码</option>
                  {availableOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}（{o.code}）</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={() => setAddOpen(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleAdd}
                disabled={availableOptions.length === 0 || !selectedSizeId}
              >
                确定添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SizeGroupRelationPage;
