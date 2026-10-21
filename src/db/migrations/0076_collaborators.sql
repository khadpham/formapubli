-- 0076: Bảng cộng tác viên (CTV) - hệ thống hóa thông tin người hợp tác.
-- Cộng tác viên KHÔNG phải nhân viên chấm công nên tách riêng khỏi staff_accounts.
-- Lưu thông tin định danh đầy đủ (CCCD, tài khoản ngân hàng) để làm cơ sở
-- điền hợp đồng, tra cứu và tính giá vốn theo đầu sách sau này.
CREATE TABLE collaborators (
  id TEXT PRIMARY KEY, -- ctv-<slug>
  full_name TEXT NOT NULL, -- Họ và tên
  pen_name TEXT, -- Bút danh
  role_title TEXT, -- Vai trò/vị trí (text tự do, điền tay)
  collab_type TEXT NOT NULL DEFAULT 'khac', -- thiet_ke_bia | dich_gia | bien_tap | doc_morat | hanh_chinh | dai_dien_ben_a | ben_b | khac
  dob TEXT, -- Ngày sinh (YYYY-MM-DD hoặc text gốc)
  id_number TEXT, -- Số CCCD/CMND/Hộ chiếu
  id_issued_date TEXT, -- Ngày cấp
  id_issued_place TEXT, -- Nơi cấp
  tax_id TEXT, -- Mã số thuế cá nhân
  address TEXT, -- Địa chỉ thường trú
  phone TEXT, -- Điện thoại
  email TEXT,
  bank_account TEXT, -- Số tài khoản
  bank_name TEXT, -- Tên ngân hàng
  bank_owner TEXT, -- Chủ tài khoản
  notes TEXT, -- Ghi chú
  is_active INTEGER NOT NULL DEFAULT 1, -- 1 hoạt động, 0 ngừng hợp tác
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_collab_name ON collaborators(full_name);
CREATE INDEX idx_collab_type ON collaborators(collab_type);
CREATE INDEX idx_collab_active ON collaborators(is_active);
