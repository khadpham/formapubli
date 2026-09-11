/**
 * Chuẩn hóa chuỗi tiếng Việt:
 * 1. Chuyển về chữ thường (lowercase)
 * 2. Khử toàn bộ dấu thanh (sắc, huyền, hỏi, ngã, nặng) và dấu mũ (ă, â, đ, ê, ô, ơ, ư)
 * 3. Chuẩn hóa khoảng trắng
 */
export function removeAccents(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim();
}

/**
 * Sinh chuỗi ký tự viết tắt (Acronym / Shortcode) từ tên sách:
 * Ví dụ: "Trưởng giả học làm sang" -> "tghls"
 * "Bệnh tưởng" -> "bt"
 * "Dưỡng đường đồng hồ cát" -> "dddhc"
 */
export function generateAcronym(title: string): string {
  if (!title) return '';
  const clean = removeAccents(title)
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  const words = clean.split(/\s+/);
  return words.map((w) => w[0]).join('');
}

/**
 * Kiểm tra xem chuỗi target có khớp với query tìm kiếm hay không:
 * - Hỗ trợ gõ tiếng Việt có dấu hoặc KHÔNG DẤU (ví dụ: gõ "truong" khớp với "Trưởng giả học làm sang")
 * - Bỏ qua hoa thường
 * - Khớp một phần (partial substring match)
 */
export function matchesVietnameseSearch(target: string | null | undefined, query: string): boolean {
  if (!target || !query) return false;

  const normalizedTarget = removeAccents(target);
  const normalizedQuery = removeAccents(query);

  return normalizedTarget.includes(normalizedQuery);
}