-- 0050: Cờ AI cho mẫu hợp đồng (Contract AI GĐ1).
-- legal_reviewed: mẫu đã qua 1 lần duyệt bởi người hiểu luật.
-- ai_generated: mẫu do AI soạn/nhập (phân biệt với mẫu soạn tay).
-- source_url: link Google Docs gốc (nếu nhập từ GĐ1b).
-- MỌI câu cách nhau bằng statement-breakpoint marker (quy ước migrate-fresh/drizzle).

ALTER TABLE contract_templates ADD COLUMN legal_reviewed INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE contract_templates ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE contract_templates ADD COLUMN source_url TEXT;
