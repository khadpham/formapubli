/**
 * Batch transfer "paste a two column Excel list" UI contract.
 *
 * The manager copies `title<TAB>quantity` out of a spreadsheet and pastes it
 * instead of searching book by book. THE HARD RULE from the user: a line may
 * only enter the transfer list when the title is found EXACTLY in the catalog,
 * never guessed. So the not_found group must have NO add affordance at all,
 * and the paste flow must never reach a submit/transfer endpoint — the manager
 * still presses the existing "Kiem tra ton kho" then "Xac nhan chuyen kho".
 *
 * Source-level assertions only (same style as scripts/test-mobile-kho-ui.ts):
 * no DOM, no browser, no database.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const modalPath = path.resolve(
  process.cwd(),
  'src/components/inventory/BatchTransferModal.tsx'
);
const src = fs.readFileSync(modalPath, 'utf8');

const checks: string[] = [];
const expect = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks.push(`  ok  ${msg}`);
};

/**
 * Source text of a top-level `const <anchor> ... = ... { ... }` function body.
 * A naive "first `{` after the anchor" is WRONG here: several of these have a
 * generic/typed parameter list (`(row: Extract<ParsedRow, { status: ... }>)`)
 * whose braces would be mistaken for the body. So take everything from the
 * anchor to the next top-level statement instead.
 */
const bodyOf = (anchor: string): string => {
  const at = src.indexOf(anchor);
  if (at === -1) return '';
  const rest = src.slice(at + anchor.length);
  const next = rest.search(/\n {2}(?:const|let|useEffect|if \(|return)\b/);
  return next === -1 ? rest : rest.slice(0, next);
};
const blockOf = (anchor: string): string => bodyOf(anchor);

// ---------------------------------------------------------------------------
// 1. The compact trigger button, next to the existing bulk quantity control.
// ---------------------------------------------------------------------------
const applyInputAt = src.indexOf('placeholder="SL mới..."');
const danAt = src.search(/Dán<\/span>|>Dán</);
expect(danAt !== -1, 'Có nút/nhãn "Dán" trong BatchTransferModal');
expect(applyInputAt !== -1, 'Bộ điều khiển SL hàng loạt (ô "SL mới...") còn nguyên');
expect(
  applyInputAt !== -1 && danAt !== -1 && Math.abs(danAt - applyInputAt) < 2500,
  'Nút "Dán" nằm ngay cạnh bộ điều khiển SL hàng loạt'
);
expect(blockOf('const handleApplyBulkQuantity').length > 0, 'handleApplyBulkQuantity còn nguyên');
expect(
  /onClick=\{\(\) => setIsPasteOpen\(true\)\}/.test(src),
  'Nút "Dán" chỉ mở hộp thoại dán (không tự gọi validate/submit)'
);

// ---------------------------------------------------------------------------
// 2. Dialog accessibility: reuse useModalFocusTrap exactly like PaymentProofCamera.
// ---------------------------------------------------------------------------
expect(
  /import \{ useModalFocusTrap \} from '@\/hooks\/useModalFocusTrap'/.test(src),
  'Dialog dán dùng lại hook sẵn có @/hooks/useModalFocusTrap'
);
expect(
  /useModalFocusTrap<HTMLDivElement>\(isPasteOpen && mounted/.test(src),
  'Gọi useModalFocusTrap(isPasteOpen && mounted) — đóng focus trap khi dialog đóng'
);
expect(
  /ref=\{pasteModalRef\}[\s\S]{0,200}?role="dialog"/.test(src),
  'Hộp thoại dán có ref focus trap + role="dialog"'
);
expect(/aria-modal="true"/.test(src), 'Hộp thoại dán có aria-modal="true"');
expect(
  /role="dialog"[\s\S]{0,200}?aria-label="[^"]*"/.test(src),
  'Hộp thoại dán có aria-label'
);
expect(/<PortalToBody/.test(src), 'Hộp thoại dán render qua PortalToBody (không bị overflow cắt)');

// ---------------------------------------------------------------------------
// 3. The parser is imported and called against the books prop.
// ---------------------------------------------------------------------------
expect(
  /import \{ parsePastedBookList, type ParsedRow \} from '@\/lib\/batch-paste-parser'/.test(src),
  'Import đúng contract: parsePastedBookList + type ParsedRow từ @/lib/batch-paste-parser'
);
expect(
  /parsePastedBookList\(\s*pasteText\s*,/.test(src),
  'Gọi parsePastedBookList(pasteText, ...) — parse nguyên văn bản đã dán'
);
expect(
  /books\.map\(\(b\)\s*=>\s*\(\{\s*id: b\.id,\s*title: b\.title,\s*code: b\.code,\s*isbnLast4: b\.isbnLast4\s*\}\)\)/.test(
    src
  ),
  'Map books (BookItem) sang ParseLookupBook { id, title, code, isbnLast4 } cho parser'
);
expect(
  /defaultQuantity: DEFAULT_PASTE_QUANTITY/.test(src),
  'Truyền defaultQuantity cho parser'
);
expect(/const DEFAULT_PASTE_QUANTITY = 5/.test(src), 'Hằng số mặc định số lượng là 5');

// ---------------------------------------------------------------------------
// 4. Three result groups are rendered.
// ---------------------------------------------------------------------------
expect(/Khớp tuyệt đối/.test(src), 'Nhóm "Khop tuyet doi" (matched) được render');
expect(/Cần xác nhận/.test(src), 'Nhóm "Can xac nhan" (needs_confirm) được render');
expect(/Không tìm thấy/.test(src), 'Nhóm "Khong tim thay" (not_found) được render');
for (const status of ['matched', 'needs_confirm', 'not_found']) {
  expect(
    new RegExp(`status === '${status}'`).test(src),
    `Lọc nhóm theo status === '${status}'`
  );
}
expect(
  /summary\.matched\} dòng vào bảng[\s\S]*?summary\.needsConfirm\} cần[\s\S]*?xác nhận[\s\S]*?summary\.notFound\} không tìm thấy/.test(
    src
  ),
  'Dòng tổng kết dạng "N dòng vào bảng · M cần xác nhận · K không tìm thấy" từ parser summary'
);
// ---------------------------------------------------------------------------
// 5. needs_confirm: each candidate is a tappable button that adds the line.
// ---------------------------------------------------------------------------
const candBlock = blockOf('const handleAddPastedCandidate');
expect(
  candBlock.length > 0 && /addPastedRows/.test(candBlock),
  'handleAddPastedCandidate ghi vào bảng chuyển (qua cùng hàm thêm dòng)'
);
expect(/candidates\.map\(\(c\)/.test(src), 'Ứng viên trong nhóm "Cần xác nhận" được render bằng .map()');
expect(
  /onClick=\{\(\) => handleAddPastedCandidate\(/.test(src),
  'Mỗi ứng viên là một nút bấm được (onClick thêm dòng với số lượng hiển thị)'
);

// Người dùng báo: ứng viên trông như mảnh chữ trắng, không ai biết bấm được.
// Bắt buộc phải có: dấu hiệu bấm (icon + viền đậm), nhãn aria nói rõ thao tác,
// và trạng thái "Đã thêm" sau khi bấm để không bấm nhầm 2 lần (cộng dồn SL).
expect(
  /aria-label=\{`Thêm đầu sách \$\{c\.title\}`\}/.test(src),
  'Ứng viên có aria-label "Thêm đầu sách <tên>" để người dùng biết đây là nút thêm'
);
expect(
  /border-2 border-amber-400/.test(src),
  'Ứng viên có viền đậm hơn để nhìn ra là nút bấm được'
);
expect(
  /Đã thêm: \{chosen\}/.test(src) && /pastedConfirmed\[r\.line\]/.test(src),
  'Dòng đã chọn phải hiện trạng thái "Đã thêm" thay vì còn bấm lại được'
);

// Tiếng Việt trong UI phải CÓ DẤU. Người dùng đã phàn về nhãn không dấu.
const UNACCENTED_LABELS = [
  '>Dan<',
  '>Kiem tra<',
  'Khop tuyet doi',
  'Can xac nhan',
  'Khong tim thay',
  'Vao bang',
  'dan sach',
  'so luong',
  'ten sach',
];
for (const bad of UNACCENTED_LABELS) {
  expect(!src.includes(bad), `Nhãn không dấu "${bad}" không được xuất hiện — UI phải tiếng Việt có dấu`);
}
expect(
  /Dán danh sách từ Excel/.test(src) && /Cần xác nhận/.test(src) && /Không tìm thấy/.test(src),
  'Tiêu đề và tên nhóm phải là tiếng Việt có dấu'
);

// ---------------------------------------------------------------------------
// 6. not_found: NO add action. Paste must never guess a book.
// ---------------------------------------------------------------------------
// The not_found section is the LAST group in the dialog, so everything from its
// first `status === 'not_found'` to EOF must contain no add button at all.
const notFoundStart = src.indexOf("status === 'not_found'");
expect(notFoundStart !== -1, 'Tồn tại nhóm not_found');
const notFoundBlock = src.slice(notFoundStart);
expect(
  /Không tìm thấy/.test(notFoundBlock) && /{r\.line} — {r\.quantity}/.test(notFoundBlock),
  'Nhóm "Khong tim thay" liệt kê nguyên văn dòng đã dán kèm số lượng'
);
expect(
  !/<button/.test(notFoundBlock),
  'Nhóm "Khong tim thay" KHÔNG có nút thêm nào — người dùng không thể thêm sách hệ thống không tìm thấy'
);

// ---------------------------------------------------------------------------
// 7. The paste flow can never submit or transfer anything.
// ---------------------------------------------------------------------------
const pasteFns = [
  'const handleCheckPasted',
  'const addPastedRows',
  'const handleAddPastedCandidate',
].map((a) => blockOf(a)).join('\n');
expect(pasteFns.length > 0, 'Tồn tại các hàm xử lý luồng dán');
expect(!/fetch\(/.test(pasteFns), 'Luồng dán KHÔNG gọi fetch() ở bất kỳ đâu');
expect(!/handleSubmitBatch|handleValidateBatch/.test(pasteFns), 'Luồng dán KHÔNG gọi validate/submit');
expect(!/transfer-batch/.test(pasteFns), 'Luồng dán KHÔNG chạm endpoint transfer-batch');

// ---------------------------------------------------------------------------
// 8. Line shape identical to search: same helper, dedupe + sum, staleWarning.
// ---------------------------------------------------------------------------
expect(
  /const addBookLine = \(book: BookItem, quantity\?: number\)/.test(src),
  'Có helper addBookLine(book, quantity?) dùng chung cho tìm kiếm và dán'
);
const addBookLineBlock = blockOf('const addBookLine');
for (const field of ['editionId', 'code', 'title', 'quantity', 'availableStock']) {
  expect(
    new RegExp(`${field}:`).test(addBookLineBlock),
    `addBookLine tạo đúng field "${field}" như dòng của tìm kiếm`
  );
}
expect(
  /staleWarning/.test(src) && /staleWarning: undefined/.test(src),
  'Dán giữ nguyên cơ chế staleWarning (vẫn phải qua bước kiểm tra tồn)'
);
// addBookLine gọi invalidateCart() (wrapper gộp mọi thay đổi bảng chuyển), nên
// phải kiểm tra CẢ hai tầng: wrapper có tồn tại và wrapper thật sự gọi
// invalidateValidation() — nếu chỉ grep `invalidateValidation()` trong addBookLine
// thì hành vi đã mất cũng xanh, tức là assertion yếu hơn hành vi nó bảo vệ.
expect(
  /invalidateCart\(\)/.test(blockOf('const addBookLine')),
  'Thêm dòng từ dán đi qua invalidateCart()'
);
expect(
  /invalidateValidation\(\)/.test(blockOf('const invalidateCart')),
  'invalidateCart() vẫn vô hiệu hoá kết quả kiểm tra tồn cũ'
);
expect(
  /prev\.find\(\(l\) => l\.editionId === book\.id\)/.test(addBookLineBlock) &&
    /l\.quantity \+ qty/.test(addBookLineBlock) &&
    /\? \{ \.\.\.l, quantity: l\.quantity \+ qty, staleWarning: undefined \}/.test(addBookLineBlock),
  'Trùng editionId thì CỘNG dồn số lượng vào một dòng thay vì thêm trùng'
);

// ---------------------------------------------------------------------------
// 8b. Luật BẤT ĐỐI XỨNG của thông báo sau thao tác thêm dòng (P6).
//
// addNotice là discriminated union { kind, text }:
//   - kind 'success'  = "Đã thêm: N đầu sách" -> NÓI VỀ BẢNG CHUYỂN.
//     Sửa/xoá dòng là con số đó không còn đúng ⇒ phải BỊ XOÁ.
//   - kind 'warning'  = "Kho nguồn không còn sách nào có tồn để lấy." -> NÓI VỀ
//     KHO NGUỒN, không nói về bảng chuyển ⇒ phải SỐNG SÓT qua mọi thay đổi dòng.
// Nếu cả hai cùng bị xoá, người dùng bấm lại "Thêm hết tồn kho nguồn" thì không
// còn manh mối nào cho biết vì sao không có gì được thêm.
// ---------------------------------------------------------------------------
expect(
  /useState<\{ kind: 'success' \| 'warning'; text: string \} \| null>\(null\)/.test(src),
  'addNotice là tagged union mang `kind`, KHÔNG được là chuỗi trần (nếu là string thì phân biệt thành công/rỗng biến mất)'
);
expect(
  !/useState<string \| null>\(null\)/.test(blockOf('const [addNotice')),
  'addNotice không được khai báo dạng string | null'
);
const invalidateCartBlock = blockOf('const invalidateCart');
expect(invalidateCartBlock.length > 0, 'Có helper invalidateCart() gom mọi thay đổi bảng chuyển');
expect(
  /setAddNotice\(\(prev\) => \(prev\?\.kind === 'success' \? null : prev\)\)/.test(
    invalidateCartBlock
  ),
  'invalidateCart chỉ xoá thông báo kind=success (giữ nguyên kind=warning vì nó mô tả kho nguồn, không mô tả bảng chuyển)'
);
expect(
  !/setAddNotice\(null\)/.test(invalidateCartBlock),
  'invalidateCart không được xoá mô bảo thông báo — cảnh báo kho nguồn rỗng phải sống sót'
);
expect(
  /setErrorMessage\(null\)/.test(invalidateCartBlock) &&
    /invalidateValidation\(\)/.test(invalidateCartBlock),
  'invalidateCart vẫn xoá lỗi cũ và huỷ kết quả kiểm tra tồn trước khi'
);

// Nguồn phát sinh hai loại thông báo — số lượng N và điều kiện rỗng.
const bulkSourceBlock = blockOf('const handleAddAllSourceStock');
expect(
  /toAdd\.length === 0[\s\S]{0,80}kind: 'warning'[\s\S]{0,120}Kho nguồn không còn sách nào có tồn để lấy\./.test(
    bulkSourceBlock
  ),
  'Kết quả RỖNG sinh thông báo kind=warning với câu "Kho nguồn không còn sách nào có tồn để lấy."'
);
expect(
  /kind: 'success'[\s\S]{0,160}Đã thêm: \$\{toAdd\.length\} đầu sách/.test(bulkSourceBlock),
  'Có dòng nào đó thì sinh thông báo kind=success "Đã thêm: N đầu sách"'
);

// Hiển thị: nhánh success vẽ hộp XANH + CheckCircle2, nhánh còn lại (warning)
// vẽ hộp HÀM NHẠT + AlertTriangle. Rỗng mà vẽ hộp xanh thì người dùng tưởng
// đã thêm thành công.
expect(
  /addNotice\.kind === 'success' \? \(/.test(src),
  'Render bắt đầu bằng nhánh addNotice.kind === "success" (nhánh else là warning)'
);
const noticeRenderAt = src.indexOf('addNotice.kind === \'success\' ? (');
const noticeRender = src.slice(noticeRenderAt, src.indexOf(')}', src.indexOf('<span>{addNotice.text}</span>', noticeRenderAt)));
expect(
  /bg-emerald-50 border border-emerald-200/.test(noticeRender) &&
    /CheckCircle2/.test(noticeRender),
  'Thông báo success vẽ hộp emerald + icon CheckCircle2'
);
expect(
  /bg-amber-50 border border-amber-200/.test(noticeRender) && /AlertTriangle/.test(noticeRender),
  'Thông báo warning (kho nguồn rỗng) vẽ hộp amber + icon AlertTriangle, KHÔNG dùng hộp xanh thắng lợi'
);
expect(
  (noticeRender.match(/<span>\{addNotice\.text\}<\/span>/g) || []).length === 2,
  'Cả hai nhánh đều render cùng addNotice.text (nhãn theo kind, nội dung theo text)'
);

// ---------------------------------------------------------------------------
// 9. Mobile hard constraints in the dialog.
// ---------------------------------------------------------------------------
expect(/min-h-\[38px\]/.test(src), 'Có lớp touch target tối thiểu 38px (min-h-[38px]) trong vùng dán');
expect(
  /min-w-\[38px\]/.test(src),
  'Có lớp touch target tối thiểu 38px theo chiều ngang (min-w-[38px])'
);
expect(
  /max-h-\[85vh\][^"]*overflow-y-auto/.test(src) || /overflow-y-auto[^"]*max-h-\[85vh\]/.test(src),
  'Hộp thoại dán cuộn được trên màn hình nhỏ (max-h + overflow-y-auto)'
);
expect(
  /w-full max-w-/.test(src) && /break-words/.test(src),
  'Hộp thoại dán giới hạn bề ngang + tên sách dài xuống dòng (break-words), không nở dialog'
);
expect(/truncate/.test(src) && /min-w-0/.test(src), 'Dùng truncate + min-w-0 cho chuỗi dài');
expect(
  !/min-w-\[[6-9]\d\dpx\]/.test(src),
  'Không có min-width cứng > 375px trong vùng dán (không gây tràn ngang)'
);

// ---------------------------------------------------------------------------
// 10. Existing protections are NOT regressed.
// ---------------------------------------------------------------------------
expect(/confirmDeleteAll/.test(src), 'Xác nhận xoá hết vẫn còn (confirmDeleteAll)');
expect(/Xóa hết \{lines\.length\} dòng\?/.test(src), 'Câu hỏi xác nhận xoá hết vẫn hiện');
expect(/onClick=\{handleRemoveAll\}/.test(src), 'Nút "Có" của xác nhận xoá hết vẫn gọi handleRemoveAll');
expect(
  /e\.key === 'Escape' && !isSubmitting && !isValidating\) onClose\(\)/.test(src),
  'Phím Escape đóng modal chính vẫn còn'
);
expect(
  /handleValidateBatch/.test(src) && /handleSubmitBatch/.test(src),
  'Hai nút Kiểm tra tồn kho / Xác nhận chuyển kho vẫn là đường duy nhất để gửi phiếu'
);
expect(/role="dialog"/.test(src) && /aria-modal="true"/.test(src), 'Modal chính giữ nguyên aria');
expect(
  /disabled=\{isSubmitting \|\| isValidating \|\| lines\.length === 0 \|\| validationSuccess !== true\}/.test(
    src
  ),
  'Nút chuyển kho vẫn bị khoá tới khi kiểm tra tồn kho thành công'
);

console.log('\nBatch paste UI contract - PASS');
for (const c of checks) console.log(c);
console.log(`\n${checks.length} assertions passed.\n`);

