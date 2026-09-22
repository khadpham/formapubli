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
}
main().catch(error => { console.error(error); process.exitCode = 1; });
