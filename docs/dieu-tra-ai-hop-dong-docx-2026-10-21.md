# Điều tra kiến trúc AI module Hợp đồng + root cause lỗi file DOCX

Ngày: 2026-10-21. Người thực hiện: subagent điều tra (chỉ đọc, không sửa code).
Repo: nhánh dev, commit 8455c9e. Kiểm chứng sống trên dev.formapubli.vn.

---

## PHẦN 1 - KIẾN TRÚC AI CỦA MODULE HỢP ĐỒNG

### 1.1. "AI ở đây là gì? Có gọi LLM API không?"

CÓ. Mọi chức năng AI trong module Hợp đồng đều gọi **Google Gemini API** thật qua
HTTPS (`https://generativelanguage.googleapis.com/v1beta/models/...:generateContent`).
Đã kiểm chứng sống ngày 2026-10-21: gọi POST /api/ai/contracts/analyze với văn bản
mẫu, Gemini trả về phân tích tiếng Việt đúng trong ~3 giây.

- **Provider chính:** Google Gemini. Model đọc từ env `GEMINI_MODEL`
  (không hardcode trong code - thiếu env thì ném lỗi cấu hình, không âm thầm
  dùng model cũ).
- **API key:** env `GEMINI_API_KEY` (cả dev và production đều đã cấu hình -
  kiểm tra tên biến tồn tại, không đọc giá trị).
- **Dự phòng khi model chính nghẽn (503/429):** thử 1 lần model
  `GEMINI_FALLBACK_MODEL` (mặc định `gemini-3.5-flash-lite`). Không retry lỗi
  400/sai key.
- **Không có fallback khi thiếu key:** ném lỗi `THIEU_GEMINI_API_KEY` ngay,
  UI hiện thông báo. Không chế độ offline.
- **Tham số gọi:** `generationConfig: { responseMimeType: 'application/json' }`
  (bắt JSON thuần). KHÔNG gửi temperature (Google bỏ temperature từ model 3.6+,
  gửi là lỗi 400). Timeout 6 giây mỗi lượt gọi.
- Module hợp đồng CHỈ dùng Gemini. Các tầng Groq / Cloudflare Workers AI có tồn
  tại trong `src/services/ai/llm-client.ts` nhưng chỉ phục vụ Executive Copilot,
  không dùng cho hợp đồng.

### 1.2. Sơ đồ: từng chế độ AI

```
Người dùng (UI) → API route → service trong contract-ai.service.ts → callGeminiWithFallback
→ Gemini API (JSON) → parse + validate → UI hiển thị
```

| # | Chế độ (nút UI) | Trigger (UI → API) | Input → Output | Điểm đặc biệt |
|---|---|---|---|---|
| 1 | AI Đọc & Phản Biện - nút "Đọc" (AIContractReview.tsx) | POST /api/ai/contracts/analyze | Văn bản dán tay hoặc file .docx/.txt upload (trích text bằng PizZip, tối đa 5MB) → JSON {contractType, parties, valueText, keyDates, obligations, summary} | Text cắt ở 12000 ký tự; kết quả lưu bảng contractReviews để tra cứu |
| 2 | AI Đọc & Phản Biện - nút "Phản Biện" (AIContractReview.tsx) | POST /api/ai/contracts/review | Văn bản + loại hợp đồng → AI chấm theo **checklist nội bộ** của từng loại (file contract-checklists.ts: ví dụ HĐ thuê địa điểm có 6 mục đặt cọc/phạt hủy/PCCC...) → JSON {issues: [{checklistId, level: DAT/THIEU/MO_HO/RUI_RO, finding, suggestion}]} | KHÁC BIỆT LỚN NHẤT với gọi LLM thường: AI không phản biện tự do mà bị khóa vào checklist do team định nghĩa; mỗi checklistId bắt buộc thuộc checklist, level chỉ 4 giá trị; kết quả ghi rõ "chỉ tham khảo, không phải tư vấn pháp lý" |
| 3 | Soạn mẫu từ mô tả (AITemplateBuilder.tsx) | POST /api/ai/contracts/draft-template | {category, description} → JSON {title, bodyText, suggestedPlaceholders[]} | Prompt khóa văn phong pháp lý VN (LEGAL_STYLE); placeholder dạng {snake_case}; AI không được bịa điều khoản ngoài mô tả |
| 4 | Nhập mẫu từ Google Docs (AITemplateBuilder.tsx) | POST /api/ai/contracts/import-gdoc | Link Google Docs (tải qua export?format=txt, cần share công khai) → AI cấu trúc hóa: GIỮ NGUYÊN từng câu chữ gốc, chỉ thay điểm điền bằng {placeholder}, kèm originalText để đối chiếu | CẤM viết lại điều khoản - khác với soạn mới ở chế độ 3 |
| 5 | Soạn Thông Minh (AISmartDraft.tsx) | POST /api/ai/contracts/smart-draft → POST /api/ai/contracts/smart-finalize | {templateId, fieldValues, notes} → JSON {filledText, adjustments[]} | **Điểm đặc biệt nhất:** prompt có 2 quy tắc bất di bất dịch - (1) filledText chỉ điền giá trị vào placeholder, CẤM sửa điều khoản; (2) mọi đề xuất sửa điều khoản theo ghi chú tình huống PHẢI nằm riêng trong adjustments[] với original/proposed/reason, chờ người duyệt từng mục. UI hiển thị đề xuất ở trạng thái chờ duyệt, không tự áp dụng |
| 6 | Chốt mẫu (template builder) | POST /api/ai/contracts/finalize-template | Văn bản đã chốt → sinh .docx bằng thư viện `docx` (không phải AI) → validate bằng engine → lưu contract_templates (đánh dấu ai_generated=1, legal_reviewed=0) | Bước này KHÔNG gọi LLM, chỉ là đóng gói file |

### 1.3. Điểm đặc biệt so với "gọi LLM thông thường"

1. **Checklist nội bộ làm khung phản biện** (chế độ 2): AI bị ràng buộc vào danh mục
   kiểm tra của từng loại hợp đồng, không được phản biện tự do.
2. **Tách adjustments[] khỏi filledText** (chế độ 5): AI không được tự ý sửa điều
   khoản trong văn bản chính; mọi đề xuất nằm mảng riêng chờ người duyệt.
3. **Luôn validate JSON sau LLM:** parseJson lột vỏ ```json, kiểm tra trường bắt
   buộc, lọc bỏ mục không hợp lệ (checklistId lạ, level lạ) - AI bịa thì bị loại
   ở tầng này chứ không hiện ra UI.
4. **Không có rule engine chạy trước/sau AI** trong các luồng AI hiện tại. Rule
   engine R1-R6 (kiểm tra logic thời gian) thuộc module Dự án xuất bản, chưa đấu
   vào luồng AI.
5. **Audit:** finalize-template chỉ log hash SHA256 nội dung, không log nội dung
   hợp đồng.

---

## PHẦN 2 - ROOT CAUSE LỖI FILE DOCX TẢI VỀ KHÔNG MỞ ĐƯỢC

### 2.1. Kết luận ngắn

**3 mẫu seed trong DB (HD_XUAT_BAN_SEED, HD_DAI_LY_SEED, HD_DICH_THUAT_SEED) là file
.docx KHÔNG HỢP LỆ ngay từ lúc seed: thiếu part `_rels/.rels` bắt buộc của chuẩn
OOXML.** Mọi hợp đồng tạo từ 3 mẫu này, khi tải về, đều là file Word không mở được.
Production bị y hệt (3 mẫu seed giống từng byte).

### 2.2. Bằng chứng tái hiện

```bash
# 1. Tải file qua API export-docx trên dev (đăng nhập ADMIN-01)
curl -b cookie 'https://dev.formapubli.vn/api/contracts/documents/<id>/export-docx' -o test.docx
# HTTP 200, Content-Type đúng, 1038 bytes

# 2. Kiểm tra zip: ĐẠT (đây là lý do dễ bị đánh lừa)
unzip -t test.docx  # No errors detected
file test.docx      # Microsoft Word 2007+

# 3. Kiểm tra cấu trúc OOXML: LỖI
python3 -c "from zipfile import ZipFile; print(ZipFile('test.docx').namelist())"
# ['[Content_Types].xml', 'word/document.xml']  ← chỉ 2 parts
# '_rels/.rels' KHÔNG TỒN TẠI ← part BẮT BUỘC theo ECMA-376
```

Chuẩn OOXML yêu cầu mọi package .docx phải có `_rels/.rels` ở gốc (khai báo quan
hệ tới `word/document.xml`). Thiếu nó: `unzip` vẫn ok, `file` vẫn nhận diện,
nhưng **Microsoft Word từ chối mở** (báo file hỏng).

### 2.3. Truy vết nguồn lỗi

File `scripts/seed-contract-templates.ts`, hàm `build()`:

```ts
function build(paragraphs: string): string {
  const z = new PizZip();
  z.file('[Content_Types].xml', CONTENT_TYPES);
  z.file('word/document.xml', '...');
  // ← THIẾU: z.file('_rels/.rels', RELS_XML);
  return z.generate({ type: 'base64', compression: 'DEFLATE' });
}
```

Script tự dựng file .docx thủ công bằng PizZip nhưng **quên thêm `_rels/.rels`**.
Trớ trêu: `[Content_Types].xml` trong script còn khai báo
`<Default Extension="rels" ContentType="...relationships+xml"/>` - tức tác giả
biết cần rels nhưng quên thêm file thật.

Docxtemplater (engine merge) không validate cấu trúc package nên render bình
thường từ mẫu lỗi → mọi tài liệu sinh ra đều thừa hưởng lỗi.

### 2.4. Phạm vi ảnh hưởng (đã kiểm tra)

| Đối tượng | Tình trạng |
|---|---|
| 3 mẫu seed trên dev | LỖI (thiếu _rels/.rels) |
| 3 mẫu seed trên production | LỖI (giống hệt byte với dev) |
| Tài liệu tạo từ 3 mẫu seed → tải về | KHÔNG MỞ ĐƯỢC trong Word |
| Mẫu do AI sinh (thư viện `docx`) | ĐÚNG (đã kiểm tra: đủ parts, unzip sạch) |
| 5 mẫu chuẩn (HD_THIET_KE_BIA...) | template_data RỖNG (vấn đề khác - chờ upload, không liên quan lỗi này) |
| Đường export (headers, base64, blob) | ĐÚNG (đã kiểm tra localhost + HTTPS, bytes giống hệt) |
| Đường upload "bản cuối" | CÓ validate PizZip trước khi lưu - an toàn |

### 2.5. Hướng sửa (đề xuất, chưa thực hiện theo brief)

1. Sửa `scripts/seed-contract-templates.ts`: thêm vào hàm `build()`:
   ```ts
   z.file('_rels/.rels',
     '<?xml version="1.0" encoding="UTF-8"?>'
     + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
     + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
     + '</Relationships>');
   ```
2. Regenerate 3 mẫu seed và UPDATE `template_data` của 3 dòng tương ứng trong DB
   dev VÀ production (không cần migration - đây là dữ liệu seed).
3. Các tài liệu đã tạo từ mẫu lỗi: `renderedDocx` đã lưu cũng thiếu `_rels/.rels`.
   Cần re-render lại (gọi lại ContractEngineService.generateDocx với mẫu đã sửa)
   cho các document có templateId là 3 seed - hoặc đơn giản: mở từng hợp đồng và
   lưu lại để trigger re-render.
4. Về lâu dài: thêm validation "mẫu phải mở được bằng PizZip + có _rels/.rels"
   vào lúc seed/upload mẫu (hiện validateTemplate chỉ check placeholder qua
   docxtemplater, không check cấu trúc package).
