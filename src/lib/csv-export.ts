/**
 * Xuất CSV mở tốt bằng Excel tiếng Việt: BOM UTF-8 + escape chuẩn RFC 4180.
 * Pure (không DOM) để test được; tải file nằm ở `downloadCsv` (cần DOM).
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // Chống CSV/formula injection: ô bắt đầu bằng = + - @ bị Excel chạy thành
    // công thức → escape bằng dấu ' phía trước (mọi nơi Excel đều vô hiệu).
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM giúp Excel nhận UTF-8; \r\n là xuống dòng chuẩn CSV trên Windows.
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/** Tải 1 file CSV trên trình duyệt (gọi từ event handler). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
