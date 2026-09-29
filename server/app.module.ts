import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AuthModule } from './modules/auth/auth.module';
import { Reflector } from '@nestjs/core';
import { ViewModule } from './modules/view/view.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { StockModule } from './modules/stock/stock.module';
import { SalesModule } from './modules/sales/sales.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { MembersModule } from './modules/members/members.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ErpIntegrationModule } from './modules/erp-integration/erp-integration.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ShiftModule } from './modules/shift/shift.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { OmnichannelModule } from './modules/omnichannel/omnichannel.module';
import { SettingsModule } from './modules/settings/settings.module';
import { OfflineSyncModule } from './modules/offline-sync/offline-sync.module';

@Module({
  imports: [
    PlatformModule.forRoot(),
    // P0-5：限流守卫依赖的存储与默认阈值（仅登录端点显式挂 ThrottlerGuard，避免误伤高频扫描类接口）
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),
    AuthModule,
    MasterDataModule,
    StockModule,
    SalesModule,
    ReturnsModule,
    MembersModule,
    PromotionsModule,
    ErpIntegrationModule,
    InventoryModule,
    ShiftModule,
    DashboardModule,
    OmnichannelModule,
    SettingsModule,
    OfflineSyncModule,
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    Reflector,
    // P1-b：全局限流守卫。默认 100 次/分钟/IP，防接口滥用与爆破；
    // 登录端点通过 @Throttle 覆盖为 5 次/分钟（见 auth.controller）；
    // 离线同步轮询端点通过 @SkipThrottle() 豁免（见 offline-sync.controller）。
    // 注意：本平台已自带 SSO 鉴权（@NeedLogin() + AuthNPaasGuard），
    // 这里的 AuthGuard 仅用于「POS 本地收银员登录」，未注册为全局守卫，
    // 以免与平台登录态冲突导致全站 401。ThrottlerGuard 是限流守卫而非鉴权守卫，可安全全局启用。
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
