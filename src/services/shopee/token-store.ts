import { eq } from 'drizzle-orm';
import { db, shopeeShopTokens } from '@/db';

export interface ShopeeAccessToken {
  access_token: string;
  refresh_token: string;
  /** Timestamp mili-giây lúc access_token hết hạn. */
  expired_at: number;
  shop_id: number;
}

/**
 * Lưu token Shopee vào Turso - KHÔNG giữ trong RAM/file.
 * Workers có thể bị hủy giữa các request nên RAM không phải nơi cất token.
 */
export class TursoTokenStorage {
  constructor(private readonly shopId: number) {}

  async store(token: ShopeeAccessToken): Promise<void> {
    await db
      .insert(shopeeShopTokens)
      .values({
        shopId: this.shopId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiredAt: token.expired_at,
        refreshExpiredAt: Date.now() + 30 * 24 * 3600 * 1000,
      })
      .onConflictDoUpdate({
        target: shopeeShopTokens.shopId,
        set: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiredAt: token.expired_at,
          refreshExpiredAt: Date.now() + 30 * 24 * 3600 * 1000,
        },
      });
  }

  async get(): Promise<ShopeeAccessToken | null> {
    const rows = await db
      .select()
      .from(shopeeShopTokens)
      .where(eq(shopeeShopTokens.shopId, this.shopId))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      access_token: row.accessToken,
      refresh_token: row.refreshToken,
      expired_at: row.expiredAt,
      shop_id: row.shopId,
    };
  }
}
