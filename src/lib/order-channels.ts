/**
 * Kênh bán hàng của đơn (orders.channel).
 * ONLINE = đơn portal datsach; SHOPEE = đơn sàn Shopee.
 * Hai kênh này chịu quy định D1: hóa đơn chỉ phát hành khi khách đã nhận hàng.
 * Các kênh còn lại (RETAIL_OFFICE, FAIR_EVENT...) là bán trực tiếp tại chỗ,
 * khách cầm hàng ngay nên không cần mốc xác nhận nhận hàng.
 */
export const ONLINE_CHANNELS = ['ONLINE', 'SHOPEE'] as const;

export function isOnlineChannel(channel: string | null | undefined): boolean {
  return channel === 'ONLINE' || channel === 'SHOPEE';
}
