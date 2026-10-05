import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { CommonModule } from './common/common.module';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { DataScopeInterceptor } from './common/interceptors/data-scope.interceptor';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { ErpCsrfGuard } from './common/guards/erp-csrf.guard';
import { RbacService } from './modules/rbac/rbac.service';
import { ViewModule } from './modules/view/view.module';
import { BaseModule } from './modules/base/base.module';
import { BomModule } from './modules/bom/bom.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { SalesModule } from './modules/sales/sales.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SystemModule } from './modules/system/system.module';
import { TradeShowModule } from './modules/trade-show/trade-show.module';
import { RetailModule } from './modules/retail/retail.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { ReportModule } from './modules/report/report.module';
import { ProductionModule } from './modules/production/production.module';
import { SubcontractModule } from './modules/subcontract/subcontract.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MemberModule } from './modules/member/member.module';
import { MasterDataMergeModule } from './modules/master-data-merge/master-data-merge.module';
import { OmniModule } from './modules/omni/omni.module';
import { PosModule } from './modules/pos/pos.module';
import { PosReceiverModule } from './modules/pos-receiver/pos-receiver.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { OpsModule } from './modules/ops/ops.module';
import { HangtagModule } from './modules/hangtag/hangtag.module';
import { UniqueCodeModule } from './modules/unique-code/unique-code.module';
import { ConsistencyModule } from './modules/consistency/consistency.module';
import { HealthModule } from './modules/health/health.module';
import { EventsModule } from './modules/events/events.module';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
  imports: [
    PlatformModule.forRoot(),
    // 性能优化：全局内存缓存（单实例默认内存存储；多实例时切换为 Redis 存储即可）。
    // 用于缓存计价所需的“生效中价格表/促销”等低频变更参考数据，降低每次收银/报价的 PG 压力。
    CacheModule.register({
      isGlobal: true,
      ttl: 60000,
      max: 500,
    }),
    // 安全加固：全局限流（默认内存存储）。ttl 单位为毫秒。
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }],
    }),
    CommonModule,
    BaseModule,
    BomModule,
    PurchaseModule,
    SalesModule,
    InventoryModule,
    FinanceModule,
    DashboardModule,
    SystemModule,
    TradeShowModule,
    RetailModule,
    RbacModule,
    ReportModule,
    ProductionModule,
    SubcontractModule,
    AnalyticsModule,
    MemberModule,
    MasterDataMergeModule,
    OmniModule,
    PosModule,
    PosReceiverModule,
    PricingModule,
    OpsModule,
    HangtagModule,
    UniqueCodeModule,
    ConsistencyModule,
    HealthModule,
    EventsModule,
    MetricsModule,
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // 安全加固：全局限流守卫，与 AuthGuard 并存（APP_GUARD 为累加注册，二者均生效）
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // 接口级权限守卫：全局生效（与 AuthGuard/ThrottlerGuard 累加，且在鉴权之后执行）。
    // 未标注 @CheckPermission 的接口默认放行（向后兼容）；标注了的按权限码校验，
    // 关闭“认证通过即几乎无所不能”的越权隐患。
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    // 应用层自签 CSRF 守卫（D.1）：对状态变更 + 非公开 + 非机器端点强制校验
    // erp-csrf 令牌（cookie===header 且 HMAC 有效）。跳过只读方法 / @Public() / /api/pos-receiver。
    {
      provide: APP_GUARD,
      useClass: ErpCsrfGuard,
    },
    // 审计：全局拦截器覆盖所有写操作，自动记录操作日志（异步落库、不阻断业务）
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // 数据权限：全局拦截器解析当前用户的经销商作用域并写入请求上下文，
    // 供核心单据 / 库存查询自动拼接行级过滤，消除跨租户水平越权（IDOR）。
    {
      provide: APP_INTERCEPTOR,
      useClass: DataScopeInterceptor,
    },
  ],
})
export class AppModule implements OnModuleInit {
  // 依赖 RbacService（@Global 模块导出）以确保启动时权限目录完整。
  constructor(private readonly rbacService: RbacService) {}

  async onModuleInit(): Promise<void> {
    // 幂等确保权限码目录完整 + 超级管理员持有全部权限，防止“写授权”改造锁死管理员。
    // 云端加固：DB 暂不可达时不再中止整个引导（否则端口无人监听、外网代理“拒绝连接”），
    // 仅记录告警，端口仍正常监听；DB 相关 API 会在运行时返回明确错误，便于定位。
    try {
      await this.rbacService.ensureRbacCatalog();
    } catch (err) {
      new Logger('AppModule').error(
        `ensureRbacCatalog 失败（应用仍正常监听端口，请检查 SUDA_DATABASE_URL）：${
          err?.message ?? err
        }`,
      );
    }
    // 幂等补全运营角色（数据治理/店长/财务/采购/仓储）并授予对应权限码，
    // 使合并等资金敏感功能可灰度到运营角色（此前仅 super_admin 持有）。
    try {
      await this.rbacService.ensureOperationalRoles();
    } catch (err) {
      new Logger('AppModule').error(
        `ensureOperationalRoles 失败（应用仍正常监听端口）：${err?.message ?? err}`,
      );
    }
  }
}
