import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronRight, ChevronDown, Save, Shield } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { Button } from '@client/src/components/ui/button';
import { Checkbox } from '@client/src/components/ui/checkbox';
import { rbacApi } from '@client/src/api/rbac';
import { errMsg } from '@/utils/errMsg';
import type { RbacRole, RbacPermission } from '@shared/api.interface';

interface PermissionTreeNode extends RbacPermission {
  children?: PermissionTreeNode[];
}

/** 收集节点及其所有后代的 id */
function collectDescendantIds(node: PermissionTreeNode): string[] {
  const ids: string[] = [node.id];
  if (node.children) {
    for (const child of node.children) {
      ids.push(...collectDescendantIds(child));
    }
  }
  return ids;
}

/** 查找从根到目标节点路径上的所有祖先菜单节点（不含自身） */
function findAncestorMenus(
  tree: PermissionTreeNode[],
  targetId: string,
): PermissionTreeNode[] {
  const path: PermissionTreeNode[] = [];
  const dfs = (nodes: PermissionTreeNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === targetId) return true;
      if (n.children) {
        path.push(n);
        if (dfs(n.children)) return true;
        path.pop();
      }
    }
    return false;
  };
  dfs(tree);
  return path.filter((n: PermissionTreeNode) => n.type === 'menu');
}

/**
 * 权限树节点组件
 */
interface TreeNodeItemProps {
  node: PermissionTreeNode;
  depth: number;
  checkedIds: Set<string>;
  onToggle: (node: PermissionTreeNode, checked: boolean) => void;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  depth,
  checkedIds,
  onToggle,
}) => {
  const isMenu = node.type === 'menu';
  const hasChildren = isMenu && node.children && node.children.length > 0;
  const [expanded, setExpanded] = useState<boolean>(true);

  /**
   * 判断节点勾选状态
   * 'all'  = 全部子节点都勾选
   * 'some' = 部分子节点勾选（indeterminate）
   * 'none' = 都没勾选
   */
  const getCheckState = (
    n: PermissionTreeNode,
  ): 'all' | 'some' | 'none' => {
    if (!n.children || n.children.length === 0) {
      return checkedIds.has(n.id) ? 'all' : 'none';
    }
    let allCount = 0;
    let noneCount = 0;
    const total = n.children.length;
    for (const child of n.children) {
      const state = getCheckState(child);
      if (state === 'all') allCount += 1;
      else if (state === 'none') noneCount += 1;
      // 'some' 直接返回 some，不需要继续统计
    }
    if (allCount === total) return 'all';
    if (noneCount === total) {
      // 子节点全没勾，但自身可能有独立权限（菜单自身的可见权限）
      return checkedIds.has(n.id) ? 'all' : 'none';
    }
    return 'some';
  };

  const checkState = getCheckState(node);
  const isChecked = checkState === 'all';
  const isIndeterminate = checkState === 'some';

  return (
    <div key={node.id}>
      <div
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded cursor-pointer"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => {
          if (isMenu && hasChildren) {
            setExpanded(!expanded);
          }
        }}
      >
        {isMenu && hasChildren ? (
          <span className="text-gray-400 w-4 h-4 flex items-center justify-center shrink-0">
            {expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <Checkbox
          checked={isChecked}
          onCheckedChange={(checked: boolean) => {
            onToggle(node, checked === true);
          }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          {...(isIndeterminate ? { 'data-state': 'indeterminate' as const } : {})}
        />
        <span
          className={`text-sm ${
            isMenu ? 'font-medium text-gray-800' : 'text-gray-600'
          }`}
        >
          {node.name}
        </span>
        {!isMenu && (
          <span className="text-xs text-gray-400">
            ({node.code.split(':').pop()})
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child: PermissionTreeNode) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              checkedIds={checkedIds}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 权限配置页面
 * 左侧角色列表，右侧权限树
 */
const PermissionManagePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const urlRoleId = searchParams.get('roleId') ?? '';

  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [permissionTree, setPermissionTree] = useState<PermissionTreeNode[]>(
    [],
  );
  const [loadingTree, setLoadingTree] = useState<boolean>(false);
  const [loadingRoles, setLoadingRoles] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // 所有已勾选的权限 id 集合
  const checkedIdsRef = useRef<Set<string>>(new Set());
  // 加载时的原始权限 id 集合（用于判断是否有未保存修改）
  const originalIdsRef = useRef<Set<string>>(new Set());
  // 用于触发重渲染
  const [, setTick] = useState<number>(0);
  const forceUpdate = (): void => setTick((t) => t + 1);

  const isAdminRole = useMemo(() => {
    const role = roles.find((r: RbacRole) => r.id === selectedRoleId);
    return role?.code === 'admin';
  }, [roles, selectedRoleId]);

  // 加载角色列表
  const loadRoles = async (): Promise<void> => {
    setLoadingRoles(true);
    try {
      const res = await rbacApi.roles.list({ page: 1, pageSize: 100 });
      setRoles(res.items);
    } catch (e) {
      toast.error(errMsg(e, '加载角色列表失败'));
    } finally {
      setLoadingRoles(false);
    }
  };

  // 加载权限树
  const loadTree = async (): Promise<void> => {
    setLoadingTree(true);
    try {
      const tree = await rbacApi.permissions.tree();
      setPermissionTree(tree as PermissionTreeNode[]);
    } catch (e) {
      toast.error(errMsg(e, '加载权限树失败'));
    } finally {
      setLoadingTree(false);
    }
  };

  /** 收集权限树中所有权限 id */
  const getAllPermissionIds = (tree: PermissionTreeNode[]): string[] => {
    const ids: string[] = [];
    const walk = (nodes: PermissionTreeNode[]): void => {
      for (const n of nodes) {
        ids.push(n.id);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return ids;
  };

  // 加载角色权限
  const loadRolePermissions = async (roleId: string): Promise<void> => {
    try {
      const role = roles.find((r: RbacRole) => r.id === roleId);
      let ids: string[];
      if (role?.code === 'admin') {
        // admin 角色默认拥有全部权限
        ids = getAllPermissionIds(permissionTree);
      } else {
        ids = await rbacApi.roles.getPermissions(roleId);
      }
      checkedIdsRef.current = new Set(ids);
      originalIdsRef.current = new Set(ids);
      forceUpdate();
    } catch (e) {
      toast.error(errMsg(e, '加载角色权限失败'));
    }
  };

  // 判断是否有未保存的修改
  const hasUnsavedChanges = (): boolean => {
    const current = checkedIdsRef.current;
    const original = originalIdsRef.current;
    if (current.size !== original.size) return true;
    for (const id of current) {
      if (!original.has(id)) return true;
    }
    return false;
  };

  // 切换角色
  const handleSelectRole = async (roleId: string): Promise<void> => {
    if (roleId === selectedRoleId) return;
    if (hasUnsavedChanges()) {
      const confirmed = await showConfirm(
        '当前角色的权限配置尚未保存，切换角色将丢失修改，是否继续？',
      );
      if (!confirmed) return;
    }
    setSelectedRoleId(roleId);
  };

  useEffect(() => {
    loadRoles();
    loadTree();
  }, []);

  // 角色列表加载后，根据 URL 参数或默认选中第一个
  useEffect(() => {
    if (roles.length === 0) return;
    if (urlRoleId && roles.some((r: RbacRole) => r.id === urlRoleId)) {
      setSelectedRoleId(urlRoleId);
    } else if (!selectedRoleId) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles]);

  // 选中角色变化时，加载对应权限
  useEffect(() => {
    if (!selectedRoleId || permissionTree.length === 0) return;
    loadRolePermissions(selectedRoleId);
  }, [selectedRoleId, permissionTree.length]);

  /**
   * 切换一个节点的勾选状态
   * - 勾选菜单：自动勾选其所有子菜单和按钮，并确保所有祖先菜单被勾选
   * - 取消菜单：自动取消所有子菜单和按钮
   * - 勾选按钮：自动勾选其父菜单（及所有祖先）
   * - 取消按钮：仅取消自身（父菜单可能变为 indeterminate）
   */
  const handleToggle = (
    node: PermissionTreeNode,
    checked: boolean,
  ): void => {
    const descendantIds = collectDescendantIds(node);

    if (checked) {
      // 勾选：加入自身和所有后代
      for (const id of descendantIds) {
        checkedIdsRef.current.add(id);
      }
      // 向上勾选所有祖先菜单节点
      const ancestors = findAncestorMenus(permissionTree, node.id);
      for (const anc of ancestors) {
        checkedIdsRef.current.add(anc.id);
      }
    } else {
      // 取消：移除自身和所有后代
      for (const id of descendantIds) {
        checkedIdsRef.current.delete(id);
      }
    }

    forceUpdate();
  };

  const handleSave = async (): Promise<void> => {
    if (!selectedRoleId) {
      toast.error('请先选择角色');
      return;
    }
    setSaving(true);
    try {
      const ids = Array.from(checkedIdsRef.current);
      if (isAdminRole) {
        // admin 角色不真正写配置，仍提示保存成功（前端模拟）
        toast.success('权限保存成功（admin角色默认拥有全部权限）');
      } else {
        await rbacApi.roles.setPermissions(selectedRoleId, ids);
        toast.success('权限保存成功');
      }
      originalIdsRef.current = new Set(ids);
    } catch (e) {
      toast.error(errMsg(e, '权限保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const selectedRoleName = useMemo(() => {
    const role = roles.find((r: RbacRole) => r.id === selectedRoleId);
    return role ? role.name : '';
  }, [roles, selectedRoleId]);

  return (
    <div className="space-y-4">
      <div
        className="bg-white rounded-lg shadow-sm overflow-hidden flex"
        style={{ minHeight: 'calc(100vh - 180px)' }}
      >
        {/* 左侧角色列表 */}
        <div
          className="w-56 border-r border-gray-200 bg-gray-50 flex flex-col"
          style={{ width: '220px' }}
        >
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Shield size={16} className="text-blue-500" /> 角色列表
            </h2>
          </div>
          <div className="py-1 flex-1 overflow-y-auto">
            {loadingRoles ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                加载中...
              </div>
            ) : roles.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                暂无角色
              </div>
            ) : (
              roles.map((role: RbacRole) => (
                <div
                  key={role.id}
                  onClick={() => handleSelectRole(role.id)}
                  className={`px-4 py-2.5 text-sm cursor-pointer border-l-2 transition-colors ${
                    selectedRoleId === role.id
                      ? 'bg-white border-l-blue-500 text-blue-600 font-medium'
                      : 'border-l-transparent text-gray-600 hover:bg-white hover:text-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{role.name}</span>
                    {role.code === 'admin' && (
                      <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded">
                        管理员
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {role.code}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧权限配置 */}
        <div className="flex-1 flex flex-col">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">权限配置</h2>
              {selectedRoleName && (
                <p className="text-sm text-gray-500 mt-0.5">
                  当前角色：{selectedRoleName}
                  {isAdminRole && (
                    <span className="ml-2 text-amber-500">
                      （管理员默认拥有全部权限）
                    </span>
                  )}
                </p>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={!selectedRoleId || saving}
              className="flex items-center gap-1.5"
            >
              <Save size={16} />
              {saving ? '保存中...' : '保存权限'}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {loadingTree ? (
              <div className="text-center py-16 text-gray-400">加载中...</div>
            ) : permissionTree.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                暂无权限数据
              </div>
            ) : !selectedRoleId ? (
              <div className="text-center py-16 text-gray-400">
                请从左侧选择一个角色
              </div>
            ) : (
              <div className="space-y-2">
                {permissionTree.map((node: PermissionTreeNode) => (
                  <TreeNodeItem
                    key={node.id}
                    node={node}
                    depth={0}
                    checkedIds={checkedIdsRef.current}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PermissionManagePage;
