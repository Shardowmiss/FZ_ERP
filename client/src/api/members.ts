import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  Member,
  MemberQuery,
  CreateMemberDto,
  UpdateMemberDto,
  PointsLog,
  StoredLog,
  Coupon,
  RechargeDto,
  IssueCouponDto,
  LevelCount,
  SaleOrder,
  ListResponse,
} from '@shared/api.interface';

export async function getMembers(
  params: MemberQuery,
): Promise<ListResponse<Member>> {
  try {
    const response = await axiosForBackend.get('/api/members', { params });
    return response.data;
  } catch (error) {
    logger.error('getMembers failed', error as Error);
    throw error;
  }
}

export async function getMemberById(id: string): Promise<Member> {
  try {
    const response = await axiosForBackend.get(`/api/members/${id}`);
    return response.data;
  } catch (error) {
    logger.error('getMemberById failed', error as Error);
    throw error;
  }
}

export async function createMember(
  data: CreateMemberDto,
): Promise<Member> {
  try {
    const response = await axiosForBackend.post('/api/members', data);
    return response.data;
  } catch (error) {
    logger.error('createMember failed', error as Error);
    throw error;
  }
}

export async function updateMember(
  id: string,
  data: UpdateMemberDto,
): Promise<Member> {
  try {
    const response = await axiosForBackend.patch(
      `/api/members/${id}`,
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('updateMember failed', error as Error);
    throw error;
  }
}

export async function getLevelCounts(): Promise<LevelCount[]> {
  try {
    const response = await axiosForBackend.get('/api/members/level/counts');
    return response.data;
  } catch (error) {
    logger.error('getLevelCounts failed', error as Error);
    throw error;
  }
}

export async function getPointsLog(
  memberId: string,
  page: number = 1,
  pageSize: number = 10,
): Promise<ListResponse<PointsLog>> {
  try {
    const response = await axiosForBackend.get(
      `/api/members/${memberId}/points-log`,
      { params: { page, pageSize } },
    );
    return response.data;
  } catch (error) {
    logger.error('getPointsLog failed', error as Error);
    throw error;
  }
}

export async function getStoredLog(
  memberId: string,
  page: number = 1,
  pageSize: number = 10,
): Promise<ListResponse<StoredLog>> {
  try {
    const response = await axiosForBackend.get(
      `/api/members/${memberId}/stored-log`,
      { params: { page, pageSize } },
    );
    return response.data;
  } catch (error) {
    logger.error('getStoredLog failed', error as Error);
    throw error;
  }
}

export async function getCoupons(memberId: string): Promise<Coupon[]> {
  try {
    const response = await axiosForBackend.get(
      `/api/members/${memberId}/coupons`,
    );
    return response.data;
  } catch (error) {
    logger.error('getCoupons failed', error as Error);
    throw error;
  }
}

export async function getMemberOrders(
  memberId: string,
  page: number = 1,
  pageSize: number = 5,
): Promise<ListResponse<SaleOrder>> {
  try {
    const response = await axiosForBackend.get(
      `/api/members/${memberId}/orders`,
      { params: { page, pageSize } },
    );
    return response.data;
  } catch (error) {
    logger.error('getMemberOrders failed', error as Error);
    throw error;
  }
}

export async function recharge(
  memberId: string,
  data: RechargeDto,
): Promise<StoredLog> {
  try {
    const response = await axiosForBackend.post(
      `/api/members/${memberId}/recharge`,
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('recharge failed', error as Error);
    throw error;
  }
}

export async function issueCoupon(
  memberId: string,
  data: IssueCouponDto,
): Promise<Coupon> {
  try {
    const response = await axiosForBackend.post(
      `/api/members/${memberId}/issue-coupon`,
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('issueCoupon failed', error as Error);
    throw error;
  }
}
