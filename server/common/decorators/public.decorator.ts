import { SetMetadata } from '@nestjs/common';

/**
 * 标记路由为公开（无需登录即可访问）。
 * 用于登录、登出等鉴权前置接口；未标记且路径以 /api/ 开头的接口均需有效 token。
 */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
