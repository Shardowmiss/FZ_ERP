import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { createHmac, randomBytes, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import { eq, and } from 'drizzle-orm';
import { posEmployee, posStore } from '@server/database/schema';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** 令牌有效期：一个班次通常 8~12 小时，给 12 小时并支持续期 */
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** 口令派生参数 */
const SCRYPT_KEYLEN = 64;

export interface AuthPrincipal {
  /** 员工 ID */
  employeeId: string;
  /** 员工姓名 */
  name: string;
  /** 角色：sales / manager / supervisor / admin */
  role: string;
  /** 所属门店；督导/管理员可能为空表示跨店 */
  storeId: string | null;
  /** 工号 */
  code: string;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  employee: AuthPrincipal;
}

/**
 * A-4：服务端登录鉴权。
 *
 * 说明：运行环境未提供 @nestjs/jwt，因此这里用 node:crypto 自行实现
 * HS256 令牌（header.payload.signature），语义与 JWT 一致，可直接用标准库解析。
 * 口令使用 scrypt 派生并做常数时间比较，避免明文存储与时序侧信道。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret = this.readSecret();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    ) {
    this.db = scopeDatabase(this.db);
  }

  /** 登录：校验工号 + 口令，签发令牌 */
  async login(code: string, password: string): Promise<LoginResult> {
    if (!code || !password) {
      throw new BadRequestException('工号与密码不能为空');
    }

    const rows = await this.db
      .select()
      .from(posEmployee)
      .where(eq(posEmployee.code, code))
      .limit(1);

    // 恒定耗时：无论账号是否存在都做一次派生，避免通过响应时间枚举工号
    const storedHash = rows[0]?.passwordHash ?? null;
    const ok = storedHash
      ? await this.verifyPassword(password, storedHash)
      : await this.verifyPassword(password, 'scrypt$00$00');

    if (rows.length === 0 || !storedHash || !ok) {
      throw new UnauthorizedException('工号或密码错误');
    }
    const emp = rows[0];
    if (emp.status !== 'active') {
      throw new UnauthorizedException('该账号已停用，请联系店长');
    }

    let storeId: string | null = emp.storeId;
    if (!storeId) {
      // 未绑定门店的账号（如督导）回退到首个营业门店，避免 storeId 为空的单据
      const stores = await this.db.select({ id: posStore.id }).from(posStore).limit(1);
      storeId = stores[0]?.id ?? null;
    }

    const employee: AuthPrincipal = {
      employeeId: emp.id,
      name: emp.name,
      role: emp.role,
      storeId,
      code: emp.code,
    };

    return {
      token: this.signToken(employee),
      expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
      employee,
    };
  }

  /** 校验令牌并返回身份；无效一律抛 401 */
  verifyToken(token: string): AuthPrincipal {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('登录状态无效，请重新登录');
    }
    const [h, p, s] = parts;
    const expected = this.sign(`${h}.${p}`);
    const a = Buffer.from(s, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    // 长度不等时 timingSafeEqual 会抛错，先比长度
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('登录状态无效，请重新登录');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('登录状态无效，请重新登录');
    }

    const exp = Number(payload.exp ?? 0);
    if (!exp || Date.now() / 1000 > exp) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    return {
      employeeId: String(payload.sub ?? ''),
      name: String(payload.name ?? ''),
      role: String(payload.role ?? 'sales'),
      storeId: payload.storeId ? String(payload.storeId) : null,
      code: String(payload.code ?? ''),
    };
  }

  /** 签发令牌 */
  private signToken(p: AuthPrincipal): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      'utf8',
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: p.employeeId,
        name: p.name,
        role: p.role,
        storeId: p.storeId,
        code: p.code,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
        jti: randomUUID(),
      }),
      'utf8',
    ).toString('base64url');
    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`;
  }

  private sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [algo, saltHex, hashHex] = stored.split('$');
    if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
    try {
      const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
      const expected = Buffer.from(hashHex, 'hex');
      if (derived.length !== expected.length) return false;
      return timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /** 生成口令散列，供初始化/重置密码使用 */
  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  /** 初始化/重置指定工号的密码（仅限运维入口调用） */
  async setPassword(code: string, password: string): Promise<void> {
    if (!password || password.length < 6) {
      throw new BadRequestException('密码长度至少 6 位');
    }
    const hash = await this.hashPassword(password);
    const updated = await this.db
      .update(posEmployee)
      .set({ passwordHash: hash })
      .where(eq(posEmployee.code, code))
      .returning({ id: posEmployee.id });
    if (updated.length === 0) {
      throw new BadRequestException(`工号不存在：${code}`);
    }
    this.logger.log(`已重置工号 ${code} 的登录密码`);
  }

  private readSecret(): string {
    const s = process.env.POS_AUTH_SECRET;
    if (s && s.length >= 16) return s;
    if (process.env.NODE_ENV === 'production') {
      // 生产必须显式配置，否则每次重启所有令牌失效且密钥可预测
      throw new Error('生产环境必须配置环境变量 POS_AUTH_SECRET（长度 >= 16）');
    }
    this.logger.warn(
      '未配置 POS_AUTH_SECRET，已使用开发用临时密钥；生产环境务必配置，否则令牌可被伪造',
    );
    return 'pos-dev-secret-do-not-use-in-production';
  }
}
