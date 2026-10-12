import { useAuth } from '@client/src/contexts/AuthContext';

/**
 * 页面动作级门控的唯一入口（#807）。
 *
 * 背景：此前 141 个页面文件里只有 17 个做了动作级门控，其余页面「有权限就全放开」——
 * 于是只配了「查看」的角色登录后依然看得到新增/删除/审核/作废按钮（点下去由后端 403，
 * 但体验上是明显的权限不一致）。本 hook 把「资源码 + 动作」收敛成一处，
 * 页面只写 `const { canCreate } = usePageActions('base:color')`。
 *
 * 语义（必须遵守，勿自行改写）：
 * - 一律走 `hasPermission`（**动作级，严格父→子**）。绝不能用 `hasMenu`——那是访问级，
 *   会把只持 `:view` 的只读角色一起放行，正是要修的那个 bug。
 * - 资源码必须取自 `menuConfig.routeComponents` 的 permission（唯一真相源）；
 *   动作码 `${code}:${action}` 必须在权限目录里存在，否则 hasPermission 恒 false，
 *   按钮会对**所有人**（含超管）消失 —— 加新动作前先确认 `shared/menu-permission.ts`
 *   的 MENU_STRUCTURE 已声明该动作。
 *
 * canSave 说明：编辑类页面「保存」在新建态靠 create、在编辑态靠 edit，
 * 二者任一即可保存；分开判会出现「能打开新增弹窗却不能保存」的割裂。
 */
export type PageAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'void' | 'submit';

export interface PageActions {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canVoid: boolean;
  canSubmit: boolean;
  /** 保存：新建或编辑任一有权限即可 */
  canSave: boolean;
}

export function usePageActions(menu: string): PageActions {
  const { hasPermission } = useAuth();
  const canView = hasPermission(`${menu}:view`);
  const canCreate = hasPermission(`${menu}:create`);
  const canEdit = hasPermission(`${menu}:edit`);
  const canDelete = hasPermission(`${menu}:delete`);
  const canApprove = hasPermission(`${menu}:approve`);
  const canVoid = hasPermission(`${menu}:void`);
  const canSubmit = hasPermission(`${menu}:submit`);
  return {
    canView,
    canCreate,
    canEdit,
    canDelete,
    canApprove,
    canVoid,
    canSubmit,
    canSave: canCreate || canEdit,
  };
}

export default usePageActions;
