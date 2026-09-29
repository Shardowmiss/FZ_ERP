import { Injectable } from '@nestjs/common';
import { round2, round3, round4 } from '../utils/money';

/**
 * 金额精度工具的服务化封装。
 *
 * 原先各 service 直接 `import { round2 } from '.../utils/money'`（函数式导入，散落 ~26 处）。
 * 封装为 @Global 可注入服务后：
 *  - 便于单元测试（可 mock）
 *  - 后续如需切换精度策略只需改一处
 *  - 与 CommonModule 的“共享内核”定位一致，功能模块不再依赖深层相对路径
 *
 * 注意：本项目 Drizzle 多数金额列定义为 string（varchar），故 round 系列仍返回 string 以兼容 insert/.set。
 */
@Injectable()
export class MoneyService {
  round2(v: number | string): string {
    return round2(Number(v));
  }

  round3(v: number | string): string {
    return round3(Number(v));
  }

  round4(v: number | string): string {
    return round4(Number(v));
  }

  num(v: unknown): number {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
}
