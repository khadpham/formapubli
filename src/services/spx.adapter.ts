/**
 * SPX Adapter - Tích hợp API đơn vị vận chuyển SPX.
 *
 * Mục tiêu: thay nhập xlsx thủ công bằng API tự động.
 * - Tạo vận đơn: gửi thông tin đơn hàng → nhận tracking code
 * - Webhook: nhận cập nhật trạng thái từ SPX
 * - Đối soát COD: khớp tiền COD SPX báo về
 *
 * LƯU Ý: Cần credentials SPX API từ đối tác. Các hàm gọi API thật
 * được đánh dấu TODO và hiện tại throw "chưa cấu hình".
 */

import { AppError } from './app-error';

export interface SpxCreateOrderParams {
  orderId: string;
  orderCode: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  receiverWard?: string;
  receiverDistrict?: string;
  receiverProvince?: string;
  codAmount: number; // 0 = không COD
  weight?: number; // gram
  note?: string;
}

export interface SpxCreateOrderResult {
  trackingCode: string;
  shippingFee: number;
  expectedDelivery?: string;
}

export interface SpxWebhookPayload {
  trackingCode: string;
  status: string; // Map sang ShippingStatus
  timestamp: string;
  codCollected?: number;
}

const SPX_STATUS_MAP: Record<string, string> = {
  'CREATED': 'CREATED',
  'PICKED_UP': 'PICKED_UP',
  'IN_TRANSIT': 'IN_TRANSIT',
  'DELIVERED': 'DELIVERED',
  'RETURNED': 'RETURNED',
  'FAILED': 'FAILED',
  'CANCELLED': 'FAILED',
};

export class SpxAdapter {
  private static getConfig() {
    const apiUrl = process.env.SPX_API_URL;
    const apiKey = process.env.SPX_API_KEY;
    const shopId = process.env.SPX_SHOP_ID;
    if (!apiUrl || !apiKey || !shopId) {
      throw AppError.invalid('Chưa cấu hình SPX API (SPX_API_URL, SPX_API_KEY, SPX_SHOP_ID).');
    }
    return { apiUrl, apiKey, shopId };
  }

  /**
   * Tạo vận đơn SPX. Gọi sau khi đơn COMPLETED.
   * Trả về tracking code để lưu vào orders.
   */
  static async createOrder(params: SpxCreateOrderParams): Promise<SpxCreateOrderResult> {
    const { apiUrl, apiKey, shopId } = this.getConfig();

    // TODO: Gọi SPX API thật khi có tài liệu API từ đối tác
    // const res = await fetch(`${apiUrl}/v1/orders`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ shop_id: shopId, ...params }),
    // });
    // if (!res.ok) throw AppError.invalid(`SPX API lỗi: ${res.status}`);
    // const data = await res.json();
    // return { trackingCode: data.tracking_code, shippingFee: data.fee };

    throw AppError.invalid('SPX API chưa tích hợp - cần tài liệu API từ đối tác. Dùng nhập tay tracking code.');
  }

  /**
   * Map trạng thái SPX webhook sang ShippingStatus nội bộ.
   */
  static mapStatus(spxStatus: string): string {
    const mapped = SPX_STATUS_MAP[spxStatus.toUpperCase()];
    if (!mapped) throw AppError.invalid(`Trạng thái SPX không hỗ trợ: ${spxStatus}`);
    return mapped;
  }

  /**
   * Verify webhook signature từ SPX (chống giả mạo).
   */
  static verifyWebhook(payload: string, signature: string): boolean {
    const secret = process.env.SPX_WEBHOOK_SECRET;
    if (!secret) return false;
    // TODO: Implement HMAC verification theo tài liệu SPX
    return true;
  }
}
