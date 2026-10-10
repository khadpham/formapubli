/**
 * Kiểm tra số kiểm ISBN-13 - dùng chung cho seed, health check và (nếu sau này
 * có UI nhập tay) màn thêm sách.
 *
 * ISBN-13 = 13 chữ số `0-9`, trọng số xen kẽ 1,3,1,3,… cho 12 số đầu rồi số
 * kiểm ở vị trí 13 sao cho tổng chia hết 10.
 *
 * ⚠ CẢNH BÁO (đã mắc ngày 03/10/2026): checksum CHỈ bắt được lỗi ở SỐ CUỐI.
 * Suy ngược số kiểm từ 12 số đầu rồi ghi vào DB là TỰ BỊA - ví dụ
 * `9786044449685` hợp lệ checksum nhưng là ISBN của cuốn khác. Muốn sửa ISBN
 * thì tra nguồn thật (CSV `data_tabs/sheet1_danhmuc_gid_0.csv`, bìa sách),
 * không suy ra.
 */

/** Bỏ mọi ký tự không phải `0-9` / `X` (gạch nối, khoảng trắng, chữ cái). `x` → `X`. */
export function normalizeIsbn(raw: string): string {
  return (raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * Số kiểm của ISBN-13 từ 12 số đầu. Trả về 0–9 (KHÔNG BAO GIỜ trả 10).
 * Ném lỗi nếu `first12` không phải đúng 12 chữ số - gọi sai là lỗi code,
 * không phải dữ liệu bẩn, nên phải nổi lên chứ không trả về giá trị bịa.
 */
export function isbn13CheckDigit(first12: string): number {
  const s = normalizeIsbn(first12);
  if (s.length !== 12 || /[^0-9]/.test(s)) {
    throw new Error(`isbn13CheckDigit cần đúng 12 chữ số, nhận '${first12}'`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * Đúng 13 chữ số `0-9` VÀ số kiểm khớp.
 *
 * KHÔNG kiểm tra tiền tố 978/979: NXB nội địa / ISBN cũ 10 số quy đổi lên đều
 * có thể hợp lệ mà không theo mẫu, và `editions.isbn` cố ý không UNIQUE. Chặn ở
 * đây chỉ để dữ liệu rác (sai số, sai độ dài) không đi vào - không phải để
 * phân xử mã hợp lệ.
 */
export function isValidIsbn13(raw: string): boolean {
  const s = normalizeIsbn(raw);
  if (s.length !== 13 || /[^0-9]/.test(s)) return false;
  return Number(s[12]) === isbn13CheckDigit(s.slice(0, 12));
}

/**
 * Mã CỐ Ý không theo chuẩn - biết trước, đã được chủ doanh nghiệp chấp nhận.
 * KHUYẾN NGHỊ KHÔNG TỰ Ý THÊM VÀO ĐÂY: một dòng mới phải được sửa từ nguồn thật
 * (đọc mã vạch trên bìa sách / tra CSV của NXB), không phải từ checksum.
 */
export const ISBN_EXEMPTIONS: Record<string, string> = {
  '97863203176313':
    'ed-h85 "Đốt kho" - CSV NXB ghi 14 số. Chủ bảo bỏ qua 03/10/2026, KHÔNG tự bịa số.',
};

/**
 * `null` = được phép lọt (đạt chuẩn, hoặc nằm trong `ISBN_EXEMPTIONS` với lý do
 * đã ghi). Trả về chuỗi lý do khi bị chặn - dùng chung cho cả seed (bỏ dòng +
 * in cảnh báo) lẫn health check (báo đỏ) để hai nơi không lệch nhau.
 */
export function isbnBlockReason(raw: string): string | null {
  if (isValidIsbn13(raw)) return null;
  if (ISBN_EXEMPTIONS[normalizeIsbn(raw)]) return null;
  return `ISBN '${raw}' không hợp lệ - phải đúng 13 chữ số và số kiểm phải khớp`;
}

/**
 * Cặp ấn bản CỐ Ý dùng chung một ISBN - biết trước, đã được xác minh là tái bản
 * của cùng một tác phẩm, không phải nhập nhầm. Dùng cho health check: cặp đã
 * biết thì bỏ qua, cặp MỚI xuất hiện thì báo đỏ (nghĩa là có người vừa nhập
 * trùng mà không biết - cần hỏi, không tự ý "chấp nhận").
 */
export const ISBN_DUPLICATE_EXEMPTIONS: Record<string, string> = {
  '9786044737690':
    'HH032 "Le Spleen de Paris (Bìa tím)" 2022 13,5cm + HH042 "(Tái bản) - Bìa trắng" 2023 12,5cm - cùng tác phẩm, NXB tái bản chung mã.',
};

/** `null` = cặp trùng đã được miễn. Trả lý do khi cặp trùng mới (chưa từng biết). */
export function isbnDuplicateReason(isbn: string): string | null {
  return ISBN_DUPLICATE_EXEMPTIONS[normalizeIsbn(isbn)] ?? null;
}
