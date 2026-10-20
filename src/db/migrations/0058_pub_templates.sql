-- 0058: 5 mau hop dong chuan cho chuoi san xuat xuat ban.
-- Thu tu: Thiet ke bia -> Bien dich -> Bien tap -> Dan trang -> Doc morat.

INSERT INTO contract_templates (id, code, title, category, description, template_filename, template_data, schema_fields, version, is_active, legal_reviewed, ai_generated)
VALUES ('tpl-tk-bia-001', 'HD_THIET_KE_BIA', 'Hop dong thiet ke bia sach', 'THIET_KE_BIA',
 'Mau chuan hop dong thiet ke bia sach (giai doan 1)',
 'HD_ThietKeBia_Template.docx', '',
 '{"fields": ["soHopDong", "ngayKy", "tenDoiTac", "tenSach", "ngayBatDau", "ngayKetThuc", "giaTriHopDong", "soLanSuaToiDa"]}',
 1, 1, 0, 0);
--> statement-breakpoint
INSERT INTO contract_templates (id, code, title, category, description, template_filename, template_data, schema_fields, version, is_active, legal_reviewed, ai_generated)
VALUES ('tpl-bien-dich-001', 'HD_BIEN_DICH_CHUAN', 'Hop dong bien dich (chuan)', 'BIEN_DICH',
 'Mau chuan hop dong bien dich sach (giai doan 2)',
 'HD_BienDich_Template.docx', '',
 '{"fields": ["soHopDong", "ngayKy", "tenDichGia", "butDanh", "tenSachGoc", "tacGiaGoc", "soTrang", "donGiaTrang", "giaTriHopDong", "thueTNCN", "giaTriThucNhan", "ngayBatDau", "ngayBanGiao"]}',
 1, 1, 0, 0);
--> statement-breakpoint
INSERT INTO contract_templates (id, code, title, category, description, template_filename, template_data, schema_fields, version, is_active, legal_reviewed, ai_generated)
VALUES ('tpl-bien-tap-001', 'HD_BIEN_TAP', 'Hop dong bien tap', 'BIEN_TAP',
 'Mau chuan hop dong cong tac bien tap (giai doan 3)',
 'HD_BienTap_Template.docx', '',
 '{"fields": ["soHopDong", "ngayKy", "tenBienTapVien", "tenSach", "ngayBatDau", "ngayKetThuc", "giaTriHopDong", "thueTNCN", "giaTriThucNhan"]}',
 1, 1, 0, 0);
--> statement-breakpoint
INSERT INTO contract_templates (id, code, title, category, description, template_filename, template_data, schema_fields, version, is_active, legal_reviewed, ai_generated)
VALUES ('tpl-dan-trang-001', 'HD_DAN_TRANG', 'Hop dong dan trang', 'DAN_TRANG',
 'Mau chuan hop dong dan trang (giai doan 4)',
 'HD_DanTrang_Template.docx', '',
 '{"fields": ["soHopDong", "ngayKy", "tenDoiTac", "tenSach", "kichThuoc", "soTrangDuKien", "ngayBatDau", "ngayKetThuc", "soLanSuaToiDa", "giaTriHopDong", "thueTNCN", "giaTriThucNhan"]}',
 1, 1, 0, 0);
--> statement-breakpoint
INSERT INTO contract_templates (id, code, title, category, description, template_filename, template_data, schema_fields, version, is_active, legal_reviewed, ai_generated)
VALUES ('tpl-doc-morat-001', 'HD_DOC_MORAT', 'Hop dong doc morat', 'DOC_MORAT',
 'Mau chuan hop dong doc morat (giai doan 5)',
 'HD_DocMorat_Template.docx', '',
 '{"fields": ["soHopDong", "ngayKy", "tenDoiTac", "tenSach", "ngayBatDau", "ngayBanGiao", "giaTriHopDong", "thueTNCN", "giaTriThucNhan"]}',
 1, 1, 0, 0);
