-- 0077: Liên kết hợp đồng -> cộng tác viên để tổng hợp giá trị hợp đồng theo từng người.
-- Dùng cho khối "Tổng hợp hợp đồng" trong tab Nhân sự (mục Cộng tác viên).
ALTER TABLE contract_documents ADD COLUMN collaborator_id TEXT REFERENCES collaborators(id);
CREATE INDEX idx_contract_documents_collaborator ON contract_documents(collaborator_id);
