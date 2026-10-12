'use client';

import ModulePlaceholder from '@/components/ui/ModulePlaceholder';

export default function ProjectsView() {
  return (
    <ModulePlaceholder
      title="Dự án xuất bản"
      description="Mỗi đầu sách là một dự án có vòng đời đầy đủ: từ mua bản quyền, dịch thuật, biên tập, thiết kế, dàn trang, cấp phép đến in ấn. Mọi chi phí và tiến độ được theo dõi realtime."
      features={[
        '7 giai đoạn: bản quyền → dịch thuật → biên tập → thiết kế bìa → dàn trang → cấp phép → in ấn',
        'Mỗi giai đoạn gắn với hợp đồng và biên bản nghiệm thu riêng',
        'Bảng theo dõi chi phí dự toán vs thực tế theo từng khoản mục',
        'Tự động tạo đề xuất thanh toán khi nghiệm thu được duyệt',
        'P&L theo từng đầu sách: doanh thu trừ giá vốn sau khi sách bán ra',
      ]}
    />
  );
}
