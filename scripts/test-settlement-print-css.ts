/**
 * Test kiểm chứng cấu trúc CSS in ấn khổ A4 cho Biên bản chốt ngày (DailyFairSettlementModal.tsx)
 * Đảm bảo:
 * 1. @page margin chuẩn A4 portrait (12mm 10mm)
 * 2. #printable-settlement-report padding = 0 khi in để @page margin quản lý đồng đều mọi trang
 * 3. thead { display: table-header-group } để lặp lại tiêu đề bảng tồn sách khi sang trang mới
 * 4. tr { break-inside: avoid } để không bị xé đôi dòng sách
 * 5. Bảng tồn sách Mục IV không bị cưỡng ép break-inside: avoid ở khối cha
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function runTests() {
  const modalPath = path.join(__dirname, '..', 'src', 'components', 'pos', 'DailyFairSettlementModal.tsx');
  const content = fs.readFileSync(modalPath, 'utf8');

  console.log('--- Kiểm tra CSS in ấn trong DailyFairSettlementModal.tsx ---');

  // 1. Kiểm tra @page margin
  assert.ok(
    content.includes('margin: 12mm 10mm !important') || content.includes('margin: 12mm 10mm'),
    'Lỗi: @page phải có margin: 12mm 10mm !important để có lề trên/dưới/trái/phải chuẩn cho A4'
  );

  // 2. Kiểm tra padding của #printable-settlement-report
  assert.ok(
    content.includes('padding: 0 !important') || content.includes('padding: 0mm !important'),
    'Lỗi: #printable-settlement-report phải có padding: 0 !important khi in (lề do @page margin đảm nhiệm)'
  );

  // 3. Kiểm tra thead display table-header-group
  assert.ok(
    content.includes('table-header-group'),
    'Lỗi: thead phải có display: table-header-group để lặp lại tiêu đề khi bảng ngắt sang trang sau'
  );

  // 4. Kiểm tra tr break-inside: avoid
  assert.ok(
    content.includes('page-break-inside: avoid') && content.includes('break-inside: avoid'),
    'Lỗi: Các hàng tr phải có break-inside: avoid để chống xé đôi dòng sách'
  );

  // 5. Kiểm tra Section IV không bị bọc bởi class print-block cứng nhắc ép avoid
  // Section IV phải dùng class cho phép ngắt dòng tự nhiên
  const sectionIvMatch = content.match(/IV\.\s*TỒN SÁCH CUỐI NGÀY[\s\S]{1,300}<table/);
  assert.ok(sectionIvMatch, 'Lỗi: Không tìm thấy tiêu đề Mục IV và bảng tồn sách');
  assert.ok(
    !sectionIvMatch[0].includes('print-block'),
    'Lỗi: Khối bao quanh Mục IV không được dùng print-block (vì print-block ép break-inside: avoid làm dính mép dưới)'
  );

  console.log('✅ Cấu trúc CSS in ấn A4 đạt chuẩn 100%');
}

runTests();
