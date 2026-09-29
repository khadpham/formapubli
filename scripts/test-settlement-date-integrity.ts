/**
 * Biên bản chốt ngày: KHÔNG BAO GIỜ in số liệu của ngày khác.
 *
 * 1. fetchSettlement không có chốt chặn theo thứ tự request. Đổi ngày 29 → 28,
 *    nếu response ngày 29 về sau thì setData ghi đè số liệu ngày 28. Mà biên bản
 *    in ra (và cả tiêu đề) lấy ngày từ `selectedDate` — state của ô date — chứ
 *    không phải `data.reportDate` mà API trả về. Kết quả: BIÊN BẢN BÀN GIAO CHO
 *    KẾ TOÁN mang số tiền ngày 29 dưới dấu ngày 28.
 * 2. `if (json.success)` không có else, không đo `res.ok`. Lỗi 403/500 bị nuốt,
 *    hiện ra thành "Không có dữ liệu báo cáo cho ngày đã chọn" — thông báo sai,
 *    khiến người dùng tưởng dữ liệu mất. Tệ hơn: `data` cũ vẫn còn trong state
 *    nên màn hình hiện số của ngày trước dưới nhãn ngày mới. Chỉ cần MỘT lần
 *    lỗi 500 là xảy ra, không cần race.
 *
 * Test chạy HÀM THẬT trong modal (bóc qua AST + `vm`, không cần trình duyệt,
 * không cần DB) với `fetch` giả để điều khiển thứ tự response về.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const MODAL = 'src/components/pos/DailyFairSettlementModal.tsx';
const src = readFileSync(MODAL, 'utf8');

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};

// --- Bóc đúng hàm fetchSettlement ra khỏi component ----------------------------
const sourceFile = ts.createSourceFile(MODAL, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let fetchSettlementExpr: string | undefined;
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'fetchSettlement' && node.initializer) {
    fetchSettlementExpr = node.initializer.getText(sourceFile);
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
ok(!!fetchSettlementExpr, `phải tìm thấy hàm fetchSettlement trong ${MODAL}`);

type Deferred = { resolve: (value: any) => void; reject: (reason: any) => void; promise: Promise<any> };
const defer = (): Deferred => {
  let resolve!: (value: any) => void;
  let reject!: (reason: any) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
};

const okResponse = (reportDate: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: { reportDate, financials: { netSales: 1 } } }),
});
const errorResponse = (status: number, error?: string) => ({
  ok: false,
  status,
  json: async () => ({ success: false, error }),
});

function harness() {
  const calls: { name: string; value: unknown }[] = [];
  const pending: { url: string; deferred: Deferred }[] = [];
  const scope: any = {
    currentWarehouseId: 'wh-1',
    selectedDate: '2026-09-29',
    currentRole: 'ROLE_OWNER',
    requestSeqRef: { current: 0 },
    encodeURIComponent,
    console: { error: () => {}, warn: () => {}, log: () => {} },
    fetch: (url: string) => {
      const deferred = defer();
      pending.push({ url, deferred });
      return deferred.promise;
    },
    setData: (value: unknown) => calls.push({ name: 'setData', value }),
    setIsLoading: (value: unknown) => calls.push({ name: 'setIsLoading', value }),
    setLoadError: (value: unknown) => calls.push({ name: 'setLoadError', value }),
  };
  vm.createContext(scope);
  const js = ts.transpileModule(`const fetchSettlement = ${fetchSettlementExpr}; fetchSettlement;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const fetchSettlement = vm.runInContext(js, scope) as () => Promise<void>;
  const writes = (name: string) => calls.filter((c) => c.name === name).map((c) => c.value);
  // `setLoadError(null)` lúc bắt đầu mỗi request là chủ đích (xoá lỗi cũ), không
  // phải thông báo lỗi. Chỉ tính giá trị khác null.
  const errorMessages = () => writes('setLoadError').filter((v) => v !== null);
  return { fetchSettlement, scope, pending, calls, writes, errorMessages };
}

async function main() {
  // --- 1. RACE: đổi ngày, response cũ về sau KHÔNG được ghi đè ------------------
  {
    const h = harness();
    const first = h.fetchSettlement(); // ngày 29
    h.scope.selectedDate = '2026-09-28'; // người dùng đổi ngày
    const second = h.fetchSettlement(); // ngày 28

    ok(h.pending.length === 2, 'phải phát đủ 2 request (ngày 29 và ngày 28)');
    ok(h.pending[0].url.includes('date=2026-09-29'), 'request thứ nhất hỏi ngày 29');
    ok(h.pending[1].url.includes('date=2026-09-28'), 'request thứ hai hỏi ngày 28');

    h.pending[1].deferred.resolve(okResponse('2026-09-28')); // ngày 28 về trước
    await second;
    h.pending[0].deferred.resolve(okResponse('2026-09-29')); // ngày 29 về sau
    await first;

    const dataWrites = h.writes('setData').filter((v) => v !== null);
    ok(dataWrites.length === 1, `response cũ (ngày 29) không được ghi đè — số lần setData có dữ liệu: ${dataWrites.length}`);
    ok(
      (dataWrites[0] as any)?.reportDate === '2026-09-28',
      'số liệu đang hiển thị phải là của ngày 28, không phải ngày 29'
    );
  }

  // --- 1b. Response cũ về TRƯỚC không được tắt spinner của request mới ---------
  {
    const h = harness();
    const first = h.fetchSettlement(); // ngày 29
    h.scope.selectedDate = '2026-09-28';
    const second = h.fetchSettlement(); // ngày 28, còn đang tải

    h.pending[0].deferred.resolve(okResponse('2026-09-29')); // ngày 29 về trước
    await first;
    ok(
      !h.writes('setIsLoading').includes(false),
      'response cũ không được tắt spinner khi request mới còn đang chạy'
    );

    h.pending[1].deferred.resolve(okResponse('2026-09-28'));
    await second;
    ok(h.writes('setIsLoading').includes(false), 'request mới tự tắt spinner khi xong');
  }

  // --- 2. LỖI API KHÔNG ĐƯỢC NUỐT ---------------------------------------------
  {
    const h = harness();
    const p = h.fetchSettlement();
    h.pending[0].deferred.resolve(errorResponse(500, 'Lỗi máy chủ nội bộ'));
    await p;

    const errors = h.errorMessages();
    ok(errors.length === 1, 'lỗi 500 phải được đưa ra state lỗi chứ không nuốt im lặng');
    ok(String(errors[0]).includes('Lỗi máy chủ nội bộ'), 'phải hiện đúng `json.error` mà server trả về');
    ok(
      h.writes('setLoadError')[0] === null,
      'lỗi cũ phải được xoá khi bắt đầu request mới, không dính lại giữa hai lần tải'
    );
    ok(
      h.writes('setData').length === 1 && h.writes('setData')[0] === null,
      'lỗi phải xoá số liệu cũ — nếu giữ, màn hình hiện số ngày trước dưới nhãn ngày mới'
    );
    ok(h.writes('setIsLoading').includes(false), 'phải tắt spinner sau khi lỗi');
  }

  // --- 2b. Lỗi KHÔNG kèm `json.error` vẫn phải nói ra được --------------------
  {
    const h = harness();
    const p = h.fetchSettlement();
    h.pending[0].deferred.resolve(errorResponse(403));
    await p;
    const errors = h.errorMessages();
    ok(String(errors[0] || '').includes('403'), 'lỗi không kèm json.error vẫn phải báo mã lỗi HTTP');
  }

  // --- 2c. Mất mạng -----------------------------------------------------------
  {
    const h = harness();
    const p = h.fetchSettlement();
    h.pending[0].deferred.reject(new Error('offline'));
    await p;
    ok(h.errorMessages().length === 1, 'mất kết nối phải hiện thông báo lỗi');
    ok(h.writes('setData').includes(null), 'mất kết nối phải xoá số liệu cũ');
  }

  // --- 2d. RACE + LỖI: một lần 500 là đủ để dính bệnh "ghi nhầm ngày" -----------
  {
    const h = harness();
    const first = h.fetchSettlement(); // ngày 29
    h.scope.selectedDate = '2026-09-28';
    const second = h.fetchSettlement(); // ngày 28 lỗi
    h.pending[1].deferred.resolve(errorResponse(500, 'Lỗi máy chủ nội bộ'));
    await second;
    h.pending[0].deferred.resolve(okResponse('2026-09-29')); // ngày 29 về muộn
    await first;

    ok(
      !h.writes('setData').some((v) => v !== null),
      'số liệu ngày 29 không được hiện lại sau khi ngày 28 tải lỗi'
    );
    ok(h.errorMessages().length === 1, 'thông báo lỗi của ngày 28 phải còn nguyên');
  }

  // --- 3. BIÊN BẢN IN RA phải lấy ngày của số liệu, không lấy ngày đang chọn ---
  const printStart = src.indexOf('id="printable-settlement-report"');
  ok(printStart >= 0, 'phải còn khối biên bản in #printable-settlement-report');
  const printBlock = src.slice(printStart);
  ok(
    !/\bselectedDate\b/.test(printBlock),
    'khối biên bản in KHÔNG được dùng selectedDate — phải in data.reportDate (ngày của số liệu thật)'
  );
  ok(
    /Ngày kết toán: <strong>\{data\.reportDate\}<\/strong>/.test(src),
    '"Ngày kết toán" phải in data.reportDate, không in selectedDate'
  );
  ok(
    /BB-\{data\.reportDate\.replace\(/.test(src),
    'số biên bản phải kèm data.reportDate để mã biên bản khớp số liệu'
  );

  // --- 4. Tiêu đề trên màn hình cũng phải theo số liệu -------------------------
  ok(
    !/text-amber-300">\{selectedDate\}</.test(src),
    'tiêu đề không được in ngày đang chọn khi đã có báo cáo trong tay'
  );
  ok(
    /shownReportDate = data\?\.reportDate \|\| selectedDate/.test(src),
    'ngày hiển thị phải lấy từ data.reportDate (chỉ lúc chưa có dữ liệu mới rơi về selectedDate)'
  );

  // --- 5. Phải phân biệt "lỗi tải" với "ngày đó không có dữ liệu" --------------
  ok(/loadError \?/.test(src), 'màn hình phải rẽ nhánh riêng khi loadError có giá trị');
  ok(/Không tải được báo cáo/.test(src), 'phải có màn hình báo lỗi tải');
  ok(
    /Không có dữ liệu báo cáo cho ngày đã chọn/.test(src),
    'thông báo "không có dữ liệu" vẫn phải còn cho trường hợp thật sự trống'
  );

  console.log(`\n=== BIÊN BẢN CHỐT NGÀY — NGÀY KHỚP SỐ LIỆU: ${checks} assertions PASS ===`);
}

main().catch((err) => {
  console.error('❌ test-settlement-date-integrity:', err);
  process.exit(1);
});
