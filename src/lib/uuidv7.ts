/**
 * UUID v7 GENERATOR (RFC 9562)
 * Mã định danh độc bản toàn cầu với 48-bit đầu là Unix timestamp mili-giây,
 * giúp các đơn hàng bán ngoại tuyến tự động sắp xếp theo đúng trình tự thời gian
 * khi được gửi từ nhiều thiết bị nhân viên khác nhau về máy chủ.
 */

let lastTimestamp = -1;
let sequence = 0;

export function generateUUIDv7(): string {
  let now = Date.now();

  // Đảm bảo tính tăng đơn điệu (Monotonic ordering) nếu được gọi trong cùng 1 mili-giây
  if (now <= lastTimestamp) {
    sequence = (sequence + 1) & 0xfff;
    if (sequence === 0) {
      // Nếu sequence tràn trong cùng 1 ms, đợi 1 ms tiếp theo
      now = lastTimestamp + 1;
    }
  } else {
    sequence = Math.floor(Math.random() * 0x100);
  }
  lastTimestamp = now;

  // 1. Timestamp 48 bits (12 hex characters)
  const timeHex = now.toString(16).padStart(12, '0');

  // 2. Version 7 + Sequence 12 bits (4 hex characters)
  const verSeq = ((0x7 << 12) | (sequence & 0xfff)).toString(16).padStart(4, '0');

  // 3. Variant (0b10xxxxxx) + Random bits
  const randA = Math.floor(Math.random() * 0x3fff) | 0x8000;
  const varHex = randA.toString(16).padStart(4, '0');

  // 4. Random 48 bits (12 hex characters)
  const randB = Math.floor(Math.random() * 0xffffffffffff)
    .toString(16)
    .padStart(12, '0');

  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-${verSeq}-${varHex}-${randB}`;
}

/**
 * Trích xuất Unix timestamp mili-giây từ UUID v7
 */
export function extractTimestampFromUUIDv7(uuid: string): number {
  const clean = uuid.replace(/-/g, '');
  const timeHex = clean.slice(0, 12);
  return parseInt(timeHex, 16);
}
