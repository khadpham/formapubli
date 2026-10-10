/**
 * Tra cứu mã quét (ISBN-13 / SKU / 4 số cuối) - module DÙNG CHUNG.
 *
 * Trước đây matcher này nằm chép trong `PosCheckoutTerminal.handleBarcodeScan`
 * và một bản chép thứ hai trong `scripts/test-barcode-engine.ts`. Hai bản chép
 * lệch nhau (bản test còn dùng `endsWith` vô điều kiện - đúng lỗi đã sửa ở
 * production) nên test có thể xanh trên code sai. Đây là lỗi `AGENTS.md` cấm.
 * Giờ MỘT bản, cả POS lẫn test đều gọi hàm này.
 *
 * QUY TẮC PHÂN GIẢI - TRÊN 1 ỨNG VIÊN THÌ LUÔN HỎI (chủ chốt 03/10/2026):
 *   · >1 ấn bản cùng mã ⇒ HỎI, KHÔNG BAO GIỜ tự chọn, kể cả khi chỉ còn đúng 1
 *     bản còn tồn. Hệ thống không biết thu ngân đang cầm cuốn nào; tồn kho chỉ
 *     là dữ liệu server và ở kho hội chợ có thể sai (xem `getBookStock`), nên
 *     dùng nó để suy ra "bản đó chắc là không bán được" vẫn là một phỏng đoán.
 *     Ở production, `HH032` và `HH042` cùng giá 99.000đ ⇒ chọn nhầm KHÔNG lệch
 *     tiền, chỉ lệch tồn/ấn bản ⇒ càng khó phát hiện. Modal đã khoá dòng 0 tồn
 *     nên thu ngân thấy ngay bản nào bán được; bỏ 1 chạm trong ca dày là cái
 *     giá không đáng trả.
 *   · Không có `rememberedEditionId`: thu ngân muốn giảm thao tác thì tự bấm
 *     nút nhớ trong modal, không để hệ thống tự chọn ngầm.
 */
export interface ScannableBook {
  id: string;
  code: string;
  /** NULL ở DB (`editions.title` nullable) - matcher không dùng, nhưng phải khai
   *  bám đúng schema thay vì ép kiểu. */
  title: string | null;
  isbn: string | null;
  isbnLast4: string | null;
  coverPrice?: number | null;
  publicationYear?: number | null;
}

export type ScanResolution<B extends ScannableBook> =
  | { kind: 'none' }
  | { kind: 'single'; book: B }
  | { kind: 'ambiguous'; all: B[] };

export function resolveScan<B extends ScannableBook>(
  scannedCode: string,
  books: readonly B[]
): ScanResolution<B> {
  const cleanScanned = scannedCode.replace(/[^0-9X]/gi, '');

  // Mã quét rỗng là KHÔNG KHỚP AI, không phải "khớp mọi thứ". Biểu thức
  // `cleanIsbn === cleanScanned` bên dưới sẽ khớp MỌI hàng hóa, vì hàng hóa
  // (`products` LEFT JOIN `editions`) có `isbn = ''` - quét một mã rác không lọt
  // qua bộ lọc của scanner (vd chuỗi `-` của Code39) là thêm nhầm món hàng.
  if (!cleanScanned) return { kind: 'none' };

  const matched = books.filter((b) => {
    const cleanIsbn = b.isbn ? b.isbn.replace(/[^0-9X]/gi, '') : '';
    // Khớp 4 số cuối CHỈ hợp lệ khi mã quét ĐÚNG 4 ký tự. Trước đây điều kiện
    // này nằm trong `||` vô điều kiện (`endsWith`), nên quét ISBN-13 của một cuốn
    // KHÔNG có trong danh mục, tình cờ trùng 4 số cuối với đúng một cuốn trong danh
    // mục ⇒ thẻ ấn bản SAI vào giỏ, trừ sai tồn kho và tính tiền theo GIÁ của
    // cuốn khác. Mã đầy đủ mà không khớp thì phải là không khớp.
    const last4Only = cleanScanned.length === 4 && b.isbnLast4 && cleanScanned === b.isbnLast4;
    return (
      cleanIsbn === cleanScanned ||
      b.code.toLowerCase() === scannedCode.toLowerCase() ||
      last4Only
    );
  });

  if (matched.length === 0) return { kind: 'none' };
  if (matched.length === 1) return { kind: 'single', book: matched[0] };
  return { kind: 'ambiguous', all: matched };
}