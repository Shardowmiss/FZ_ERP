import { ReactNode } from 'react';
import { useAuth } from '@client/src/contexts/AuthContext';

/**
 * 动作级按钮门控（#807 全量补齐时升级为通用包裹器）。
 *
 * 为什么是**组件**而不是 `{can && (...)}` 表达式：
 * 单据页大量按钮形如 `{item.status === 'draft' && (<button>审核</button>)}`，
 * 按钮是括号内唯一表达式；若在外面再套 `{canApprove && (...)}` 会变成 `( {expr} )`——
 * 非法 JSX（tsc TS1005）。组件是合法 JSX 元素，在原按钮合法的**任何**上下文里都合法。
 *
 * 语义：内部走 `hasPermission`（动作级，严格父→子），**不是** `hasMenu`。
 * 用 hasMenu 会把只持 `:view` 的只读角色一起放行，那正是要修的越权。
 *
 * 前置条件：`${menu}:${action}` 必须已存在于权限目录（shared/menu-permission.ts 的
 * MENU_STRUCTURE.actions）。目录里没有的码 → hasPermission 恒 false → 按钮对所有人消失。
 * 加新动作前先用 scripts/check-permission-sync.cjs 核对。
 */
interface CanButtonProps {
  menu: string;
  action:
    | 'view'
    | 'create'
    | 'edit'
    | 'delete'
    | 'approve'
    | 'accept'
    | 'void'
    | 'print'
    | 'submit';
  children: ReactNode;
  fallback?: ReactNode;
}

const CanButton = ({ menu, action, children, fallback = null }: CanButtonProps) => {
  const { hasPermission } = useAuth();
  const code = `${menu}:${action}`;

  if (!hasPermission(code)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

/**
 * 「保存」专用门控：新建态靠 create、编辑态靠 edit，二者任一即可。
 * 拆成两个码判会出现「能打开新增弹窗却点不了保存」的割裂，故单独给一个或语义组件。
 */
export const CanSave = ({
  menu,
  children,
  fallback = null,
}: {
  menu: string;
  children: ReactNode;
  fallback?: ReactNode;
}) => {
  const { hasPermission } = useAuth();
  const ok = hasPermission(`${menu}:create`) || hasPermission(`${menu}:edit`);
  return <>{ok ? children : fallback}</>;
};

export default CanButton;
