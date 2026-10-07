# Quản Lý & Soạn Thảo Hợp Đồng Tự Động — Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng Module Quản lý & Soạn thảo Hợp đồng tự động tích hợp trực tiếp trên ERP `book.formaform.vn`, cắt giảm 90% thời gian soạn thảo lặp lại, kế thừa dữ liệu đối tác/tác phẩm sẵn có, xuất file Word (.docx) và PDF chuẩn thể thức văn bản hành chính Việt Nam (Nghị định 30/2020/NĐ-CP).

**Architecture:** Hybrid Template Engine — file Word (.docx) chứa placeholder `{ten_bien}` được quản lý động trong CSDL; engine `docxtemplater` + `pizzip` merge biến; Live Preview render bản merged .docx bằng `docx-preview` (merge chạy trên server, preview chỉ là xấp xỉ); bản in pháp lý chính thức luôn là file Word tải về. Bản hợp đồng sau merge chỉ là DRAFT — người dùng có thể tải Word, sửa ngoài, tải bản cuối lên trước khi chốt.

**Tech Stack:** Next.js 16.3.8 (ghim chính xác, không `^`), React 19, Drizzle ORM 0.45.3, LibSQL (@libsql/client 0.18.0), docxtemplater, pizzip, docx-preview, Tailwind CSS 3.4.9, Lucide React.

**Spec:** `docs/superpowers/specs/2026-10-07-quan-ly-soan-thao-hop-dong-design.md` (+ phần Bổ sung v2 cuối file spec)

**Phiên bản v2 (07/10/2026):** viết lại sau review — sửa 5 lỗi kiến trúc của bản v1, bổ sung yêu cầu chủ doanh nghiệp: **mọi nội dung phải tuỳ biến được, không khóa cố định gì cả** (xem D8, D9).

---

## Quyết định thiết kế v2 (bắt buộc tuân thủ, không được lùi lại v1)

**D1 — Live Preview = server merge + `docx-preview` render.**
Preview và file export đi qua CÙNG hàm `ContractEngineService.generateDocx` trên server (1 nguồn sự thật). Client gọi `POST /api/contracts/preview` (debounce 400ms khi gõ) rồi render bytes bằng `renderAsync()` của `docx-preview`. Preview là XẤP XỈ; nút "In/PDF" dùng `window.print()` trên khung preview; hợp đồng pháp lý quan trọng tải .docx về in từ Word (chuẩn 100%). CẤM merge docx phía client (sẽ phải nhân bản cấu hình engine — lệch 1 dòng là preview nói dối).

**D2 — Sinh số HĐ bằng bảng đếm, KHÔNG đếm COUNT+1.**
Copy pattern `0028_daily_order_counters.sql`: bảng `contract_counters(category, year, last_seq)`, cấp số bằng `INSERT ... ON CONFLICT DO UPDATE ... RETURNING last_seq` nguyên tử, chạy TRONG cùng transaction với INSERT hợp đồng. Đếm bằng `existing.length + 1` như v1 sẽ trùng số khi 2 người bấm cùng lúc → UNIQUE fail → 500.

**D3 — Không hồi tố thật sự: snapshot file đã render.**
Khi Lưu (POST/PUT), server merge xong và lưu **bytes .docx đã render (base64)** vào `contract_documents.rendered_docx`. Export phục vụ `final_docx ?? rendered_docx ?? re-render` (re-render chỉ là fallback cho DRAFT cũ). Khi template lên version mới, hợp đồng cũ tải lại vẫn nguyên nội dung.

**D4 — Extract/validate placeholder bằng chính docxtemplater + inspect-module.**
CẤM regex tự viết trên XML thô (Word bẻ `{ten_bien}` thành nhiều `<w:t>` run — regex v1 bỏ sót, và không phát hiện được dấu `{` lởm). Dùng `docxtemplater/js/inspect-module`: constructor tự parse và ném SyntaxError kèm chi tiết lỗi cú pháp → `validateTemplate` bắt được cả ngoặc lởm; `getAllTags()` trả đủ mọi tag kể cả split-run.

**D5 — Auth trên MỌI route.**
`await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'])` đầu mỗi handler (pattern `src/app/api/bank-accounts/route.ts`). v1 bỏ sót → chưa đăng nhập vẫn upload template / đọc toàn bộ hợp đồng.

**D6 — Chuẩn ND30/2020 đúng: ngày VÀ tháng pad 2 chữ số khi < 10.**
v1 chỉ pad tháng 1–2 (`month < 3`) → "tháng 09" sai mà test vẫn xanh vì test chỉ cover tháng 02/10/12. Đúng: `month < 10`. Test phải có trường hợp tháng 09.

**D7 — Tiền là INTEGER; ngày ký do người dùng nhập; số tiền bằng chữ tự sinh.**
`total_amount INTEGER` (VND làm tròn số nguyên đồng). `signed_date` lấy từ payload người dùng nhập — CẤM tự gán hôm nay. Composer tự tính `gia_tri_hd_chu = readVietnameseNumber(gia_tri_hd_so)` ngay khi gõ số tiền — đây là nỗi đau gốc số 3, phải wire.

**D8 — Thông tin công ty (Bên A) lưu bảng riêng, sửa được trong UI.**
Bảng `contract_company_profile` 1 dòng: `ten_cong_ty` (mặc định `FORMApubli`), `dai_dien` = **Phạm Đam Ca**, `chuc_vu` = Giám đốc, `dia_chi/mst/sdt/email` (chưa có số liệu thật — seed rỗng, người dùng tự điền trong UI; CẤM bịa). Autofill lấy từ bảng này; từng ô trong composer vẫn override được per-document. Tên pháp lý đầy đủ của công ty chờ chủ chốt — không tự suy diễn.

**D9 — Không khóa nội dung nào: luồng Draft → sửa ngoài Word → bản cuối.**
Bản merge chỉ là DRAFT. Luồng chốt chính thức: "Tải File Word" → người dùng sửa tùy ý trong Word (editor chuẩn, đúng thói quen) → "Tải bản cuối lên" (`PUT final-docx`) → status `FINALIZED`/`SIGNED`. Cấp 3 mức tuỳ biến, không gì bị khóa:
1. **File template** — thay bất kỳ lúc nào qua "Quản lý mẫu" (version tăng; hợp đồng cũ không ảnh hưởng nhờ D3).
2. **Giá trị biến** — sửa tự do trên form trước khi merge (kể cả ô auto-fill).
3. **Nội dung sau merge** — sửa ngoài Word và upload bản cuối; upload lại được nhiều lần (bản mới nhất thắng).
Chỉ duyệt `contract_number` là bất biến sau khi sinh (số HĐ không thu hồi — đúng thực tiễn pháp lý).

**D10 — Không dựng WYSIWYG editor trong app.**
TipTap/Quill bị loại từ spec (vỡ thể thức, convert HTML→docx hỏng khung). D9 dùng Word làm editor — đủ yêu cầu "sửa nội dung cuối" với diff nhỏ nhất.

**D11 — Bộ Preset lựa chọn nhanh, tuỳ biến được theo thời gian (yêu cầu chủ 07/10).**
Bảng `contract_presets`: mỗi preset = `{ label, values: Record<varKey, string> }` — KHÔNG hardcode preset nào trong code, tất cả nằm trong DB và CRUD được trong UI (thêm/sửa/xoá/sắp xếp/active). Hai nhóm sử dụng tự nhiên, nhận từ keys trong `values`:
- **Người đại diện**: chứa `ben_a_dai_dien`/`ben_a_chuc_vu` — ví dụ "Giám đốc — Phạm Đam Ca", "Phó Giám đốc — <tên>" (người dùng tự tạo).
- **Điều khoản**: điền text vào một biến điều khoản có sẵn trong template (ví dụ `{dieu_khoan_thanh_toan}`, `{dieu_khoan_bo_sung}`) — template phải có placeholder tương ứng; điều khoản nào mẫu chưa có chỗ thì dùng luồng D9 (sửa ngoài Word).
Bấm chip = áp values vào form; mọi giá trị vẫn sửa tay được (nhất quán D9). Composer hiện chip nhóm theo keys.

---

## Bối cảnh, Đề bài & Phân tích chuyên sâu

### 1. Đề bài từ thực tế doanh nghiệp
* **Thực trạng**: FORMApubli thường xuyên soạn thảo: HĐ tác quyền/cấp quyền sử dụng tác phẩm, HĐ dịch thuật & hiệu đính, HĐ gia công in ấn, HĐ đại lý phát hành/ký gửi, HĐ tài trợ/đồng xuất bản.
* **Điểm nghẽn**: 90% nội dung cố định (quốc hiệu, căn cứ luật, điều khoản chung, chế tài, bảng ký tên); chỉ 10% biến động (đối tác, CCCD/MST, tác phẩm, số liệu thương mại, ngày ký). Soạn tay 20–45 phút/HC, dễ sót dữ liệu cũ, dễ lệch tiền bằng chữ/số, file phân mảnh trên máy cá nhân.
* **Yêu cầu chủ (07/10)**: người đại diện Bên A là **ông Phạm Đam Ca**; mọi nội dung linh hoạt phải đổi được linh hoạt — không khóa cố định gì; bản chương trình sinh ra chỉ là draft, người dùng chính thức sửa nội dung cuối trước khi dùng (→ D8, D9).

### 2. So sánh phương án (tóm tắt — chi tiết ở spec)
| Tiêu chí | PA1: Hybrid Template Engine [CHỌN] | PA2: Microservice LibreOffice | PA3: WYSIWYG TipTap/Quill |
| :--- | :--- | :--- | :--- |
| Bảo toàn định dạng | 100% nguyên bản file Word mẫu | Tốt, dễ lỗi font VN trên Linux | Kém, vỡ thể thức |
| Tốc độ | < 0.5s | 2–5s | Tức thì |
| Hạ tầng (YAGNI) | 0 đồng, chạy Cloudflare OpenNext | VPS/Docker riêng | Phức tạp HTML→docx |
| An toàn pháp lý | Cao (+ D9: draft có thể sửa cuối) | Cao | Rủi ro xóa nhầm điều khoản |

---

## Global Constraints

- Next ghim `16.3.8` chính xác trong `package.json` — không `^`, không nâng phiên bản.
- BẤT BIẾN: `[vars] NEXT_PRIVATE_MINIMAL_MODE="1"` trong `wrangler.toml`; twin backslash `@libsql\\client` trong `next.config.mjs`.
- Test suite chạy qua `npx tsx scripts/run-isolated.ts --only=<suite>`; mọi suite mới phải đăng ký vào `ALL_SUITES` trong `scripts/run-isolated.ts`.
- TEST KHÔNG DÙNG CHUNG HẰNG/GIÁ TRỊ VỚI CODE: đọc giá trị từ `src/db/schema.ts` hoặc migration. Trước khi tin test xanh, cắt 1 chỗ trong code xem test có đỏ không.
- Lấy DDL từ file migration, không tự viết. `npm install` phải kèm `--include=dev`.
- Nhãn UI tiếng Việt CÓ DẤU, ngắn, động từ ngắn. Tên công ty trên văn bản in: `FORMApubli` (trừ khi chủ cung cấp tên pháp lý).
- Tiền VND làm tròn số nguyên đồng → `INTEGER`.
- Mọi API route phải có `requireSessionRole`.
- Sau MỖI task: `npx tsc --noEmit` sạch. Sửa file `.css` hoặc component có print CSS → phải `npm run build` (tsc không validate CSS).
- `git add` từng file, không `-A`; mỗi task 1 commit. KHÔNG commit `next-env.d.ts` (revert trước khi commit). KHÔNG commit secret.

---

## Review Focus

1. **Đọc số tiền thành chữ** (Task 1): `15.000.005` → "Mười lăm triệu không trăm linh năm đồng chẵn"; `1.000.000.000` → "Một tỷ đồng chẵn"; `21000` → "Hai mươi mốt nghìn"; `115000` → "Một trăm mười lăm nghìn" (lăm); `105` → "Một trăm linh năm" (linh); `11` → "Mười một". Chuẩn kế toán, sai 1 từ là hỏng.
2. **Định dạng ngày ND30** (Task 1): tháng 09 PHẢI ra "tháng 09" (bẫy v1). Test có ngày/tháng đều < 10.
3. **Placeholder split-run & ngoặc lởm** (Task 3): placeholder bị Word bẻ thành 2 `<w:t>` phải vẫn extract được; `{ten_bien` chưa đóng phải bị validate báo lỗi.
4. **Sinh số HĐ không race** (Task 4): 2 lần cấp số liên tiếp phải ra 01, 02; số cấp trong transaction INSERT hợp đồng.
5. **Không hồi tố** (Task 3/4/5): snapshot `rendered_docx` tại thời điểm lưu; đổi template sau đó không ảnh hưởng file cũ.
6. **Auth** (Task 5): mỗi route có `requireSessionRole`; test gọi handler thật với session ký thật.
7. **Auto-fill có thể override** (Task 4): giá trị tự điền vẫn sửa tay được trên form trước khi xuất.

---

## File Structure

```
src/
├── lib/
│   ├── vietnamese-number-reader.ts       # Đọc số tiền VND thành chữ chuẩn kế toán
│   └── vietnamese-date-formatter.ts      # Ngày tháng ND30/2020 (pad 2 chữ số)
├── db/
│   ├── migrations/
│   │   └── 0046_contract_management.sql  # 5 bảng: templates, documents, counters, company_profile, presets
│   └── schema.ts                         # Drizzle schema cho 5 bảng mới
├── services/
│   ├── contract-engine.service.ts        # Merge DOCX + extract/validate placeholder (inspect-module)
│   └── contract.service.ts               # Sinh số HĐ (counter), autofill, snapshot, final upload
├── app/api/contracts/
│   ├── templates/route.ts                # GET list, POST tạo (validate + scan placeholder)
│   ├── templates/[id]/route.ts           # GET, PUT (version++), DELETE (ngưng dùng)
│   ├── documents/route.ts                # GET list, POST soạn (tx: cấp số + insert + snapshot)
│   ├── documents/[id]/route.ts           # GET/PUT/DELETE
│   ├── documents/[id]/export-docx/route.ts   # GET: final_docx ?? rendered_docx ?? re-render
│   ├── documents/[id]/final-docx/route.ts    # PUT: upload bản cuối sau khi sửa ngoài Word
│   ├── preview/route.ts                  # POST: merge template+data → bytes (cho Live Preview)
│   ├── autofill/route.ts                 # GET: dữ liệu tự điền từ partner/work/edition
│   ├── presets/route.ts                  # GET/POST/PUT/DELETE preset lựa chọn nhanh (D11, 1 file)
│   └── company-profile/route.ts          # GET/PUT thông tin công ty Bên A
└── components/contracts/
    ├── ContractsTab.tsx                  # Tab chính: danh sách HĐ, bộ lọc, nút soạn mới
    ├── ContractComposerModal.tsx         # Soạn 2 cột: form + Live Preview; chip preset (D11)
    ├── ContractPrintPreview.tsx          # Khung A4 @media print, render docx-preview
    ├── PresetManagerModal.tsx            # Quản lý preset: CRUD + sắp xếp (D11)
    ├── TemplateManagerModal.tsx          # Upload mẫu, validate, đặt nhãn biến
    └── CompanyProfileForm.tsx            # Sửa thông tin công ty Bên A
```

---

## Task Breakdown

### Task 1: Smart Utilities — Đọc số thành chữ & Ngày tháng hành chính ND30

**Files:**
- Create: `src/lib/vietnamese-number-reader.ts`
- Create: `src/lib/vietnamese-date-formatter.ts`
- Create: `scripts/test-contract-helpers.ts`
- Modify: `scripts/run-isolated.ts` (đăng ký `ALL_SUITES`)

**Interfaces:**
- `readVietnameseNumber(amount: number): string`
- `formatVietnameseDate(dateInput: string | Date, prefixLocation?: string): string`

- [ ] **Step 1: Viết test trước (đỏ)**

Tạo `scripts/test-contract-helpers.ts`:

```typescript
import assert from 'node:assert/strict';
import { readVietnameseNumber } from '../src/lib/vietnamese-number-reader';
import { formatVietnameseDate } from '../src/lib/vietnamese-date-formatter';

async function run() {
  console.log('--- TEST CONTRACT HELPERS ---');

  // Đọc số thành chữ
  assert.equal(readVietnameseNumber(0), 'Không đồng chẵn');
  assert.equal(readVietnameseNumber(11), 'Mười một đồng chẵn');
  assert.equal(readVietnameseNumber(15000000), 'Mười lăm triệu đồng chẵn');
  assert.equal(readVietnameseNumber(50000000), 'Năm mươi triệu đồng chẵn');
  assert.equal(readVietnameseNumber(1000000000), 'Một tỷ đồng chẵn');
  assert.equal(readVietnameseNumber(1000005), 'Một triệu không trăm linh năm đồng chẵn');
  assert.equal(readVietnameseNumber(1000001), 'Một triệu không trăm linh một đồng chẵn');
  assert.equal(readVietnameseNumber(1010000), 'Một triệu không trăm mười nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(21000), 'Hai mươi mốt nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(125000), 'Một trăm hai mươi lăm nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(115000), 'Một trăm mười lăm nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(105), 'Một trăm linh năm đồng chẵn');

  // Ngày tháng ND30: ngày VÀ tháng pad 2 chữ số khi < 10 (bẫy v1: tháng 09)
  assert.equal(
    formatVietnameseDate('2026-02-05', 'Hà Nội'),
    'Hà Nội, ngày 05 tháng 02 năm 2026'
  );
  assert.equal(
    formatVietnameseDate('2026-09-09'),
    'ngày 09 tháng 09 năm 2026'
  );
  assert.equal(
    formatVietnameseDate('2026-12-25', 'TP. Hồ Chí Minh'),
    'TP. Hồ Chí Minh, ngày 25 tháng 12 năm 2026'
  );
  assert.equal(formatVietnameseDate('không phải ngày', 'Hà Nội'), '');

  console.log('Test Contract Helpers: PASS');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Chạy xác nhận đỏ** — `npx tsx scripts/test-contract-helpers.ts` → FAIL (module chưa tồn tại).

- [ ] **Step 3: Cài đặt 2 helper**

`src/lib/vietnamese-date-formatter.ts` — LƯU Ý: pad tháng khi `month < 10`, KHÔNG phải `month < 3` như v1:

```typescript
/**
 * Định dạng ngày tháng văn bản hành chính Việt Nam (Nghị định 30/2020/NĐ-CP).
 * Ngày và tháng viết bằng 2 chữ số: "ngày 05 tháng 03 năm 2026".
 */
export function formatVietnameseDate(dateInput: string | Date, prefixLocation?: string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';

  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();

  const dayStr = day < 10 ? `0${day}` : `${day}`;
  const monthStr = month < 10 ? `0${month}` : `${month}`;

  const baseDateText = `ngày ${dayStr} tháng ${monthStr} năm ${year}`;
  return prefixLocation?.trim() ? `${prefixLocation.trim()}, ${baseDateText}` : baseDateText;
}
```

`src/lib/vietnamese-number-reader.ts` — đọc 3 chữ số/nhóm, xử lý lăm/năm, mốt/một, linh/lẻ; kết quả viết hoa + "đồng chẵn" (logic đọc nhóm như v1 — đã đúng; giữ nguyên GROUPS `['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ']`, `readThreeDigits(value, isHighestGroup)` xử lý: tens>1 → "mươi"+(units===1?"mốt":units===5?"lăm":...), tens===1 → "mười"+(units===5?"lăm":...), tens===0 → hundreds>0||!isHighest ? "linh X" : "X").

- [ ] **Step 4: Chạy xác nhận xanh** — `npx tsx scripts/test-contract-helpers.ts` → PASS.
- [ ] **Step 5: Đăng ký suite vào `ALL_SUITES` trong `scripts/run-isolated.ts`.**
- [ ] **Step 6: Commit** — `git add` từng file: `src/lib/vietnamese-number-reader.ts src/lib/vietnamese-date-formatter.ts scripts/test-contract-helpers.ts scripts/run-isolated.ts`; message `feat(contracts): add vietnamese number reader and administrative date formatter`.

---

### Task 2: Database Migration & Schema

**Files:**
- Create: `src/db/migrations/0046_contract_management.sql`
- Modify: `src/db/schema.ts`
- Create: `scripts/test-contract-schema.ts`
- Modify: `scripts/run-isolated.ts`

- [ ] **Step 1: Viết migration `0046_contract_management.sql`**

```sql
-- 0046: Quản lý mẫu hợp đồng, hợp đồng đã soạn, bộ đếm số HĐ, thông tin công ty, preset nhanh.
-- 5 bảng. Lấy nguyên văn file này khi cần DDL — không tự viết lại.

CREATE TABLE contract_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                -- e.g. HD_XUAT_BAN
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'TAC_QUYEN', -- TAC_QUYEN | DAI_LY | IN_AN | DICH_THUAT | KHAC
  description TEXT,
  template_filename TEXT NOT NULL,
  template_data TEXT NOT NULL,              -- Base64 file .docx gốc
  schema_fields TEXT NOT NULL,              -- JSON: [{ key, label, type, required, autoFillSource }]
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_contract_templates_category ON contract_templates(category);

CREATE TABLE contract_documents (
  id TEXT PRIMARY KEY,
  contract_number TEXT NOT NULL UNIQUE,     -- e.g. 01/2026/HĐXB-FORMA
  template_id TEXT NOT NULL REFERENCES contract_templates(id),
  template_version INTEGER NOT NULL DEFAULT 1, -- version template tại thời điểm tạo
  title TEXT NOT NULL,
  partner_id TEXT REFERENCES partners(id),
  work_id TEXT REFERENCES works(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',     -- DRAFT | FINALIZED | SIGNED | CANCELLED
  payload_data TEXT NOT NULL,               -- JSON giá trị biến đã nhập (sửa được khi DRAFT)
  rendered_docx TEXT,                       -- snapshot .docx đã merge tại thời điểm lưu (base64)
  final_docx TEXT,                          -- bản cuối user upload sau khi sửa ngoài Word (base64)
  final_filename TEXT,
  created_by TEXT NOT NULL,
  signed_date TEXT,                         -- người dùng nhập, KHÔNG tự gán
  effective_date TEXT,
  expiry_date TEXT,
  total_amount INTEGER DEFAULT 0,           -- VND nguyên đồng, KHÔNG dùng REAL
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_contract_documents_partner ON contract_documents(partner_id);
CREATE INDEX idx_contract_documents_work ON contract_documents(work_id);
CREATE INDEX idx_contract_documents_status ON contract_documents(status);

-- Bộ đếm số HĐ theo (loại, năm) — pattern 0028: cấp số bằng UPDATE...RETURNING
-- nguyên tử, KHÔNG đếm COUNT+1 (race → trùng số → UNIQUE fail → 500).
CREATE TABLE contract_counters (
  category TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category, year)
);

-- Thông tin công ty Bên A — sửa được trong UI, KHÔNG hardcode.
-- Tên pháp lý đầy đủ chờ chủ doanh nghiệp chốt; mặc định theo luật hiển thị FORMApubli.
CREATE TABLE contract_company_profile (
  id TEXT PRIMARY KEY,                      -- luôn 'main'
  ten_cong_ty TEXT NOT NULL DEFAULT 'FORMApubli',
  dai_dien TEXT,
  chuc_vu TEXT DEFAULT 'Giám đốc',
  dia_chi TEXT,
  mst TEXT,
  sdt TEXT,
  email TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO contract_company_profile (id, ten_cong_ty, dai_dien, chuc_vu)
VALUES ('main', 'FORMApubli', 'Phạm Đam Ca', 'Giám đốc');

-- Bộ preset lựa chọn nhanh (D11): mỗi preset = label + map biến→giá trị.
-- Ví dụ "Giám đốc — Phạm Đam Ca" → {"ben_a_dai_dien":"Phạm Đam Ca","ben_a_chuc_vu":"Giám đốc"};
-- điều khoản → {"dieu_khoan_thanh_toan":"Bên B thanh toán một lần trong vòng 30 ngày..."}.
-- KHÔNG seed preset cứng nào ngoài dòng ví dụ dưới — người dùng tự tạo/sửa/xoá trong UI.
CREATE TABLE contract_presets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  values_json TEXT NOT NULL,               -- JSON Record<varKey, string>
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_contract_presets_sort ON contract_presets(sort_order);
INSERT INTO contract_presets (id, label, values_json, sort_order)
VALUES ('preset-giam-doc', 'Giám đốc — Phạm Đam Ca',
        '{"ben_a_dai_dien":"Phạm Đam Ca","ben_a_chuc_vu":"Giám đốc"}', 0);
```

- [ ] **Step 2: Viết test trước** — `scripts/test-contract-schema.ts`: DB file riêng `formapubli_test_contract_schema.db` (xoá cả `-wal/-shm/-journal`), `assertIsolatedTestDb` + `migrateFresh` (copy pattern suite có sẵn trong `scripts/`), sau đó: insert `contractTemplates` + `contractDocuments` (đọc tên cột từ `schema.ts`), select lại assert `title/category/status/totalAmount/templateVersion`; assert `contract_company_profile` có sẵn dòng 'main' với `dai_dien = 'Phạm Đam Ca'` (đặt giá trị expect trong TEST RIÊNG — không import từ code); assert `contract_presets` có sẵn preset 'Giám đốc — Phạm Đam Ca' với `valuesJson` parse được thành `{ben_a_dai_dien, ben_a_chuc_vu}`; insert 2 documents assert `contractNumber` UNIQUE chặn trùng (expect throw); insert/update preset assert CRUD + `sortOrder`.
- [ ] **Step 3: Thêm Drizzle schema vào `src/db/schema.ts`** cho 5 bảng trên (`contractTemplates`, `contractDocuments`, `contractCounters` với `primaryKey({ columns: [t.category, t.year] })`, `contractCompanyProfile`, `contractPresets`), field name khớp snake_case: `templateFilename`, `schemaFields`, `renderedDocx`, `finalDocx`, `finalFilename`, `templateVersion`, `totalAmount` (integer), `valuesJson`, `sortOrder`, `isActive` (boolean mode)...
- [ ] **Step 4: Chạy xanh** — `npx tsx scripts/test-contract-schema.ts` → PASS; đăng ký `ALL_SUITES`; `npx tsc --noEmit` sạch.
- [ ] **Step 5: Commit** — `src/db/migrations/0046_contract_management.sql src/db/schema.ts scripts/test-contract-schema.ts scripts/run-isolated.ts`; message `feat(contracts): add contract tables migration 0046`.

---

### Task 3: Core Engine — DOCX Merge & Placeholder Validate (inspect-module)

**Files:**
- Modify: `package.json` (`npm install --include=dev docxtemplater pizzip`)
- Create: `src/services/contract-engine.service.ts`
- Create: `scripts/test-contract-engine.ts`
- Modify: `scripts/run-isolated.ts`

- [ ] **Step 1: Cài deps** — `npm install --include=dev docxtemplater pizzip`; kiểm `Test-Path node_modules\docxtemplater\package.json` → True.

- [ ] **Step 2: Viết test trước (đỏ)** — `scripts/test-contract-engine.ts`. Dựng .docx tối thiểu trong bộ nhớ bằng PizZip (như v1: `word/document.xml` + `[Content_Types].xml`). 4 nhóm assert:
  1. **Split-run**: placeholder bẻ thành 2 run `<w:r><w:t>{ten_</w:t></w:r><w:r><w:t>doi_tac}</w:t></w:r>` → `extractPlaceholders` vẫn trả `['ten_doi_tac', ...]` (bẫy regex v1).
  2. **Ngoặc lởm**: `{so_tien` chưa đóng → `validateTemplate().isValid === false` và có `errors`.
  3. **Validate khớp**: template đủ 2 placeholder → `isValid === true`, `placeholders.length === 2`.
  4. **Merge**: `generateDocx(base64, {ten_doi_tac: 'Nguyễn Văn A', ...})` → giải nén result zip, `document.xml` chứa text đã thay, KHÔNG còn `{ten_doi_tac}`; file mở được bằng PizZip (ZIP không corrupt).

- [ ] **Step 3: Cài `src/services/contract-engine.service.ts`**

```typescript
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module';
// Nếu tsc báo thiếu type cho inspect-module, tạo shim:
// src/types/docxtemplater-inspect.d.ts:
//   declare module 'docxtemplater/js/inspect-module' {
//     export default class InspectModule { constructor(); getAllTags(): Record<string, any>; }
//   }

const ENGINE_OPTIONS = { paragraphLoop: true, linebreaks: true };

function toBinary(templateBase64: string): string {
  return typeof Buffer !== 'undefined'
    ? Buffer.from(templateBase64, 'base64').toString('binary')
    : atob(templateBase64);
}

export interface TemplateValidationResult {
  isValid: boolean;
  placeholders: string[];
  errors?: string[];
}

export class ContractEngineService {
  static generateDocx(templateBase64: string, data: Record<string, any>): Uint8Array {
    const zip = new PizZip(toBinary(templateBase64));
    const doc = new Docxtemplater(zip, ENGINE_OPTIONS);
    doc.render(data);
    return doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
  }

  static extractPlaceholders(templateBase64: string): string[] {
    const zip = new PizZip(toBinary(templateBase64));
    const iModule = new InspectModule();
    const doc = new Docxtemplater(zip, { ...ENGINE_OPTIONS, modules: [iModule] });
    doc.render({}); // render rỗng chỉ để populate tags; output bỏ đi
    const tags = iModule.getAllTags(); // { ten_bien: {} } — flatten key lồng nhau
    const out = new Set<string>();
    const walk = (node: Record<string, any>, prefix = '') => {
      for (const [k, v] of Object.entries(node)) {
        const full = prefix ? `${prefix}.${k}` : k;
        out.add(full);
        if (v && typeof v === 'object') walk(v as Record<string, any>, full);
      }
    };
    walk(tags);
    return Array.from(out);
  }

  static validateTemplate(templateBase64: string): TemplateValidationResult {
    try {
      return { isValid: true, placeholders: this.extractPlaceholders(templateBase64) };
    } catch (err: any) {
      const details = Array.isArray(err?.properties?.errors)
        ? err.properties.errors.map((e: any) => e.message ?? String(e))
        : undefined;
      return {
        isValid: false,
        placeholders: [],
        errors: details?.length ? details : [err?.message || 'File Word không hợp lệ'],
      };
    }
  }
}
```

- [ ] **Step 4: Chạy xanh** — PASS; đăng ký `ALL_SUITES`; `npx tsc --noEmit` sạch.
- [ ] **Step 5: Commit** — `package.json package-lock.json src/services/contract-engine.service.ts scripts/test-contract-engine.ts scripts/run-isolated.ts` (+ shim nếu có); message `feat(contracts): add docx templating engine with inspect-module validation`.

---

### Task 4: Contract Service — Cấp số nguyên tử, Auto-Fill, Snapshot, Final Upload

**Files:**
- Create: `src/services/contract.service.ts`
- Create: `scripts/test-contract-service.ts`
- Modify: `scripts/run-isolated.ts`

**Interfaces:**
- `generateContractNumber(category, year?)` — trong v1 đã lỗi; giờ dùng `contract_counters`.
- `getAutoFillData({ partnerId?, workId?, editionId? })`
- `createDocument(data)` — tx: cấp số + insert + render snapshot.
- `updateDocument(id, data)` — chỉ khi DRAFT; re-render snapshot.
- `uploadFinalDocx(id, base64, filename)` — D9: validate zip mở được, set `final_docx/final_filename`, status → `FINALIZED`.
- `listTemplates / listDocuments / getDocumentById / getCompanyProfile / updateCompanyProfile`
- `listPresets / createPreset / updatePreset / deletePreset` — D11: CRUD preset, giữ nguyên thứ tự `sortOrder`

- [ ] **Step 1: Viết test trước (đỏ)** — `scripts/test-contract-service.ts`: DB riêng + migrateFresh + seed đối tác/tác phẩm/ấn bản (đọc trường thật từ `schema.ts`: partners `type:'INTERNAL'`, taxCode, address...; works `translator`; editions `coverPrice, isbn`) + seed 1 template với docx test hợp lệ chứa `{ben_b_ten}`, `{so_hop_dong}`, `{ben_a_dai_dien}`. Assert:
  1. Auto-fill: `ben_b_ten` = tên partner; `ben_a_dai_dien` = 'Phạm Đam Ca' (từ company_profile — đặt giá trị expect trong test trực tiếp, không import từ service); `ma_isbn`, `gia_bia_so` đúng định dạng `125.000 VNĐ`.
  2. `createDocument` lần 1 → số `01/2026/HĐXB-FORMA`; lần 2 → `02/2026/HĐXB-FORMA` (cấp số tuần tự).
  3. `renderedDocx` được lưu; giải nén assert text đã thay + còn `so_hop_dong` đúng số.
  4. `uploadFinalDocx` với base64 docx khác → `finalDocx` mới, status `FINALIZED`; export logic (`finalDocx ?? renderedDocx`) ưu tiên bản cuối.
  5. `updateCompanyProfile` đổi tên công ty → autofill sau đó trả tên mới (chứng minh không khóa cố định).
  6. Preset (D11): seed có sẵn "Giám đốc — Phạm Đam Ca"; `createPreset` thêm "Phó Giám đốc — <tên test>" → `listPresets` trả đủ 2; `updatePreset` đổi label + values; `deletePreset` xoá; `sortOrder` giữ nguyên thứ tự sau CRUD.

- [ ] **Step 2: Cài `src/services/contract.service.ts`** — điểm then chốt:

```typescript
// Cấp số nguyên tử trong transaction — pattern daily_order_counters (0028)
static async generateContractNumber(category: string, year = new Date().getFullYear()): Promise<string> {
  const catCode = PREFIX_MAP[category] ?? 'HĐ'; // TAC_QUYEN:'HĐXB', DAI_LY:'HĐĐL', IN_AN:'HĐIN', DICH_THUAT:'HĐDT'
  const rows = await db.all<{ last_seq: number }>(sql`
    INSERT INTO contract_counters (category, year, last_seq)
    VALUES (${category}, ${year}, 1)
    ON CONFLICT (category, year) DO UPDATE SET last_seq = last_seq + 1
    RETURNING last_seq
  `);
  const seq = Number(rows[0]?.last_seq ?? 0);
  const seqStr = seq < 10 ? `0${seq}` : `${seq}`;
  return `${seqStr}/${year}/${catCode}-FORMA`;
}

static async createDocument(input: {
  templateId: string; title: string; payloadData: Record<string, any>;
  partnerId?: string; workId?: string; signedDate?: string;
  effectiveDate?: string; expiryDate?: string; totalAmount?: number;
  createdBy: string; category: string;
}) {
  const [tpl] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, input.templateId));
  if (!tpl) throw new Error('Không tìm thấy mẫu hợp đồng');
  return await db.transaction(async (tx) => {
    const rows = await tx.all<{ last_seq: number }>(sql`
      INSERT INTO contract_counters (category, year, last_seq)
      VALUES (${input.category}, ${YEAR}, 1)
      ON CONFLICT (category, year) DO UPDATE SET last_seq = last_seq + 1
      RETURNING last_seq
    `);
    const contractNumber = formatNumber(Number(rows[0].last_seq), YEAR, input.category);
    const [doc] = await tx.insert(contractDocuments).values({
      id: `cdoc-${crypto.randomUUID()}`,
      contractNumber,
      templateId: tpl.id,
      templateVersion: tpl.version,
      title: input.title,
      partnerId: input.partnerId ?? null,
      workId: input.workId ?? null,
      status: 'DRAFT',
      payloadData: JSON.stringify(input.payloadData),
      createdBy: input.createdBy,
      signedDate: input.signedDate ?? null, // người dùng nhập, không tự gán
      totalAmount: Math.round(input.totalAmount ?? 0),
    }).returning();
    // Snapshot D3: merge ngay và lưu bytes — chống hồi tố
    const binary = ContractEngineService.generateDocx(tpl.templateData, {
      ...input.payloadData,
      so_hop_dong: contractNumber,
    });
    await tx.update(contractDocuments)
      .set({ renderedDocx: Buffer.from(binary).toString('base64') })
      .where(eq(contractDocuments.id, doc.id));
    return { ...doc, contractNumber };
  });
}
```

Auto-fill: Bên A lấy từ `contractCompanyProfile` (không hardcode); bank Bên A từ `bankAccounts` (`isActive = true`, lấy dòng đầu); Bên B từ `partners` (name/receiverName/taxCode/address/phone/email, `discountRate*100`%, `creditLimit`, `paymentDueDays`); tác phẩm từ `works` (title/author/translator) + `editions` (isbn, `coverPrice` → `gia_bia_so` = `toLocaleString('vi-VN')` + ' VNĐ', `gia_bia_chu` = `readVietnameseNumber` bỏ đuôi ' đồng chẵn'). Mọi giá trị auto-fill chỉ là DEFAULT — người dùng override trên form.

- [ ] **Step 3: Chạy xanh** — PASS; đăng ký `ALL_SUITES`; `npx tsc --noEmit` sạch.
- [ ] **Step 4: Commit** — message `feat(contracts): add contract service with atomic numbering, autofill and snapshots`.

---

### Task 5: API Endpoints (có Auth) — Preview, Export, Final Upload, Company Profile

**Files:**
- Create: 9 route files theo File Structure
- Create: `scripts/test-contract-api.ts`
- Modify: `scripts/run-isolated.ts`

**Quy tắc chung:**
- MỌI handler bắt đầu bằng `await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[])` (pattern `src/app/api/bank-accounts/route.ts:16`).
- Error shape `{ success: false, error: '...' }` + status 400/404/500 như các route hiện có.
- Response binary: `new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { headers: ... })`.

**Endpoints:**
| Route | Ý nghĩa | Ghi chú |
| :--- | :--- | :--- |
| `GET/POST /api/contracts/templates` | List / tạo mẫu | POST: `validateTemplate` + sinh `schema_fields` từ placeholders (label = key tạm, UI cho sửa nhãn) |
| `GET/PUT/DELETE /api/contracts/templates/[id]` | Chi tiết / cập nhật / ngưng dùng | PUT file mới → `version + 1`, giữ `template_data` cũ trong payload trả về để đối chiếu |
| `GET/POST /api/contracts/documents` | List / soạn mới | POST gọi `ContractService.createDocument` |
| `GET/PUT/DELETE /api/contracts/documents/[id]` | Chi tiết / sửa (chỉ DRAFT) / xoá | PUT đổi status chỉ cho phép chuyển hợp lệ |
| `GET /api/contracts/documents/[id]/export-docx` | Tải file Word | `final_docx ?? rendered_docx ?? re-render`; header `Content-Disposition` filename encode |
| `PUT /api/contracts/documents/[id]/final-docx` | Upload bản cuối (D9) | Body JSON `{ base64, filename }`; validate zip + docxtemplater parse được trước khi lưu |
| `POST /api/contracts/preview` | Live Preview (D1) | Body `{ templateId, data }` → bytes docx, `Content-Type` docx, `inline` |
| `GET /api/contracts/autofill` | Dữ liệu tự điền | Query `partnerId/workId/editionId` |
| `GET/POST/PUT/DELETE /api/contracts/presets` | Preset nhanh (D11, 1 file) | POST/PUT body gồm `label, valuesJson, sortOrder`; DELETE query `?id=`; GET trả list active + tất cả |
| `GET/PUT /api/contracts/company-profile` | Thông tin công ty | PUT toàn phần, không khóa field nào |

- [ ] **Step 1: Viết 9 route files** (theo bảng trên).
- [ ] **Step 2: Viết test trước** — `scripts/test-contract-api.ts`:
  - DB riêng + migrateFresh. **Gọi HANDLER THẬT** — không insert/select DB trực tiếp thay cho API (v1 đã phạm).
  - Session thật: ký bằng `signSession` từ `src/lib/auth-session.ts` (mở file, tra interface `SessionPayload` + `SESSION_COOKIE_NAME` + yêu cầu trường của `validateSessionAccount` — seed 1 staff_accounts row active tương ứng trong test DB). Truyền cookie vào `new Request(url, { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } })`.
  - Assert: (1) GET templates không cookie → 401/403; (2) POST preview với template test → trả bytes docx, giải nén thấy text thay thế; (3) POST documents → trả `contractNumber` đúng format, sau đó GET export-docx → bytes cuối giải nén được; (4) PUT final-docx → export sau đó trả BẢN CUỐI (khác rendered); (5) PUT company-profile đổi tên → GET autofill trả tên mới; (6) POST preset mới → GET presets trả đủ; PUT/DELETE preset theo id.
- [ ] **Step 3: Chạy xanh** — PASS; đăng ký `ALL_SUITES`; `npx tsc --noEmit` sạch.
- [ ] **Step 4: Commit** — message `feat(contracts): add authenticated contract api routes with preview and final upload`.

---

### Task 6: UI Module — Tab Hợp Đồng, Composer 2 cột, Preview A4, Luồng bản cuối

**Files:**
- Create: `src/components/contracts/` (5 components + CompanyProfileForm)
- Modify: `src/lib/roles.ts` — thêm `'contracts'` vào `allowedNavItems` của `ROLE_OWNER` và `ROLE_MANAGER` (danh sách hiện có: `'chu', 'dashboard', 'pos', 'inventory', 'sales', 'shopee', 'partners', 'customers', 'settings', 'studio'` — GIỮ nguyên, chỉ chèn `'contracts'`).
- Modify: `src/components/layout/AppSidebar.tsx` — nav item `{ id: 'contracts', label: 'Hợp Đồng', icon: FileText, ... }`.
- Modify: `src/components/layout/MasterAppShell.tsx` — render tab `contracts`.

**Deps:** `npm install --include=dev docx-preview`.

**Yêu cầu UI:**
1. **ContractsTab**: danh sách hợp đồng (mã, tiêu đề, đối tác, trạng thái, ngày ký); bộ lọc theo loại/trạng thái/đối tác; nút "Soạn Hợp Đồng" + "Quản Lý Mẫu" + "Thông Tin Công Ty". Nhãn tiếng Việt có dấu, ngắn; nút có icon + aria-label + trạng thái sau bấm ("Đã lưu: HĐXB 01/2026...").
2. **ContractComposerModal** (2 cột):
   - Trái: chọn Mẫu → chọn Đối tác (search) → chọn Tác phẩm/Ấn bản → form các biến (từ `schema_fields`, nhãn tiếng Việt đặt được ở TemplateManager); ô auto-fill có badge "Tự điền" nhưng **sửa tay được**; ô "Số tiền (VNĐ)" nhập → tự sinh **"Bằng chữ"** (`readVietnameseNumber`) hiển thị cạnh ô, người dùng không gõ tay phần này; ngày ký là ô input do người dùng chọn.
   - **Hàng chip "Chọn nhanh" (D11)**: nhóm "Người đại diện" (chứa keys `ben_a_*` — seed sẵn "Giám đốc — Phạm Đam Ca") và nhóm "Điều khoản" (biến `dieu_khoan_*` có trong template). Bấm chip = áp values vào form (form vẫn sửa tay). Cạnh nhóm có nút "Quản lý preset" mở `PresetManagerModal`.
   - Phải: **Live Preview** — debounce 400ms gọi `POST /api/contracts/preview` → `renderAsync(bytes, container)` của `docx-preview`. Lỗi preview hiển thị inline, không chặn nhập liệu.
   - Nút: "Lưu" (POST documents → toast số HĐ), "Tải File Word" (GET export-docx), "In / Xuất PDF" (`window.print()` trên khung preview).
3. **ContractPrintPreview**: `@media print` ẩn toàn bộ UI còn lại; khung A4 210×297mm, lề Trái 30mm/Phải 15mm/Trên-Dưới 20mm, Times New Roman 13pt, Justified. Ghi chú hiển thị: bản in từ trình duyệt là xấp xỉ; hợp đồng chính thức in từ file Word.
4. **Luồng bản cuối (D9)** — trong chi tiết hợp đồng: nút "Tải File Word" → hướng dẫn ngắn "Sửa nội dung trong Word nếu cần" → nút "Tải bản cuối lên" (chọn file .docx → đọc base64 → `PUT final-docx` → status chuyển "Đã chốt"). Upload lại được nhiều lần, bản mới nhất thắng.
5. **TemplateManagerModal**: upload .docx → validate → liệt kê placeholder tìm thấy → đặt nhãn tiếng Việt cho từng biến + đánh dấu bắt buộc → lưu. PUT mẫu mới → version tăng tự động.
6. **CompanyProfileForm**: sửa 8 trường thông tin công ty (đã seed Phạm Đam Ca / Giám đốc); địa chỉ, MST, SĐT, email để người dùng tự điền lần đầu.
7. **PresetManagerModal (D11)**: CRUD preset (thêm/sửa/xoá), nút lên/xuống đổi `sortOrder`, bật/tắt active; label + form map biến→giá trị (chọn biến có trong template hoặc gõ key mới); toast trạng thái sau mỗi thao tác ("Đã thêm preset: ...").

**Verification (bắt buộc):**
- [ ] `npx tsc --noEmit` sạch.
- [ ] `npm run build` xanh (sửa print CSS — tsc không đủ).
- [ ] Kiểm chứng browser thật bằng orca (`orca screenshot` / `orca eval`): tab hiện đúng, modal 2 cột render, preview không tràn, `window.print()` ra khổ A4 đúng lề. UI xanh ở tầng source CHƯA counted là nghiệm thu.

- [ ] **Commit** — `src/lib/roles.ts src/components/layout/AppSidebar.tsx src/components/layout/MasterAppShell.tsx src/components/contracts/`; message `feat(contracts): add contracts tab with composer, live preview and final-upload flow`.

---

### Task 7: Seed Mẫu Chuẩn + E2E + Nghiệm Thu

**Files:**
- Create: `scripts/seed-contract-templates.ts` — dựng 3 mẫu .docx chạy được (dùng builder PizZip như test): `Mau_HD_Xuat_Ban_FORMA.docx`, `Mau_HD_Dai_Ly_Phat_Hanh_FORMA.docx`, `Mau_HD_Dich_Thuat_FORMA.docx`; nội dung đủ ND30 (quốc hiệu, căn cứ, điều khoản mẫu, bảng ký tên) + placeholder chuẩn theo danh mục biến ở spec 3.2; seed kèm `contract_company_profile` (id 'main', dai_dien 'Phạm Đam Ca' — có sẵn từ migration; script chỉ cập nhật nếu thiếu).
  - LƯU Ý: 3 mẫu seed là **khung chạy được**, không phải văn bản pháp lý chốt của công ty — người dùng thay bằng file Word mẫu thật qua "Quản lý mẫu" (D9.1).
- Create: `scripts/test-contracts-e2e.ts` — luồng thật: seed → validate template → autofill (partner + work + edition) → áp preset "Giám đốc — Phạm Đam Ca" vào payload → composer payload (gia_tri_hd_chu tự sinh) → createDocument (số 01/2026/HĐXB-FORMA) → export giải nén assert MỌI placeholder đã thay (kể cả `ben_a_dai_dien` = Phạm Đam Ca) → uploadFinalDocx → export lần 2 trả bản cuối → createDocument lần 2 → số 02/2026 (counter tuần tự) → CRUD preset tạo "Phó Giám đốc" test rồi xoá.
- Modify: `scripts/run-isolated.ts`.

**Steps:**
- [ ] Viết seed script + chạy để seed vào dev DB (`formapubli.db` — kiểm schema dev trước bằng `npx tsx scripts/check-dev-db-schema.ts`, vá bằng `npx tsx scripts/fix-dev-db-schema.ts` nếu thiếu migration).
- [ ] Viết test E2E → đỏ → chạy `npx tsx scripts/test-contracts-e2e.ts` → xanh.
- [ ] Verify HTTP tầng 3: tạo `scripts/verify-contracts-live.ts` theo pattern `scripts/verify-pos-live.ts` (đăng nhập thật, gọi `/api/contracts/*` thật, tạo 1 hợp đồng thật, tải file Word giải nén kiểm tra) — bắt lỗi mà suite cô lập không bắt (dev DB thiếu migration → mọi đơn 500).
- [ ] Chạy toàn bộ: `npx tsx scripts/run-isolated.ts --only=test-contract-helpers,test-contract-schema,test-contract-engine,test-contract-service,test-contract-api,test-contracts-e2e` → tất cả xanh.
- [ ] `npm run build` xanh.
- [ ] Commit — message `feat(contracts): add default publishing templates and e2e verification`.
- [ ] **SAU DEPLOY (coordinator):** apply migration 0046 lên production DB TRƯỚC khi dùng endpoint (bài học 0042/0043 — thiếu migration ⇒ mọi POST 500); rồi chạy `verify-contracts-live` hướng production.

---

## Runbook: Đưa template Word hiện có của công ty vào hệ thống

1. **Mở file Word mẫu chuẩn**, Save As giữ `.docx`.
2. **Thay chỗ biến động bằng placeholder** `{ten_bien}` — gõ thẳng vào chỗ nội dung cũ, giữ nguyên định dạng xung quanh. Ví dụ: tên đối tác cũ → `{ben_b_ten}`; ngày ký → `{ngay_ky}`; số tiền bằng chữ → `{gia_tri_hd_chu}` (tự sinh, không gõ tay).
3. **3 quy tắc cấm**: không đặt placeholder trong Textbox/khung chữ nổi; không gõ `{` rồi copy-paste tên biến (gõ liền mạch); không đặt trong hình ảnh. Đặt ở header/footer được.
4. **Tab Hợp Đồng → Quản lý mẫu → Tải file Word lên**: hệ thống validate + liệt kê placeholder → đặt nhãn tiếng Việt có dấu cho từng biến (`ben_b_cccd_mst` → "CCCD/MST Bên B"), đánh dấu bắt buộc → lưu.
5. **Soạn thử 1 hợp đồng, tải Word về kiểm tra** — sạch mới kích hoạt mẫu.

**Bảng biến tự điền sẵn (khi chọn đối tác/tác phẩm):**

| Biến | Nguồn |
| :--- | :--- |
| `ben_b_ten`, `ben_b_dia_chi`, `ben_b_sdt`, `ben_b_email`, `ben_b_cccd_mst`, `ben_b_dai_dien` | `partners` |
| `ty_le_chiet_khau`, `han_muc_cong_no`, `thoi_han_thanh_toan` | `partners` (discountRate, creditLimit, paymentDueDays) |
| `ten_tac_pham`, `tac_gia`, `dich_gia` | `works` |
| `ma_isbn`, `gia_bia_so`, `gia_bia_chu` | `editions` |
| `ben_a_ten`, `ben_a_dai_dien`, `ben_a_chuc_vu`, `ben_a_dia_chi`, `ben_a_mst`, `ben_a_sdt`, `ben_a_tk_ngan_hang`, `ben_a_ngan_hang` | `contract_company_profile` + `bank_accounts` — sửa được trong UI và trên form |
| `so_hop_dong`, `ngay_ky`, `gia_tri_hd_chu` | Tự sinh (counter / ND30 formatter / đọc số thành chữ) |

**Cấp tuỳ biến (không khóa gì):** file mẫu thay được qua UI; giá trị biến sửa tay được trước khi merge; nội dung sau merge sửa ngoài Word rồi "Tải bản cuối lên" — upload lại nhiều lần, bản mới nhất thắng.

**Bộ preset nhanh (D11):** tab Hợp Đồng → hàng chip "Chọn nhanh" (bấm là điền form) → "Quản lý preset" để thêm/sửa/xoá/sắp xếp. Ví dụ tạo sẵn: "Giám đốc — Phạm Đam Ca" (seed sẵn), "Phó Giám đốc — <tên>", và các preset điều khoản (thanh toán, bồi thường, bất khả kháng...) — mỗi preset gán text vào một biến `{dieu_khoan_*}` có trong template. Thêm biến mới vào template qua "Quản lý mẫu" khi cần chỗ cho preset.

---

## Open Questions (chờ chủ doanh nghiệp, không chặn triển khai)

1. **Tên pháp lý đầy đủ của Bên A** trên hợp đồng (hiện `FORMApubli` theo quy ước hiển thị; `ben_a_ten` sửa tay được nên không chặn).
2. Địa chỉ trụ sở, MST, SĐT, email công ty — seed rỗng, điền lần đầu trong "Thông Tin Công Ty".
3. Khi hủy hợp đồng (`CANCELLED`), số HĐ không thu hồi (mặc định đã vậy — đúng thực tiễn). Nếu chủ muốn hành vi khác thì sửa sau.