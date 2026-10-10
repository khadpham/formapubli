export type ChecklistSeverity = 'THIEU' | 'MO_HO' | 'RUI_RO';

export interface ChecklistItem {
  id: string;
  label: string;
  hint: string;
  severity: ChecklistSeverity;
}

export const DEFAULT_CHECKLISTS: Record<string, { version: number; items: ChecklistItem[] }> = {
  THUE_DIA_DIEM_SK: {
    version: 1,
    items: [
      { id: 'dat-coc', label: 'Đặt cọc', hint: 'Tỷ lệ đặt cọc, thời điểm đặt, điều kiện hoàn trả/mất cọc', severity: 'THIEU' },
      { id: 'phat-huy', label: 'Phạt hủy', hint: 'Mức phạt khi hủy trước sự kiện bao lâu, có phân bậc theo thời gian không', severity: 'RUI_RO' },
      { id: 'dien-nuoc-pccc', label: 'Điện/nước/PCCC', hint: 'Bên nào chịu trách nhiệm và chi phí điện, nước, phòng cháy chữa cháy', severity: 'MO_HO' },
      { id: 'bao-hiem', label: 'Bảo hiểm', hint: 'Ai mua bảo hiểm sự kiện, phạm vi bảo hiểm', severity: 'THIEU' },
      { id: 'ban-giao', label: 'Bàn giao/hoàn trả mặt bằng', hint: 'Thời điểm bàn giao, hiện trạng hoàn trả, phạt chậm trả mặt bằng', severity: 'MO_HO' },
      { id: 'phu-phi', label: 'Phụ phí ngoài giờ', hint: 'Phí phát sinh khi dùng quá giờ, phí vệ sinh, an ninh', severity: 'MO_HO' },
    ],
  },
  DAT_HANG_HOA_SK: {
    version: 1,
    items: [
      { id: 'mo-ta', label: 'Mô tả hàng hóa/dịch vụ', hint: 'Chủng loại, số lượng, quy cách cụ thể - tránh mô tả chung chung', severity: 'MO_HO' },
      { id: 'nghiem-thu', label: 'Tiêu chuẩn nghiệm thu', hint: 'Ai nghiệm thu, tiêu chí đạt/không đạt, thời hạn nghiệm thu', severity: 'THIEU' },
      { id: 'tien-do', label: 'Tiến độ giao hàng', hint: 'Mốc giao từng đợt, địa điểm giao, ai chịu phí vận chuyển', severity: 'THIEU' },
      { id: 'thanh-toan', label: 'Thanh toán theo đợt', hint: 'Tỷ lệ từng đợt, điều kiện thanh toán (sau nghiệm thu?)', severity: 'MO_HO' },
      { id: 'phat-cham', label: 'Phạt chậm giao', hint: 'Mức phạt theo ngày chậm, giới hạn tối đa', severity: 'RUI_RO' },
      { id: 'bao-hanh', label: 'Bảo hành/đổi trả', hint: 'Thời hạn bảo hành, điều kiện đổi trả hàng lỗi', severity: 'THIEU' },
    ],
  },
  TAC_QUYEN: {
    version: 1,
    items: [
      { id: 'pham-vi', label: 'Phạm vi quyền', hint: 'Độc quyền hay không độc quyền, quyền nào được chuyển giao (xuất bản, phát hành, số hóa...)', severity: 'RUI_RO' },
      { id: 'thoi-han', label: 'Thời hạn', hint: 'Hợp đồng có thời hạn bao lâu, điều kiện gia hạn', severity: 'THIEU' },
      { id: 'lanh-tho', label: 'Lãnh thổ', hint: 'Phạm vi lãnh thổ khai thác (Việt Nam / toàn cầu)', severity: 'MO_HO' },
      { id: 'nhuan-but', label: 'Nhuận bút', hint: 'Tỷ lệ %, cách tính, kỳ quyết toán, có tạm ứng và khấu trừ không', severity: 'THIEU' },
      { id: 'cham-dut', label: 'Chấm dứt', hint: 'Điều kiện mỗi bên được chấm dứt trước hạn, hậu quả khi chấm dứt', severity: 'RUI_RO' },
      { id: 'vi-pham-bq', label: 'Vi phạm bản quyền', hint: 'Trách nhiệm khi tác phẩm bị xâm phạm, ai chịu chi phí bảo vệ quyền', severity: 'RUI_RO' },
    ],
  },
};

const FALLBACK: ChecklistItem[] = [
  { id: 'doi-tuong', label: 'Đối tượng hợp đồng', hint: 'Đối tượng được mô tả rõ ràng, không mơ hồ', severity: 'MO_HO' },
  { id: 'gia-tri', label: 'Giá trị', hint: 'Số tiền cụ thể, đã gồm/không gồm thuế', severity: 'THIEU' },
  { id: 'thoi-han-chung', label: 'Thời hạn', hint: 'Ngày bắt đầu, ngày kết thúc rõ ràng', severity: 'THIEU' },
  { id: 'thanh-toan-chung', label: 'Thanh toán', hint: 'Phương thức, thời hạn thanh toán', severity: 'MO_HO' },
  { id: 'tranh-chap', label: 'Giải quyết tranh chấp', hint: 'Thương lượng trước hay ra tòa/trọng tài, cơ quan nào', severity: 'RUI_RO' },
];

/** Lấy checklist theo loại - chưa có thì dùng checklist chung tối thiểu. */
export function getChecklist(category: string): ChecklistItem[] {
  return DEFAULT_CHECKLISTS[category]?.items ?? FALLBACK;
}
