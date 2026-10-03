/**
 * Tra cứu mã quét (ISBN-13 / SKU / 4 số cuối) — module DÙNG CHUNG.
 *
 * Trước đây matcher này nằm chép trong `PosCheckoutTerminal.handleBarcodeScan`
 * và một bản chép thứ hai trong `scripts/test-barcode-engine.ts`. Hai bản chép
 * lệch nhau (bản test còn dùng `endsWith` vô điều kiện — đúng lỗi đã sửa ở
 * production) nên test có thể xanh trên code sai. Đây là lỗi `AGENTS.md` cấm.
 * Giờ MỘT bản, cả POS lẫn test đều gọi hàm này.
 *
 * QUY TẮC PHÂN GIẢI — vì sao không có mặc định tĩnh:
 *   · >1 ấn bản cùng mã mà cả hai đều còn tồn ⇒ HỎI. Hệ thống không thể biết
 *     thu ngân đang cầm cuốn nào. Ở production, `HH032` và `HH042` cùng giá
 *     99.000đ ⇒ chọn nhầm KHÔNG lệch tiền, chỉ lệch tồn/ấn bản ⇒ càng khó phát
 *     hiện.
 *   · >1 ấn bản cùng mã mà CHỈ CÙNG CÌN 1 bản ⇒ tự chọn bản đó. Rủi ro = 0
 *     (bản kia hết hàng, không bán được), vẫn bỏ được 1 chạm thừa trong ca dày.
 *   · >1 ấn bản cùng mã, nhiều bản còn tồn, mà thu ngân ĐÃ CHỌN bản đó trong ca
 *     này (`rememberedEditionId`, đọc từ sessionStorage) và bản đó VẪN còn tồn ⇒
 *     tự chọn luôn. Chỉ nhớ trong ca, đóng tab là quên — không nhớ vĩnh viễn vì
 *     bản thắng áp đảo có thể đổi theo mùa.
 *
 * `stockOf` phải LÀ ĐÚNG hàm mà màn POS hiển thị tồn (xem `getBookStock`), nếu
 * không thì thu ngân nhìn thấy "còn hàng" mà hệ thống lại báo hết — hoặc ngược lại.
 */
export interface ScannableBook {
  id: string;
  code: string;
  /** NULL ở DB (`editions.title` nullable) — matcher không dùng, nhưng phải khai
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
  | { kind: 'ambiguous'; all: B[]; buyable: B[] };

export function resolveScan<B extends ScannableBook>(
  scannedCode: string,
  books: readonly B[],
  stockOf: (book: B) => number,
  rememberedEditionId?: string | null
): ScanResolution<B> {
  const cleanScanned = scannedCode.replace(/[^0-9X]/gi, '');

  // Mã quét rỗng là KHÔNG KHỚP AI, không phải "khớp mọi thứ". Biểu thức
  // `cleanIsbn === cleanScanned` bên dưới sẽ khớp MỌI hàng hóa, vì hàng hóa
  // (`products` LEFT JOIN `editions`) có `isbn = ''` — quét một mã rác không lọt
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

  const buyable = matched.filter((b) => stockOf(b) > 0);
  // Không còn nghi ngờ: đúng 1 bản còn tồn. Xét TRƯỚC lựa chọn nhớ, vì tồn kho
  // là sự thật còn mãi còn vĩnh, còn "đã chọn trong ca" chỉ là phỏng đoán.
  if (buyable.length === 1) return { kind: 'single', book: buyable[0] };
  const remembered = rememberedEditionId
    ? buyable.find((b) => b.id === rememberedEditionId)
    : undefined;
  if (remembered) return { kind: 'single', book: remembered };
  return { kind: 'ambiguous', all: matched, buyable };
}