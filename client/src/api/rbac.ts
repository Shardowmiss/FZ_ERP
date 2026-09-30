import { request } from './request';
import type {
  RbacUser,
  RbacRole,
  RbacPermission,
  LoginResponse,
  CurrentUserResponse,
  PaginationResult,
} from '@shared/api.interface';

export const rbacApi = {
  login: (data: { username: string; password: string }) =>
    request<LoginResponse>('/api/auth/login', 'POST', data),
  logout: () =>
    request<void>('/api/auth/logout', 'POST'),
  me: () =>
    request<CurrentUserResponse>('/api/auth/me'),
  updateMyLanguage: (language: string) =>
    request<CurrentUserResponse>('/api/auth/me/language', 'PATCH', { language }),

  users: {
    list: (params: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
      request<PaginationResult<RbacUser>>('/api/rbac/users', 'GET', null, params),
    get: (id: string) =>
      request<RbacUser>(`/api/rbac/users/${id}`),
    create: (data: { username: string; name: string; password: string; phone?: string; department?: string; status?: string; remark?: string; roleIds?: string[] }) =>
      request<RbacUser>('/api/rbac/users', 'POST', data),
    update: (id: string, data: Partial<{ username: string; name: string; password: string; phone?: string; department?: string; status?: string; remark?: string; roleIds?: string[] }>) =>
      request<RbacUser>(`/api/rbac/users/${id}`, 'PUT', data),
    remove: (id: string) =>
      request<void>(`/api/rbac/users/${id}`, 'DELETE'),

    setRoles: (id: string, roleIds: string[]) =>
      request<void>(`/api/rbac/users/${id}/roles`, 'PUT', { roleIds }),
  },

  roles: {
    list: (params: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
      request<PaginationResult<RbacRole>>('/api/rbac/roles', 'GET', null, params),
    all: () =>
      request<RbacRole[]>('/api/rbac/roles/all'),
    get: (id: string) =>
      request<RbacRole>(`/api/rbac/roles/${id}`),
    create: (data: { code: string; name: string; description?: string; status?: string }) =>
      request<RbacRole>('/api/rbac/roles', 'POST', data),
    update: (id: string, data: Partial<{ code: string; name: string; description?: string; status?: string }>) =>
      request<RbacRole>(`/api/rbac/roles/${id}`, 'PUT', data),
    remove: (id: string) =>
      request<void>(`/api/rbac/roles/${id}`, 'DELETE'),

    getPermissions: (id: string) =>
      request<string[]>(`/api/rbac/roles/${id}/permissions`),
    setPermissions: (id: string, permissionIds: string[]) =>
      request<void>(`/api/rbac/roles/${id}/permissions`, 'PUT', { permissionIds }),
  },

  permissions: {
    tree: () =>
      request<RbacPermission[]>('/api/rbac/permissions/tree'),
    menuTree: () =>
      request<RbacPermission[]>('/api/rbac/permissions/menu-tree'),
  },
};
