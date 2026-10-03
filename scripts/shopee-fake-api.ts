/**
 * scripts/shopee-fake-api.ts — máy chủ Shopee GIẢ cho test (KHÔNG phải suite).
 *
 * Mọi suite Shopee dùng chung file này để mock `fetch`. Khi có sandbox thật,
 * chỉ việc thay `fetchFn` bằng fetch thật + baseUrl sandbox — contract giữ nguyên.
 *
 * Contract hiện tại (mở rộng dần theo task):
 * - GET /api/v2/order/get_order_list (cursor + page_size, tối đa theo query)
 * - GET /api/v2/order/get_order_detail (order_sn_list cách nhau phẩy)
 */

export interface FakeShopeeItem {
  item_sku: string;
  model_sku?: string;
  model_quantity_purchased: number;
  model_original_price: number;
  model_discounted_price: number;
}

export interface FakeShopeeOrder {
  order_sn: string;
  order_status: string;
  payment_method: 'PREPAID' | 'COD';
  recipient: { name: string; phone: string; address: string };
  item_list: FakeShopeeItem[];
}

function absUrl(url: string): URL {
  return new URL(url, 'http://fake-shopee.local');
}

export function createFakeShopeeFetch(opts: { orders: FakeShopeeOrder[] }) {
  const calls: string[] = [];
  const bySn = new Map(opts.orders.map((o) => [o.order_sn, o]));

  const fn = (async (url: any, init: any) => {
    const u = absUrl(String(url));
    calls.push(u.pathname + u.search);
    if (u.pathname.endsWith('/api/v2/order/get_order_list')) {
      const pageSize = Math.max(1, Number(u.searchParams.get('page_size') ?? '100'));
      const start = Number(u.searchParams.get('cursor') || '0') || 0;
      const slice = opts.orders.slice(start, start + pageSize);
      const next = start + pageSize;
      return {
        ok: true,
        json: async () => ({
          error: '',
          message: '',
          response: {
            more: next < opts.orders.length,
            next_cursor: next < opts.orders.length ? String(next) : '',
            order_list: slice.map((o) => ({
              order_sn: o.order_sn,
              order_status: o.order_status,
            })),
          },
        }),
      };
    }
    if (u.pathname.endsWith('/api/v2/order/get_order_detail')) {
      const sns = String(u.searchParams.get('order_sn_list') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        ok: true,
        json: async () => ({
          error: '',
          message: '',
          response: {
            order_list: sns
              .map((sn) => bySn.get(sn))
              .filter(Boolean)
              .map((o) => ({
                order_sn: o!.order_sn,
                order_status: o!.order_status,
                payment_method: o!.payment_method,
                recipient_address: {
                  name: o!.recipient.name,
                  phone: o!.recipient.phone,
                  full_address: o!.recipient.address,
                },
                item_list: o!.item_list,
              })),
          },
        }),
      };
    }
    throw new Error(`FAKE_UNHANDLED: ${u.pathname}`);
  }) as typeof fetch;

  return { fn, calls };
}
