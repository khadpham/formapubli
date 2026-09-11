import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'formapubli — ERP Quản Trị Kho Vận & Xuất Bản',
  description: 'Hệ điều hành quản trị xuất bản, vòng đời ISBN và sổ cái kho bất biến formapubli.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
