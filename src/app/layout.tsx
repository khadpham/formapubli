import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRegister } from '@/components/pwa/PwaRegister';

export const metadata: Metadata = {
  title: 'formapubli — ERP Quản Trị Kho Vận & Xuất Bản',
  description: 'Hệ điều hành quản trị xuất bản, vòng đời ISBN và sổ cái kho bất biến formapubli.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'formapubli OS',
  },
  icons: {
    icon: '/icons/icon-192.svg',
    apple: '/icons/icon-192.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// GO-LIVE CLOUDFLARE: toàn bộ app (pages + API routes) chạy Edge Runtime.
// next-on-pages từ chối build nếu bất kỳ route non-static nào thiếu runtime
// edge — đặt 1 lần ở root layout để khỏi rải 40 file route. node:crypto/
// Buffer trong services chạy được nhờ compatibility_flags nodejs_compat.
export const runtime = 'edge';

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

