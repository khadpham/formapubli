// Danh muc hop dong dung chung cho API documents va templates.
// Quyet dinh 2026-10-19: mo rong allow-list them 8 category cua 5 mau chuan
// (migration 0060), giu lai 5 category cu de tuong thich nguoc.
export const CONTRACT_CATEGORIES = [
  'THIET_KE_BIA',
  'BIEN_DICH',
  'BIEN_TAP',
  'DAN_TRANG',
  'DOC_MORAT',
  'BB_NGHIEM_THU',
  'PHIEU_CHI',
  'UY_NHIEM_CHI',
  'TAC_QUYEN',
  'DAI_LY',
  'IN_AN',
  'DICH_THUAT',
  'KHAC',
] as const;

export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

export const CONTRACT_CATEGORY_LABELS: Record<string, string> = {
  THIET_KE_BIA: 'Thiet ke bia',
  BIEN_DICH: 'Bien dich',
  BIEN_TAP: 'Bien tap',
  DAN_TRANG: 'Dan trang',
  DOC_MORAT: 'Doc morat',
  BB_NGHIEM_THU: 'Bien ban nghiem thu',
  PHIEU_CHI: 'Phieu chi',
  UY_NHIEM_CHI: 'Uy nhiem chi',
  TAC_QUYEN: 'Tac quyen',
  DAI_LY: 'Dai ly',
  IN_AN: 'In an',
  DICH_THUAT: 'Dich thuat',
  KHAC: 'Khac',
};
