type Barcode = { rawValue: string };
export type BarcodeDecoder = { detect(canvas: HTMLCanvasElement): Promise<Barcode[]> };
type NativeDetector = {
  new (options: { formats: string[] }): BarcodeDecoder;
  getSupportedFormats(): Promise<string[]>;
};

// Experimental native implementations can hang as well as reject.
async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Barcode detector timed out')), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createSoftwareDecoder(): Promise<BarcodeDecoder> {
  // Loaded from our app bundle, without a CDN, WASM download or camera ownership.
  const zxing = await import('@zxing/library');
  const reader = new zxing.MultiFormatReader();
  const hints = new Map<import('@zxing/library').DecodeHintType, unknown>([
    [zxing.DecodeHintType.POSSIBLE_FORMATS, [
      zxing.BarcodeFormat.EAN_13, zxing.BarcodeFormat.EAN_8,
      zxing.BarcodeFormat.CODE_128, zxing.BarcodeFormat.QR_CODE,
    ]],
    [zxing.DecodeHintType.TRY_HARDER, true],
  ]);
  reader.setHints(hints);
  return {
    async detect(canvas) {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Không đọc được hình ảnh từ camera.');
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      const gray = new Uint8ClampedArray(width * height);
      for (let i = 0; i < gray.length; i++) {
        const offset = i * 4;
        gray[i] = data[offset + 3] === 0 ? 255 : (data[offset] + 2 * data[offset + 1] + data[offset + 2]) / 4;
      }
      // RGBLuminanceSource cannot rotate: retry once at 90 degrees for a sideways book.
      let luminance = gray;
      for (let orientation = 0; orientation < 2; orientation++) {
        const source = new zxing.RGBLuminanceSource(luminance, orientation ? height : width, orientation ? width : height);
        try {
          const result = reader.decodeWithState(new zxing.BinaryBitmap(new zxing.HybridBinarizer(source)));
          return [{ rawValue: result.getText() }];
        } catch (error) {
          if (!(error instanceof zxing.NotFoundException || error instanceof zxing.ChecksumException || error instanceof zxing.FormatException)) throw error;
        } finally {
          reader.reset();
        }
        if (orientation === 0) {
          luminance = new Uint8ClampedArray(gray.length);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) luminance[x * height + height - y - 1] = gray[y * width + x];
          }
        }
      }
      return [];
    },
  };
}

export async function createBarcodeDecoder(
  Native = (globalThis as typeof globalThis & { BarcodeDetector?: NativeDetector }).BarcodeDetector,
): Promise<BarcodeDecoder> {
  let native: BarcodeDecoder | undefined;
  try {
    if (Native) {
      const supported = await withTimeout(Native.getSupportedFormats());
      const formats = ['ean_13', 'ean_8', 'code_128', 'qr_code'].filter(format => supported.includes(format));
      if (formats.includes('ean_13')) native = new Native({ formats });
    }
  } catch {
    // Missing formats, failed construction or experimental API: use software.
  }
  if (!native) return createSoftwareDecoder();

  let misses = 0;
  let software: BarcodeDecoder | undefined;
  return {
    async detect(canvas) {
      if (native) {
        try {
          const codes = await withTimeout(native.detect(canvas));
          misses = codes.length ? 0 : misses + 1;
          // Some WebKit builds expose the API but silently return no results.
          if (misses < 12) return codes;
          misses = 0;
        } catch {
          // A failed native decoder must not leave a working camera scanning forever.
          native = undefined;
        }
      }
      software ??= await createSoftwareDecoder();
      const codes = await software.detect(canvas);
      // Empty frames are normal while aiming. Replace native only after a real recovery.
      if (codes.length) native = undefined;
      return codes;
    },
  };
}
