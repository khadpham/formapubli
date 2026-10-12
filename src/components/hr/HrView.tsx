'use client';

import ModulePlaceholder from '@/components/ui/ModulePlaceholder';

export default function HrView() {
  return (
    <ModulePlaceholder
      title="Nhân sự"
      description="Quản lý hồ sơ, chấm công và lương cho đội ngũ dưới 10 người. Hỗ trợ cả lương tháng (full-time) và lương giờ (thu ngân part-time)."
      features={[
        'Hồ sơ nhân sự: mọi người xem được hồ sơ cá nhân của mình',
        'Chấm công: check-in/out, chống gian lận (đúng địa điểm, không chấm hộ)',
        'Lương tháng cho full-time, lương giờ (wage) cho thu ngân part-time',
        'Bảng lương duyệt → tự tạo phiếu chi trong Tài chính',
        'Phân ca làm việc theo tuần cho quầy và kho',
      ]}
    />
  );
}
