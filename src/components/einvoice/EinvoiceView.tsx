'use client';

import ModulePlaceholder from '@/components/ui/ModulePlaceholder';

export default function EinvoiceView() {
  return (
    <ModulePlaceholder
      title="Hóa đơn điện tử"
      description="Tích hợp API MS-Invoice (SaveInvoice): tạo, ký số từ xa và gửi hóa đơn trực tiếp từ ERP. Kế toán duyệt trên ERP, không cần USB token."
      features={[
        'Tạo hóa đơn nháp tự động khi đơn hàng hoàn tất',
        'Kế toán duyệt trên ERP → ký số từ xa qua IntrustCA (không cần USB)',
        'Hóa đơn điều chỉnh / thay thế khi có hoàn trả hàng',
        'Hóa đơn máy tính tiền cho quầy POS (không cần thiết bị phần cứng)',
        'Đồng bộ trạng thái về module Tài chính: doanh thu, thuế GTGT',
      ]}
    />
  );
}
