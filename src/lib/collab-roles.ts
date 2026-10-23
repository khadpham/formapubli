/**
 * Vai tro cong tac vien dung chung cho Nhan su va Hop dong.
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
];

export const COLLAB_ROLE_LABELS: Record<string, string> = {
  dich_gia: 'Dịch giả',
  thiet_ke_bia: 'Thiết kế bìa',
  bien_tap: 'Biên tập viên',
  dan_trang: 'Dàn trang',
  doc_morat: 'Đọc morat',
  tac_gia: 'Tác giả',
  khac: 'Cộng tác viên khác',
};

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
