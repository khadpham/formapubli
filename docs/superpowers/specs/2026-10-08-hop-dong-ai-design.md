# Spec: AI cho module Hợp đồng (Contract AI)

Ngày: 2026-10-08 | Trạng thái: đã duyệt plan, auto-proceed
Người duyệt: Phạm Đan Khải (khadpham)

## 1. Bối cảnh

- Module hợp đồng hiện tại: merge mẫu `.docx` theo placeholder `{{ten_truong}}`
  (`contract-engine.service.ts` + docxtemplater), quản lý mẫu/hợp đồng/số HĐ
  (`contract.service.ts`, migration 0046).
- Hạ tầng LLM đã có: `src/services/ai/llm-client` (Gemini fallback, OpenAI,
  Groq, Cloudflare Worker AI) — Copilot đang dùng pattern planner → tools → synthesis.
- **Thực tế quan trọng:** công ty CHƯA có thư viện mẫu chuẩn trong hệ thống.
  Mẫu thật đang nằm rải rác (Google Docs). Không thể đi theo thứ tự
  "có mẫu rồi mới gắn AI".

## 2. Chiến lược: đảo ngược thứ tự

Dùng AI để **xây thư viện mẫu từ con số 0**, rồi AI vận hành trên chính thư viện đó.
Nguồn mẫu thật: user cung cấp link Google Docs → hệ thống nhập + AI cấu trúc hóa.

## 3. Các giai đoạn

### GĐ1 — AI dựng mẫu (làm trước — nút thắt hiện tại)

**3a. Soạn mẫu từ lời mô tả**
- Input: textarea mô tả bằng lời thường + chọn loại hợp đồng
  (THUE_DIA_DIEM_SK, DAT_HANG_HOA_SK, TAC_QUYEN, IN_AN, DAI_LY_PHAN_PHOI, KHAC).
- LLM soạn bản nháp đầy đủ điều khoản, văn phong pháp lý tiếng Việt.
- UI cho sửa trực tiếp trên nháp → chốt → lưu thành mẫu chính thức.
- Mẫu chốt lần đầu bắt buộc gắn cờ `legal_reviewed` sau khi người hiểu luật duyệt.

**3b. Nhập mẫu thật từ Google Docs link**
- Input: link Google Docs (mẫu công ty đang dùng).
- Server fetch `export?format=txt`, AI trích xuất văn bản → phát hiện các
  "điểm điền" (tên, số tiền, thời gian...) → đề xuất thành `{placeholder}`.
- User xác nhận/sửa placeholder → lưu thành mẫu chính thức trong `contract_templates`.
- Giữ nguyên văn phong điều khoản gốc của công ty (AI không viết lại điều khoản
  đã có, chỉ cấu trúc hóa).

**3c. Sinh file .docx mẫu**
- Từ văn bản đã chốt + placeholder → sinh `.docx` (dùng `docx` lib, thêm nếu chưa có)
  → lưu `templateData` (base64) + `schemaFields` (JSON).
- Tương thích ngược với engine merge hiện tại (docxtemplater).

**Phạm vi GĐ1:** 3 loại ưu tiên — thuê địa điểm sự kiện, đặt hàng hóa/dịch vụ
sự kiện, tác quyền. Quy trình chuẩn rồi mới nhân rộng.

### GĐ2 — Đọc hiểu + phản biện (sau GĐ1)

- Upload hợp đồng bất kỳ (kể cả đối tác gửi sang, .docx/.pdf/.txt):
  AI tóm tắt (loại HĐ, các bên, giá trị, deadline, nghĩa vụ chính) +
  trích xuất thực thể (số tiền, ngày tháng, tên bên).
- Checklist phản biện theo từng loại hợp đồng (lưu trong DB, version hóa):
  VD thuê địa điểm: đặt cọc? phạt hủy? ai lo điện nước/PCCC? bảo hiểm?
- Output: danh sách vấn đề (mức: thiếu / mơ hồ / rủi ro) + đề xuất câu chữ cụ thể.
- Mọi gợi ý gắn nhãn "tham khảo — cần người có trách nhiệm duyệt".

### GĐ3 — Soạn thảo thông minh từ mẫu

- Chọn mẫu đã duyệt + nhập dữ liệu → AI điền placeholder + điều chỉnh điều khoản
  trong phạm vi cho phép (VD: chiết khấu riêng, tiến độ giao hàng đợt này).
- "Khung cứng": điều khoản gốc của mẫu đã duyệt không được AI tự ý sửa/xóa —
  chỉ được đề xuất phiên bản thay thế để người duyệt.
- So sánh diff các phiên bản soạn thảo.

### GĐ4 — Trợ lý theo dự án/sự kiện

- Hợp đồng gắn vào dự án/sự kiện (liên kết `contractDocuments` ↔ project/event).
- Tới cột mốc: nhắc "cần ký hợp đồng X", soạn sẵn từ dữ liệu dự án.
- Dashboard: hợp đồng sắp hết hạn / tới hạn thanh toán theo milestone.

## 4. Kiến trúc kỹ thuật

```
src/app/api/ai/contracts/
  draft-template/route.ts   — GĐ1a: mô tả → nháp (LLM)
  import-gdoc/route.ts      — GĐ1b: link Google Docs → cấu trúc + placeholder (LLM)
  finalize-template/route.ts — GĐ1c: chốt → sinh .docx → lưu contract_templates
  analyze/route.ts          — GĐ2: tóm tắt + trích xuất
  review/route.ts           — GĐ2: phản biện theo checklist
  smart-draft/route.ts      — GĐ3: soạn thông minh từ mẫu
src/services/ai/
  contract-ai.service.ts    — prompt builder, gọi llm-client, parse output
  contract-checklists.ts    — checklist phản biện theo loại (version hóa)
src/components/contracts/
  AITemplateBuilder.tsx     — UI GĐ1 (mô tả/import → nháp → sửa → chốt)
```

- Tái dùng `callGeminiWithFallback` (JSON mode) — không thêm provider mới.
- Google Docs fetch: `https://docs.google.com/document/d/{id}/export?format=txt`
  (pattern đã dùng thành công cho tài liệu GĐ3).
- Phân quyền: AI contracts = quyền quản lý hợp đồng hiện tại (không nới).
- Audit: log mọi lần AI soạn/phản biện (ai_model, prompt version, output hash).

## 5. Quy tắc an toàn (bất di bất dịch)

1. AI không phải luật sư — mọi gợi ý điều khoản là "tham khảo".
2. Mẫu chính thức bắt buộc 1 lần duyệt bởi người hiểu luật (`legal_reviewed`).
3. Khung mẫu đã duyệt là bất biến với AI — chỉ đề xuất, không tự sửa.
4. Không gửi nội dung hợp đồng đi đâu ngoài các LLM provider đã cấu hình.
5. Cache kết quả phân tích theo hash nội dung — tránh gọi API trùng.

## 6. Phản biện plan (tự soi)

1. Rủi ro lớn nhất: chất lượng mẫu AI soạn lần đầu. Chốt chặn duy nhất hiệu quả
   là người hiểu luật duyệt — không có shortcut.
2. Tiếng Việt pháp lý là điểm yếu tương đối của LLM → prompt phải ép thuật ngữ
   luật VN, cấm dùng từ thông dụng cho văn bản pháp lý.
3. Đừng để AI "sáng tạo" điều khoản mỗi lần soạn — hợp đồng cần nhất quán.
4. Scope GĐ1 đã đủ lớn (3 loại HĐ × 2 luồng nhập) — không nhồi thêm GĐ2 vào cùng PR.

## 7. Khuyến nghị triển khai

- Thứ tự: GĐ1 → GĐ2 → GĐ3 → GĐ4. Không nhảy cóc.
- Mỗi GĐ = 1 branch + 1 PR + test riêng (theo quy trình A-Z đã chốt).
- Test: mock LLM response (không gọi API thật trong test), kiểm tra parse
  placeholder, sinh .docx merge được bằng engine hiện tại.
- Sau GĐ1: user nhập 3 mẫu thật → có thư viện mẫu tối thiểu → mới đáng làm GĐ2.

## 8. Tiêu chí nghiệm thu GĐ1

- [ ] Mô tả bằng lời → nháp hợp đồng tiếng Việt đọc được, đủ điều khoản cơ bản
- [ ] Link Google Docs → nhập được text, AI đề xuất placeholder đúng ≥80% điểm điền
- [ ] Chốt mẫu → sinh .docx merge thử thành công bằng engine hiện tại
- [ ] Mẫu lưu DB có cờ `legal_reviewed`, phân biệt nháp AI vs mẫu đã duyệt
- [ ] tsc sạch, test xanh, không lộ nội dung hợp đồng ra log
