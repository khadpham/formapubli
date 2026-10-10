import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRegister } from '@/components/pwa/PwaRegister';

export const metadata: Metadata = {
  title: 'formapubli - ERP Quản Trị Kho Vận & Xuất Bản',
  description: 'Hệ điều hành quản trị xuất bản, vòng đời ISBN và sổ cái kho bất biến formapubli.',
  manifest: '/manifest.json',
  // Trình duyệt yêu cầu `mobile-web-app-capable`; `apple-mobile-web-app-capable` là
  // bản legacy và bị cảnh báo deprecated. Khai cả hai để iOS vẫn nhận.
  other: {
    'mobile-web-app-capable': 'yes',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'formapubli OS',
  },
  icons: {
    icon: '/icons/icon-192.png',
    // iOS BỎ QUA IM LẶNG mọi apple-touch-icon không phải PNG. Trỏ vào .svg thì
    // sau khi Thêm vào Màn hình Chính, icon là ảnh chụp màn hình hoặc trống.
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // BẮT BUỘC để mọi `env(safe-area-inset-*)` trong UI (7 chỗ: MasterAppShell,
  // AppSidebar, PosCheckoutTerminal) có giá trị thật. Thiếu nó thì cả chạy ra
  // 0px → app chạy fullscreen bị Dynamic Island / thanh home đè lên nội dung.
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}

