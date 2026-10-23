/**
 * Vai trò cộng tác viên dùng chung cho Nhân sự và Hợp đồng.
 * - collab_type trong DB là TEXT tự do, giá trị dưới đây là chuẩn.
 * - templateCode: mã mẫu hợp đồng tương ứng (code trong contract_templates).
 */
export interface CollabRole {
  value: string;
  label: string;
  templateCode: string | null;
}

export const COLLAB_ROLES: CollabRole[] = [
  { value: 'dich_gia', label: 'Dịch giả', templateCode: 'HD_BIEN_DICH_CHUAN' },
  { value: 'thiet_ke_bia', label: 'Thiết kế bìa', templateCode: 'HD_THIET_KE_BIA' },
  { value: 'bien_tap', label: 'Biên tập viên', templateCode: 'HD_BIEN_TAP' },
  { value: 'dan_trang', label: 'Dàn trang', templateCode: 'HD_DAN_TRANG' },
  { value: 'doc_morat', label: 'Đọc morat', templateCode: 'HD_DOC_MORAT' },
  { value: 'tac_gia', label: 'Tác giả', templateCode: null },
  { value: 'khac', label: 'Cộng tác viên khác', templateCode: null },
};

export const COLLAB_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  COLLAB_ROLES.map((r) => [r.value, r.label])
);

/** Các collab_type cũ vẫn hiển thị được (tương thích ngược). */
export const LEGACY_ROLE_LABELS: Record<string, string> = {
  hanh_chinh: 'Hành chính',
  dai_dien_ben_a: 'Đại diện bên A',
  ben_b: 'Bên B',
};

export function collabRoleLabel(value: string | null | undefined): string {
  if (!value) return '';
  return COLLAB_ROLE_LABELS[value] || LEGACY_ROLE_LABELS[value] || value;
}

export function templateCodeForRole(value: string | null | undefined): string | null {
  const r = COLLAB_ROLES.find((x) => x.value === value);
  return r ? r.templateCode : null;
}
