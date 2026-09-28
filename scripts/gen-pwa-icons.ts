/**
 * Sinh PNG icon cho PWA từ SVG thiết kế sẵn có.
 *
 * VÌ SAO CẦN: iOS KHÔNG nhận SVG cho `apple-touch-icon` (bỏ qua im lặng → sau
 * khi Add to Home Screen, icon là ảnh chụp màn hình hoặc trống). Manifest cũng
 * chỉ có SVG nên Chrome/Windows không có PNG 192/512 chuẩn.
 *
 * Chạy 1 lần rồi commit PNG: `npx tsx scripts/gen-pwa-icons.ts`
 * Output được commit nên script này không nằm trên đường chạy của app.
 *
 * `sharp` là optional dependency của `next` nên đã có sẵn trong node_modules —
 * cố ý KHÔNG thêm dependency mới chỉ để rasterize một file.
 *
 * Script tự assert kích thước đầu ra: rủi ro lớn nhất ở đây là sinh ra file
 * sai kích thước mà không ai biết, vì iOS không báo lỗi.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const ICON_DIR = join(ROOT, 'public', 'icons');
const SOURCE_SVG = join(ICON_DIR, 'icon-192.svg');

/** 180 = apple-touch-icon chuẩn của iOS. 192/512 = ngưỡng cài đặt của Chrome. */
const TARGETS: Array<{ file: string; size: number }> = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

async function main() {
  assert.ok(existsSync(SOURCE_SVG), `Thiếu SVG nguồn: ${SOURCE_SVG}`);

  // Im lặng khi sharp vắng mặt: Next 14 khai báo sharp là optionalDependencies
  // nên bản `next build --no-lint` / cài `--omit=optional` sẽ không có nó.
  let sharp: any;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error(
      'Không tìm thấy `sharp`. Chạy `npm install` đầy đủ (không --omit=optional) rồi chạy lại.'
    );
    process.exit(1);
  }

  const svg = readFileSync(SOURCE_SVG);
  const written: string[] = [];

  for (const { file, size } of TARGETS) {
    const out = join(ICON_DIR, file);
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'fill' })
      .png({ compressionLevel: 9 })
      .toFile(out);

    // Đọc lại header PNG (byte 16-23 = width, height big-endian) để chắc chắn
    // file trên đĩa đúng kích thước — không tin lời sharp.
    const png = readFileSync(out);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${file} không phải PNG hợp lệ.`);
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    assert.equal(w, size, `${file} rộng ${w}, cần ${size}.`);
    assert.equal(h, size, `${file} cao ${h}, cần ${size}.`);
    assert.ok(png.length > 1000, `${file} quá nhỏ (${png.length} byte) — có thể render hỏng.`);

    written.push(`  ok  ${file} ${w}x${h} — ${(png.length / 1024).toFixed(1)} KB`);
  }

  console.log('Đã sinh icon PNG từ public/icons/icon-192.svg:');
  for (const line of written) console.log(line);
  console.log('\nTiếp theo: trỏ manifest.json + layout.tsx vào các file này.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
