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
  /** Đơn vị vận chuyển khách chọn (giữ nguyên từ Shopee, không đoán). */
  carrier?: string;
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
                shipping_carrier: o!.carrier ?? 'SPX',
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
    if (u.pathname.endsWith('/api/v2/logistics/get_shipping_parameter')) {
      return {
        ok: true,
        json: async () => ({
          error: '',
          message: '',
          // Shape theo SDK schemas/logistics.ts GetShippingParameterResponseData.
          response: {
            info_needed: { pickup: ['address_id', 'pickup_time_id'], dropoff: [] },
            pickup: {
              address_list: [
                {
                  address_id: 998877,
                  city: 'Hà Nội',
                  district: 'Cầu Giấy',
                  address: 'Kho Âu Cơ',
                  address_flag: ['pickup_address', 'default_address'],
                  time_slot_list: [{ pickup_time_id: 'SLOT-14-17', time_text: '14:00-17:00' }],
                },
              ],
            },
          },
        }),
      };
    }
    if (u.pathname.endsWith('/api/v2/logistics/ship_order')) {
      return {
        ok: true,
        json: async () => ({
          error: '',
          message: '',
          response: { package_number: 'PKG-FAKE-001' },
        }),
      };
    }
    if (u.pathname.endsWith('/api/v2/logistics/get_tracking_number')) {
      return {
        ok: true,
        json: async () => ({
          error: '',
          message: '',
          response: { tracking_number: 'SPXVN0123456789' },
        }),
      };
    }
    if (u.pathname.endsWith('/api/v2/logistics/create_shipping_document')) {
      return {
        ok: true,
        json: async () => ({ error: '', message: '', response: { result: 'OK' } }),
      };
    }
    if (u.pathname.endsWith('/api/v2/logistics/download_shipping_document')) {
      const tracking = 'SPXVN0123456789';
      return {
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/pdf' : '') },
        arrayBuffer: async () =>
          new TextEncoder().encode(`AWB-A6 ${tracking}`).buffer as ArrayBuffer,
      };
    }
    if (u.pathname.endsWith('/api/v2/product/update_stock')) {
      return {
        ok: true,
        json: async () => ({
          error: '',
          message: '',
          // Shape theo SDK: success_list / failure_list.
          response: { success_list: [{ model_id: 0 }], failure_list: [] },
        }),
      };
    }
    if (u.pathname.endsWith('/api/v2/payment/get_escrow_detail')) {
      return {
        ok: true,
        json: async () => ({
          error: '',
          message: '',
          // Tên trường theo SDK GetEscrowDetailOrderIncome.
          response: {
            order_income: {
              buyer_total_amount: 192000,
              escrow_amount: 179360,
              commission_fee: 15360,
              seller_transaction_fee: 7680,
              service_fee: 9600,
              seller_discount: 0,
              voucher_from_seller: 0,
              shopee_discount: 20000,
              voucher_from_shopee: 0,
            },
          },
        }),
      };
    }
    throw new Error(`FAKE_UNHANDLED: ${u.pathname}`);
  }) as unknown as typeof fetch;

  return { fn, calls };
}
