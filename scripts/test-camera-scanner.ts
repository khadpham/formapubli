/** Camera decoder regression: run with npx tsx scripts/test-camera-scanner.ts. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createBarcodeDecoder, type BarcodeDecoder } from '../src/lib/barcode-decoder';

// Independently encoded EAN-13 5901234123457, including guard bars and quiet zones.
const bars = '00000000000' + [
  '101', '0001011', '0100111', '0110011', '0010011', '0111101', '0011101',
  '01010', '1100110', '1101100', '1000010', '1011100', '1001110', '1000100', '101',
].join('') + '00000000000';
const width = bars.length * 3;
const height = 100;
const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
for (let y = 10; y < 90; y++) {
  for (let x = 0; x < width; x++) {
    if (bars[Math.floor(x / 3)] === '1') pixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
}
const canvas = {
  width, height,
  getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels, width, height }) }),
} as unknown as HTMLCanvasElement;

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed++;
    console.log(`PASS ${passed}: ${name}`);
  }
  await check('software reads actual EAN-13 pixels without a native API', async () => {
    const decoder = await createBarcodeDecoder();
    assert.deepEqual(await decoder.detect(canvas), [{ rawValue: '5901234123457' }]);
    const blank = { width, height, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(pixels.length).fill(255), width, height }) }) } as unknown as HTMLCanvasElement;
    assert.deepEqual(await decoder.detect(blank), [], 'No barcode is a normal frame, not a scanner failure');
    assert.deepEqual(await decoder.detect(canvas), [{ rawValue: '5901234123457' }], 'Reader can be reused after a blank frame');
  });
  await check('software reads the same barcode rotated 90 degrees', async () => {
    const rotated = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      rotated.set(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (x * height + height - y - 1) * 4);
    }
    const sideways = { width: height, height: width, getContext: () => ({ getImageData: () => ({ data: rotated, width: height, height: width }) }) } as unknown as HTMLCanvasElement;
    assert.deepEqual(await (await createBarcodeDecoder()).detect(sideways), [{ rawValue: '5901234123457' }]);
  });
  class Native {
    static async getSupportedFormats() { return ['ean_13']; }
    constructor(options: { formats: string[] }) { assert.deepEqual(options.formats, ['ean_13']); }
    async detect(): Promise<{ rawValue: string }[]> { return [{ rawValue: '9786043687507' }]; }
  }
  await check('working native decoder retains priority and uses only supported formats', async () => {
    assert.deepEqual(await (await createBarcodeDecoder(Native)).detect(canvas), [{ rawValue: '9786043687507' }]);
  });
  for (const [name, Broken] of [
    ['format lookup rejects', class extends Native { static async getSupportedFormats(): Promise<string[]> { throw Error('formats failed'); } }],
    ['EAN-13 is unsupported', class extends Native { static async getSupportedFormats() { return ['qr_code']; } }],
    ['constructor throws', class extends Native { constructor(options: { formats: string[] }) { super(options); throw Error('constructor failed'); } }],
    ['native detect rejects', class extends Native { async detect(): Promise<{ rawValue: string }[]> { throw Error('detect failed'); } }],
    ['native detect never resolves', class extends Native { async detect(): Promise<{ rawValue: string }[]> { return new Promise(() => {}); } }],
  ] as const) {
    await check(`software decodes when ${name}`, async () => {
      assert.deepEqual(await (await createBarcodeDecoder(Broken)).detect(canvas), [{ rawValue: '5901234123457' }]);
    });
  }
  await check('native silent failure eventually uses software', async () => {
    class Empty extends Native { async detect() { return []; } }
    const decoder = await createBarcodeDecoder(Empty);
    let found = false;
    for (let i = 0; i < 20; i++) {
      if ((await decoder.detect(canvas))[0]?.rawValue === '5901234123457') { found = true; break; }
    }
    assert.ok(found, 'An exposed but nonfunctional native API must not scan forever');
  });
  await check('healthy native decoder stays preferred after idle camera frames', async () => {
    const blank = { width, height, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(pixels.length).fill(255), width, height }) }) } as unknown as HTMLCanvasElement;
    class IdleThenWorking extends Native {
      async detect(input?: HTMLCanvasElement) { return input === blank ? [] : super.detect(); }
    }
    const decoder = await createBarcodeDecoder(IdleThenWorking);
    for (let i = 0; i < 25; i++) assert.deepEqual(await decoder.detect(blank), []);
    assert.deepEqual(await decoder.detect(canvas), [{ rawValue: '9786043687507' }], 'Empty frames do not prove a healthy native decoder is broken');
  });
  // Execute the actual component effect. Only hardware, timers and React setters
  // are substituted; the production decode path must deliver the ISBN callback.
  const path = 'src/components/scanner/InAppBarcodeScanner.tsx';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect = '';
  const cameraFunctions: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ['startCamera', 'stopCamera'].includes(node.name.getText(source))) {
      cameraFunctions.push(`const ${node.getText(source)};`);
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') {
      const callback = node.arguments[0] as ts.ArrowFunction;
      if (callback.body.getText(source).includes('startCamera()')) effect = callback.body.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect, 'Find the real camera scanning effect');
  const script = ts.transpileModule(`function runEffect() ${effect}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  function mount(factory = createBarcodeDecoder) {
    let tick: (() => Promise<void>) | undefined;
    const codes: string[] = [];
    const statuses: string[] = [];
    const errors: Array<string | null> = [];
    const scope = {
    createBarcodeDecoder: factory,
    window: {}, isOpen: true, startCamera() {}, stopCamera() {},
    didPostPermissionRescanRef: { current: false }, lockedCodeRef: { current: null },
    framesWithoutBarcodeRef: { current: 0 }, lastScannedTimeRef: { current: 0 },
    zoomLevelRef: { current: 1 },
    videoRef: { current: { readyState: 4, videoWidth: width, videoHeight: height } },
    canvasRef: { current: canvas },
    setScannerStatus: (status: string) => statuses.push(status),
    setScannerError: (error: string | null) => errors.push(error),
    handleBarcodeFound: (code: string) => codes.push(code),
    setTimeout(fn: () => Promise<void>) { tick = fn; return 1; },
    clearTimeout() { tick = undefined; }, console: { warn() {} },
    };
    vm.createContext(scope);
    const close = vm.runInContext(script + '\nrunEffect();', scope) as () => void;
    return { close, codes, statuses, errors, hasTimer: () => Boolean(tick),
      async next() { const current = tick; tick = undefined; await current?.(); },
    };
  }
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  await check('quick close releases a camera stream that arrives after permission resolves', async () => {
    let finish!: (stream: unknown) => void;
    let stopped = false;
    const track = { stop() { stopped = true; }, getCapabilities() { return {}; } };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const scope = {
      navigator: { userAgent: 'iPhone', mediaDevices: { getUserMedia: () => new Promise(resolve => { finish = resolve; }) } },
      window: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } },
      enumerateAndSelectBestCamera: async () => 'back-camera',
      cameraRequestRef: { current: 0 }, streamRef: { current: null }, videoRef: { current: null },
      didPostPermissionRescanRef: { current: false }, availableCameras: [{ label: 'Back Camera' }],
      zoomLevelRef: { current: 1 },
      setErrorMessage() {}, setHasPermission() {}, setHasTorch() {}, setHasOpticalZoom() {}, setSelectedCameraId() {}, console,
    };
    const js = ts.transpileModule(cameraFunctions.join('\n') + '\n({startCamera, stopCamera});', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.createContext(scope);
    const camera = vm.runInContext(js, scope) as { startCamera(): Promise<void>; stopCamera(): void };
    const opening = camera.startCamera();
    await flush();
    camera.stopCamera();
    finish(stream);
    await opening;
    assert.equal(stopped, true, 'Do not leave the camera active after dismissing its modal');
    assert.equal(scope.streamRef.current, null);
  });
  await check('camera effect delivers decoded pixels to the existing scan handler', async () => {
    const scanner = mount();
    await flush();
    assert.equal(scanner.codes[0], '5901234123457', 'A camera frame must decode even when BarcodeDetector is absent');
    assert.equal(scanner.statuses.at(-1), 'ready');
    scanner.close();
    assert.equal(scanner.hasTimer(), false);
  });
  await check('closing during decoder startup prevents late scanning', async () => {
    let finish!: (decoder: BarcodeDecoder) => void;
    const decoder = await createBarcodeDecoder();
    const scanner = mount(() => new Promise(resolve => { finish = resolve; }));
    scanner.close();
    finish(decoder);
    await flush();
    assert.equal(scanner.codes.length, 0);
    assert.equal(scanner.hasTimer(), false);
    assert.deepEqual(scanner.statuses, ['loading']);
  });
  await check('pending decode does not overlap or deliver results after close', async () => {
    let finish!: (codes: Array<{ rawValue: string }>) => void;
    const scanner = mount(async () => ({ detect: () => new Promise(resolve => { finish = resolve; }) }));
    await flush();
    assert.equal(scanner.hasTimer(), false, 'Only schedule next frame after decode completes');
    scanner.close();
    finish([{ rawValue: '5901234123457' }]);
    await flush();
    assert.equal(scanner.codes.length, 0);
    assert.equal(scanner.hasTimer(), false);
  });
  for (const [name, factory] of [
    ['decoder download fails', async () => { throw Error('chunk failed'); }],
    ['frame reading fails', async () => ({ detect: async () => { throw Error('canvas failed'); } })],
  ] as const) {
    await check(`scanner reports error and stops when ${name}`, async () => {
      const scanner = mount(factory);
      await flush();
      assert.equal(scanner.statuses.at(-1), 'error');
      assert.ok(scanner.errors.at(-1));
      assert.equal(scanner.hasTimer(), false);
      scanner.close();
    });
  }
  console.log(`Camera scanner: ${passed}/${passed} checks passed (real decoder pixels, simulated camera).`);

  // ==========================================================================
  // ÂM BÁO SCANNER — kiểm CẤU TRÚC, không phải chứng minh hành vi.
  //
  // PHẢI NÓI RÕ: không thể unit-test Web Audio mà không có trình duyệt thật.
  // Vì vậy phần này chỉ canh ĐÚNG NHỮNG GÌ đã hỏng lần trước, chứ không phải
  // chứng minh "bíp sẽ nghe thấy". Chứng minh cái đó cần điện thoại thật ở hội
  // chợ — người dùng tự nghiệm thu phần đó.
  //
  // Lỗi gốc đã sửa: `new AudioContext()` được gọi LẠT mỗi lần bíp. Trên mobile
  // điều đó làm context rơi vào "suspended" và mất tiếng sau vài lần quét, nên
  // thu ngân nghe tiếng bé. Tăng `gain` không sửa được cái này.
  // ==========================================================================
  // Dùng lại hằng `path` đã có sẵn ở đầu file (trỏ đúng file này) — không import
  // `node:path` vì tên `path` đã bị biến cục bộ này che mất.
  const src = readFileSync(path, 'utf8');
  const realNewContexts = (src.split('new AudioContextClass()') as string[]).length - 1;  await check('sound: AudioContext được LƯU VÀO REF (tạo 1 lần, dùng lại — không tạo mới mỗi lần bíp)', async () => {
    // Đếm số chỗ tạo KHÔNG đủ: bản cũ cũng chỉ có đúng 1 chỗ `new AudioContextClass()`,
    // chỉ là nó nằm thẳng trong `playBeepSound` nên chạy mỗi lần bíp. Bất biến thật là
    // context phải được GHI VÀO REF rồi tái dùng — nếu không có dòng gán ref này
    // thì chắc chắn là tạo mới mỗi lần và bản này sẽ vỡ.
    assert.equal(realNewContexts, 1, `phải có đúng 1 chỗ tạo, thực tế ${realNewContexts}`);
    assert.match(
      src,
      /audioCtxRef\.current\s*=\s*new AudioContextClass\(\)/,
      'phải ghi context vào ref để tái sử dụng giữa các lần bíp'
    );
    assert.match(
      src,
      /if \(!audioCtxRef\.current \|\| audioCtxRef\.current\.state === 'closed'\)/,
      'phải kiểm ref đã có chưa trước khi tạo mới'
    );
  });
  await check('sound: context được resume trong user gesture (pointerdown/touchstart)', async () => {
    assert.match(src, /addEventListener\('pointerdown', unlock/);
    assert.match(src, /addEventListener\('touchstart', unlock/);
    assert.match(src, /state === 'suspended'[\s\S]{0,120}resume\(\)/);
  });
  await check('sound: quét tần số có CẢ thân (thấp) lẫn độ rõ (cao) — loa điện thoại không phát được 2.8kHz thuần', async () => {
    // Loa điện thoại 12–15mm gần như không tái tạo được >2–3 kHz ⇒ tiếng thuần
    // 2.8kHz nghe MỎNG dù đúng tần số. Phải quét từ dải thấp lên dải cao.
    const calls = Array.from(src.matchAll(/chirp\(ctx, t(?:\s*\+\s*[\d.]+)?,\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g));
    assert.ok(calls.length >= 1, `phải có ít nhất 1 nhịp bíp, thực tế ${calls.length}`);
    for (const c of calls) {
      const from = Number(c[1]);
      const to = Number(c[2]);
      const dur = Number(c[3]);
      assert.ok(from < 1500, `đầu tiếng phải ở dải thấp (loa phát được), thực tế ${from}Hz`);
      assert.ok(to >= 2500, `cuối tiếng phải ở dải cao để xuyên tiếng ồn, thực tế ${to}Hz`);
      assert.ok(to > from, 'tần số phải TĂNG dần trong tiếng bíp');
      assert.ok(dur >= 0.2, `tiếng phải đủ dài (>=200ms) để nghe rõ, thực tế ${dur * 1000}ms`);
    }
  });
  await check('sound: MỘT tiếng bíp = MỘT cuốn (không phải 2 tiếng, dễ nhầm là quét 2 cuốn)', async () => {
    // Yêu cầu của thu ngân: một tiếng kêu = một cuốn đã quét. Hai nhịp dễ bị hiểu
    // là quét hai cuốn. Không được thêm nhịp thứ hai.
    const beepBody = src.slice(src.indexOf('const playBeepSound'));
    const calls = Array.from(beepBody.matchAll(/chirp\(ctx, t(?:\s*\+\s*[\d.]+)?,/g));
    assert.strictEqual(calls.length, 1, `phải ĐÚNG 1 nhịp bíp, thực tế ${calls.length}`);
  });

  // --------------------------------------------------------------------------
  // HAI CHỖ TEST TRƯỚC ĐÃ XANH GIẢ (review 30/09 chứng minh bằng mutation):
  //   M2: biến `unlock` thành no-op → test vẫn xanh, vì test chỉ grep CHỮ
  //       `addEventListener('pointerdown', unlock`, không kiểm `unlock` có thật sự
  //       gọi `ensureAudio` không.
  //   M3: xoá `gain.connect(ctx.destination)` → bíp KHÔNG RA ÂM THANH nào mà test
  //       vẫn xanh, vì không test nào chạm tới việc tín hiệu được nối vào loa.
  // Nên ở đây ta KHÔNG grep — ta THỰC SỰ chạy hàm với AudioContext giả và kiểm
  // lệnh phát ra. Lấy từ chính file component, không viết lại logic ở đây.
  await check('sound (chạy thật với AudioContext giả): tín hiệu ĐI TỚI LOA', async () => {
    // Cắt riêng định nghĩa ensureAudio + chirp + playBeepSound ra khỏi component.
    const take = (name: string) => {
      const start = src.indexOf(`const ${name} =`);
      assert.ok(start > 0, `không tìm thấy ${name} trong component`);
      let depth = 0, i = src.indexOf('{', start), began = false;
      for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; began = true; }
        else if (src[i] === '}') { depth--; if (began && depth === 0) { i++; break; } }
      }
      return src.slice(start, i);
    };
    const code = [take('ensureAudio'), take('chirp'), take('playBeepSound')].join('\n');

    let created = 0;
    const connectedTo: unknown[] = [];
    // Node có `param.gain` là một AudioParam; node tạo ra phải CÓ `.gain` vì code
    // gọi `gain.gain.setValueAtTime(...)`. Fake thiếu `.gain` sẽ ném TypeError rồi
    // bị `catch {}` của playBeepSound nuốt mất — nhìn giống như "bíp không nối
    // vào loa". Đã dính lỗi này một lần khi viết test.
    class FakeParam {
      setValueAtTime(_v: unknown, _t: unknown) { return this; }
      exponentialRampToValueAtTime(_v: unknown, _t: unknown) { return this; }
    }
    const connectNode = (dest: unknown) => { connectedTo.push(dest); return dest; };
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = { name: 'speakers' };
      constructor() { created++; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
      createOscillator() { return { frequency: new FakeParam(), connect: connectNode, start() {}, stop() {} }; }
      createGain() { return { gain: new FakeParam(), connect: connectNode }; }
    }
    const audioCtxRef = { current: null as unknown };
    const windowStub = { AudioContext: FakeAudioContext };
    const scope: any = { window: windowStub, audioCtxRef, console };
    vm.createContext(scope);
    // Phải TRẢ VỀ object chứ không chỉ gán `const`: trong `vm`, `const X = ...` ở
    // tầng script tạo binding từ vựng, KHÔNG thành thuộc tính của context ⇒
    // gọi `playBeepSound()` từ bên ngoài sẽ không thấy.
    const api = vm.runInContext(
      ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText +
        '\n({ ensureAudio, playBeepSound });',
      scope
    ) as { ensureAudio: () => unknown; playBeepSound: () => void };

    // 5 lần bíp liên tiếp (thu ngân quét nhanh)
    for (let i = 0; i < 5; i++) api.playBeepSound();

    assert.equal(created, 1, `5 lần bíp phải dùng CHUNG 1 AudioContext, thực tế tạo ${created}`);
    assert.ok(
      connectedTo.some((d) => d && (d as any).name === 'speakers'),
      `bíp KHÔNG được nối vào loa (destination) — sẽ không phát ra âm thanh nào (n=${connectedTo.length})`
    );
    assert.ok(connectedTo.length >= 2, `mỗi nhịp bíp phải nối oscillator+gain vào đích, thực tế ${connectedTo.length}`);
  });

  await check('sound: hàm unlock của user gesture THỰC SỰ gọi ensureAudio (không phải hàm rỗng)', async () => {
    // Chặt hơn hẳn cách grep trước: lấy nguyên khối useEffect mở khoá, chạy nó
    // với window giả, rồi kích listener đã đăng ký và xem context có được tạo.
    const start = src.indexOf('const unlock =');
    assert.ok(start > 0, 'không tìm thấy hàm unlock');
    const end = src.indexOf('}, []);', start);
    assert.ok(end > start, 'không tìm thấy phần cleanup của effect mở khoá');
    const effectBody = src.slice(start, end);
    assert.match(effectBody, /ensureAudio\(\)/,
      'hàm unlock PHẢI gọi ensureAudio — nếu rỗng thì iOS không bao giờ cho phát tiếng');

    // Listener phải bắt ở WINDOW, không bắt ở modal: modal chưa tồn tại lúc
    // người dùng bấm nút "Quét mã" nên bắt ở modal thì gesture không chạy (lỗi iOS).
    const effStart = src.indexOf('useEffect(() => {', src.indexOf('MỞ KHOÁ ÂM THANH'));
    const effEnd = src.indexOf('}, []);', effStart);
    const eff = src.slice(effStart, effEnd);
    assert.match(eff, /window\.addEventListener\('pointerdown', unlock\)/,
      'phải bắt pointerdown ở WINDOW (bắt ở modal thì gesture mở scanner không chạy)');
    assert.match(eff, /window\.addEventListener\('touchstart', unlock\)/,
      'phải bắt touchstart ở WINDOW');
    assert.doesNotMatch(eff, /modalRef\.current/,
      'KHÔNG được bắt listener ở modal — modal chưa có lúc bấm nút mở scanner');
  });

  await check('sound: rung được bọc try/catch (lỗi rung không được chặn việc thêm sách)', async () => {
    // Nhắm vào LỆNH GỌI THẬT (`?.(`), không phải chữ "navigator.vibrate" trong
    // comment — lần trước check này dính vào comment nên báo đỏ giả.
    const callIdx = src.indexOf('navigator.vibrate?.(');
    assert.ok(callIdx > 0, 'không tìm thấy lệnh gọi navigator.vibrate thật');
    const before = src.slice(Math.max(0, callIdx - 260), callIdx);
    assert.match(before, /try\s*\{[\s\S]*$/,
      'lệnh rung phải nằm trong try — nếu ném lỗi thì onScan() không chạy, sách đã khoá mà không vào giỏ');
    const after = src.slice(callIdx, callIdx + 260);
    assert.match(after, /\}?\s*catch\s*\{/,
      'phải có catch sau lệnh rung — nuốt lỗi, không để kênh phụ chặn luồng quét');
  });
  await check('sound: âm lượng sát trần (>=0.9) nhưng không méo', async () => {
    const m = src.match(/exponentialRampToValueAtTime\(0\.(\d+), at \+ 0\.00/);
    assert.ok(m, 'phải tìm thấy đỉnh gain');
    assert.ok(Number(m![1]) >= 90, `gain đỉnh phải >= 0.9, thực tế 0.${m![1]}`);
  });
  await check('sound: rung nhiều nhịp (điện thoại thường cầm tay, không nhìn màn hình)', async () => {
    const vib = src.match(/navigator\.vibrate\?\.\(\[([\d,\s]+)\]\)/);
    assert.ok(vib, 'phải rung khi nhận barcode');
    const parts = vib![1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
    assert.ok(parts.length >= 5, `rung phải nhiều nhịp để phân biệt, thực tế ${parts.length} nhịp`);
  });
  console.log(`Scanner sound (cấu trúc): ${passed}/? checks — cần điện thoại thật để chứng minh hành vi.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
