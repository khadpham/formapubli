'use client';

import ModulePlaceholder from '@/components/ui/ModulePlaceholder';

export default function DocumentsView() {
  return (
    <ModulePlaceholder
      title="Tài liệu"
      description="Kho tài liệu tập trung: hợp đồng, biên bản nghiệm thu, phiếu chi, chứng từ - tất cả liên kết với nghiệp vụ trong ERP. File lưu trên Cloudflare R2, metadata trong database."
      features={[
        'Upload tài liệu gắn với hợp đồng, phiếu chi, nhân sự, dự án',
        'Phân loại: HĐ khoán, biên bản nghiệm thu, giấy đề nghị TT, HĐ in, giấy tờ cá nhân',
        'Phân quyền theo vai trò: ai được xem/tải loại tài liệu nào',
        'Signed URL có thời hạn - link tự hết hạn sau 15 phút',
        'Tìm kiếm theo đầu sách, đối tác, loại giấy tờ',
      ]}
    />
  );
}
