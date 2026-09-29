/**
 * MẪU IN ẤN — 2 bảo đảm cho MỌI phiếu in (nhiệt K80/K57 và A4 giao hàng):
 *
 *  1) DÒNG "Thu ngân:" phải in TÊN THẬT, tuyệt đối không in chuỗi vai trò giả.
 *     Lỗi gốc: thermalReceipt.ts dựng `order.cashierId || `User-${currentRole}``
 *     → đơn không có cashierId thì phiếu in ra "User-ROLE_CASHIER", người dùng
 *     thấy chuỗi rác. Sửa: resolveCashierLabel() thuần (tên > mã > rỗng) và
 *     dòng "Thu ngân:" chỉ in khi thật sự có dữ liệu.
 *
 *  2) HOTLINE = 0969973863 ở mọi mẫu in, khai báo ở MỘT chỗ duy nhất
 *     (src/lib/companyInfo.ts) để sau này đổi số chỉ sửa một dòng.
 *     Lỗi gốc: hai mẫu in viết tay 2 kiểu placeholder khác nhau
 *     (098.xxx.xxxx và 0988.xxx.xxx) nên không mẫu nào in được số thật.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};

const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8');

async function main() {
  const thermalSrc = read('src/lib/thermalReceipt.ts');
  const deliverySrc = read('src/components/inventory/DeliveryReceiptPrint.tsx');

  // Nếu chưa có resolveCashierLabel thì dùng lại ĐÚNG hành vi cũ làm chuẩn đỏ,
  // để suite đỏ vì lý do thật chứ không vì "không import được module".
  const thermalModule: Record<string, unknown> = await import('../src/lib/thermalReceipt').catch(
    () => ({}) as Record<string, unknown>
  );
  const resolveCashierLabel: (cashierId?: string, cashierName?: string) => string =
    (thermalModule.resolveCashierLabel as unknown as (a?: string, b?: string) => string) ??
    ((cashierId?: string) => cashierId || 'User-ROLE_CASHIER');

  const companyInfo: Record<string, unknown> = await import('../src/lib/companyInfo').catch(
    () => ({}) as Record<string, unknown>
  );

  // ---------- 1. TÊN THU NGÂN ----------
  ok(
    typeof thermalModule.resolveCashierLabel === 'function',
    'thermalReceipt phải export resolveCashierLabel() để thu ngân in ra tên thật'
  );
  ok(
    resolveCashierLabel('nv01', 'Nguyễn Văn A') === 'Nguyễn Văn A',
    'có tên thật thì in TÊN, không in mã nhân viên'
  );
  ok(resolveCashierLabel('nv01', '') === 'nv01', 'không có tên thì lùi về mã nhân viên');
  ok(resolveCashierLabel('nv01') === 'nv01', 'không truyền tên thì lùi về mã nhân viên');
  ok(
    resolveCashierLabel('', '') === '' && resolveCashierLabel(undefined, undefined) === '',
    'không có cả tên lẫn mã thì trả chuỗi rỗng (bỏ dòng), KHÔNG dựng chuỗi giả'
  );
  ok(
    resolveCashierLabel('', '   ') === '' && resolveCashierLabel('  ', '  ') === '',
    'tên/máy toàn khoảng trắng phải coi như không có, không in khoảng trắng'
  );
  ok(
    !/User-/.test(resolveCashierLabel(undefined, undefined)),
    'không được trả về chuỗi dạng "User-<role>" khi thiếu dữ liệu thu ngân'
  );

  ok(
    !/User-\$\{/.test(thermalSrc),
    'thermalReceipt KHÔNG được dựng chuỗi vai trò giả "User-${...}" nữa'
  );
  ok(
    !/User-/.test(thermalSrc),
    'không còn chuỗi "User-" nào trong mã nguồn in phiếu nhiệt'
  );
  ok(
    /cashierName\?:\s*string/.test(thermalSrc),
    'printThermalReceipt phải nhận tham số tuỳ chọn cashierName?: string'
  );
  ok(
    /resolveCashierLabel\(order\.cashierId,\s*order\.cashierName\s*\|\|\s*cashierName\)/.test(thermalSrc),
    'phải ưu tiên order.cashierName, rồi tham số cashierName, rồi mới tới order.cashierId'
  );
  ok(
    /\$\{[\s\S]{0,60}?cashier\s*\?[\s\S]{0,400}?Thu ngân:[\s\S]{0,300}?:\s*''/.test(thermalSrc),
    'dòng "Thu ngân:" phải bọc điều kiện — không có dữ liệu thì KHÔNG in dòng rỗng'
  );

  // ---------- 2. HOTLINE DÙNG CHUNG ----------
  const hotline = companyInfo.COMPANY_HOTLINE;
  ok(
    typeof hotline === 'string' && hotline === '0969973863',
    'src/lib/companyInfo.ts phải export COMPANY_HOTLINE = "0969973863"'
  );
  ok(
    /from '\.\/companyInfo'/.test(thermalSrc),
    'thermalReceipt phải import COMPANY_HOTLINE từ companyInfo (không viết số tay)'
  );
  ok(
    !/Hotline:\s*0/.test(thermalSrc),
    'mẫu in nhiệt không được viết tay số hotline sau nhãn "Hotline:"'
  );
  ok(
    /\$\{COMPANY_HOTLINE\}/.test(thermalSrc),
    'dòng hotline đầu phiếu phải in từ hằng COMPANY_HOTLINE'
  );
  ok(
    /hotline CSKH \$\{COMPANY_HOTLINE\}/.test(thermalSrc),
    'dòng cuối phiếu phải in số hotline thật: "hotline CSKH ${COMPANY_HOTLINE}"'
  );

  ok(
    /import \{ COMPANY_HOTLINE \} from '@\/lib\/companyInfo'/.test(deliverySrc),
    'DeliveryReceiptPrint phải import COMPANY_HOTLINE từ @/lib/companyInfo'
  );
  ok(
    /Hotline: \{COMPANY_HOTLINE\}/.test(deliverySrc),
    'phiếu A4 giao hàng phải in số hotline lấy từ hằng dùng chung'
  );

  // Quét toàn repo (trừ CSV dữ liệu khách, node_modules, .next, scripts): không
  // được còn mẫu in nào để lại placeholder số điện thoại cũ.
  const skipDirs = new Set(['node_modules', '.next', '.git', 'data_tabs', 'scripts', 'skills', '.agents', 'reports', '.vercel']);
  const offenders: string[] = [];
  const scan = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        scan(path.join(dir, entry.name));
      } else if (/\.(ts|tsx|js|jsx|md|json|html|css)$/i.test(entry.name)) {
        const file = path.join(dir, entry.name);
        const text = fs.readFileSync(file, 'utf8');
        if (/\b0?98\d?[\s.\-]?x{3,}/i.test(text) || /\b09[0-9]{2}[\s.\-]?x{3}/i.test(text)) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
  };
  for (const top of ['src', 'docs', 'public']) {
    const abs = path.resolve(ROOT, top);
    if (fs.existsSync(abs)) scan(abs);
  }
  ok(
    offenders.length === 0,
    `không còn placeholder số điện thoại kiểu "098.xxx" / "0988.xxx" — còn ở: ${offenders.join(', ')}`
  );

  console.log(`\n=== PHIẾU IN: TÊN THU NGÂN + HOTLINE DÙNG CHUNG: ${checks} assertions PASS ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
