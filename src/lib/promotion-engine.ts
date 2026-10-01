/**
 * Engine tính quà khuyến mại — HÀM THUẦN KHIẾT, KHÔNG truy vấn DB.
 *
 * Ràng buộc cứng (đã chốt):
 *  · Mô hình BẬC THANG: đơn chỉ nhận mốc CAO NHẤT mà đạt được. Đơn 1 triệu
 *    với bậc 500k→A, 800k→A+B, 1tr→A+B+C thì tặng A+B+C MỘT LẦN, không phải
 *    2A+2B+C.
 *  · `giftQuantity` LUÔN là số cố định, không bao giờ theo tỉ lệ — nếu sinh
 *    động thì quà sinh quà, đó là vòng lặp thật.
 *  · Bật đối xứng bảo mật: thao tác TĂNG lợi ích khách thì phải qua duyệt
 *    (do UI/server quyết), thao tác GIẢM thì không cần ("Bỏ quà").
 *
 * Vì sao thuần khiết: cùng một quy tắc phải chạy ở CLIENT (để thấy ngay khi
 * quét mã) và ở SERVER (để không tin client). Hai bên gọi cùng hàm thì không
 * thể lệch. Nhưng lệch tiền là lỗi nghiêm trọng nhất nên server LUÔN tự tính
 * lại, không nhận kết quả của client.
 */

export interface PromotionGiftRule {
  /** Mốc tiền, TÍNH TRÊN GIÁ GỐC (trước chiết khấu). */
  minSubtotal: number;
  productId: string;
  /** Số cố định. Không bao giờ theo tỉ lệ. */
  giftQuantity: number;
}

export interface PromotionCampaign {
  id: string;
  name: string;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  gifts: PromotionGiftRule[];
}

export interface ComputedGift {
  campaignId: string;
  productId: string;
  quantity: number;
  /** 1 = thu ngân tự thêm, cần Quản lý duyệt. */
  isManual: boolean;
}

export interface ComputeGiftInput {
  /** TỔNG GIÁ GỐC của các dòng KHÔNG phải quà. Đừng truyền tổng cả đơn. */
  eligibleBase: number;
  campaigns: PromotionCampaign[];
  /** Sản phẩm thu ngân đã bấm "Bỏ quà" — KHÔNG tặng lại. */
  dismissed?: ReadonlySet<string>;
  /** Dòng quà tay đã được Quản lý duyệt. Bỏ qua bước tự tính. */
  approvedManual?: ReadonlySet<string>;
  /** 'now' để test được; mặc định dùng thời điểm thật. */
  now?: Date;
}

function inWindow(c: PromotionCampaign, at: Date): boolean {
  if (c.startsAt && at.getTime() < new Date(c.startsAt).getTime()) return false;
  if (c.endsAt && at.getTime() > new Date(c.endsAt).getTime()) return false;
  return true;
}

/**
 * Bậc cao nhất mà đạt được, trong MỘT chiến dịch.
 * Các dòng cùng `minSubtotal` là cùng một bậc (500k→A, 800k→A+B là 2 bậc với
 * 3 dòng).
 */
function topTierReached(campaign: PromotionCampaign, eligibleBase: number): number | null {
  const reached = campaign.gifts
    .map((g) => g.minSubtotal)
    .filter((m) => eligibleBase >= m);
  if (!reached.length) return null;
  return Math.max(...reached);
}

/**
 * Tính danh sách quà cho một đơn.
 *
 * ⚠️ ĐẦU VÀO `eligibleBase` PHẢI CHỈ gồm dòng không phải quà. Lý do đã tốn
 * nhiều giờ tìm hiểu: `pricing.ts` tính `subtotal = giáBìa × sốLượng` KHÔNG
 * trừ chiết khấu, nên dòng quà giá bìa 300k vẫn cộng 300k. Nếu đưa vào đây,
 * quà tự đẩy tổng vượt bậc kế tiếp và sinh vòng lặp.
 */
export function computeGifts(input: ComputeGiftInput): ComputedGift[] {
  const { eligibleBase, campaigns, dismissed, approvedManual, now } = input;
  const at = now ?? new Date();
  const out: ComputedGift[] = [];

  for (const c of campaigns) {
    if (!c.isActive || !inWindow(c, at)) continue;

    const tier = topTierReached(c, eligibleBase);
    if (tier === null) continue;

    for (const g of c.gifts) {
      // Chỉ lấy dòng của bậc CAO NHẮT. Đây là chỗ "2A+2B+C" bị chặn.
      if (g.minSubtotal !== tier) continue;
      if (dismissed?.has(g.productId)) continue;
      if (!Number.isInteger(g.giftQuantity) || g.giftQuantity <= 0) continue;

      const existing = out.find((x) => x.productId === g.productId);
      if (existing) {
        existing.quantity += g.giftQuantity;
      } else {
        out.push({
          campaignId: c.id,
          productId: g.productId,
          quantity: g.giftQuantity,
          isManual: false,
        });
      }
    }
  }

  // Dòng tay đã duyệt: KHÔNG nằm trong cấu hình khuyến mại, vẫn phải tặng.
  // `Array.from` thay vì `for...of` trên Set: target của repo không bật
  // downlevelIteration nên `for...of` trên Set là TS2802.
  for (const productId of Array.from(approvedManual ?? [])) {
    // "Bỏ quà" phải THẮNG cả quà tay. Thiếu dòng này thì thu ngân bấm "Bỏ
    // quà" xong quà tay vẫn hiện lại — đúng loại lỗi im lặng mà test bắt được.
    if (dismissed?.has(productId)) continue;
    const existing = out.find((x) => x.productId === productId);
    if (existing) {
      existing.isManual = true;
    } else {
      out.push({
        campaignId: 'manual',
        productId,
        quantity: 1,
        isManual: true,
      });
    }
  }

  return out;
}

/**
 * Cảnh báo khi giá trị quà lớn bất thường so với mốc.
 *
 * Rủi ro kinh tế: mốc 500k mà quà trị 500k ⇒ thu ngân mua 500k hàng rẻ để
 * mang về 1 triệu giá trị. Không chặn được bằng code, nhưng phải CẢNH BÁO để
 * sếp tự cân đối giá khi cấu hình.
 */
export function giftValueWarning(
  giftTotalValue: number,
  eligibleBase: number
): string | null {
  if (giftTotalValue <= 0 || eligibleBase <= 0) return null;
  const ratio = giftTotalValue / eligibleBase;
  if (ratio >= 0.5) {
    return `Giá trị quà bằng ${Math.round(ratio * 100)}% giá trị đơn — kiểm tra lại mức quà cho mốc này.`;
  }
  return null;
}