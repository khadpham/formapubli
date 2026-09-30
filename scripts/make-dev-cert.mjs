/**
 * Sinh chứng chỉ tự ký cho dev server HTTPS.
 *
 * VÌ SAO CẦN HTTPS KHI DEV: trình duyệt CHỈ cấp quyền camera (`getUserMedia`) ở
 * "secure context" — tức `https://`, hoặc `http://localhost`. Khi mở dev server
 * bằng IP LAN (http://192.168.x.x) để điện thoại truy cập thì KHÔNG phải secure
 * context ⇒ camera không bật được ⇒ không test được máy quét mã.
 *
 * VÌ SAO PHẢI CÓ SAN CHỨA IP LAN: nếu cert chỉ có `localhost`, trình duyệt điện
 * thoại cảnh báo tên miền không khớp nghiêm hơn, và một số trình duyệt từ chối
 * quyền camera khi chứng thư ký "lạ". Đưa cả IP vào Subject Alternative Name.
 *
 * ⚠ IP MÁY ĐỔI THEO DHCP — nếu điện thoại không mở được, chạy lại script này để
 *   sinh lại cert cho đúng IP hiện tại.
 *
 * CHẠY: npm run cert:make
 * KHÔNG commit thư mục `certificates/` (đã nằm trong .gitignore) — chứa private key.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

function lanIp() {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object -First 1 -ExpandProperty IPAddress'],
      { encoding: 'utf8' }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function opensslPath() {
  for (const c of ['openssl', 'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe', 'C:\\Users\\PC\\miniconda3\\Library\\bin\\openssl.exe']) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch { /* thử tiếp */ }
  }
  return null;
}

const ip = lanIp();
const ossl = opensslPath();
if (!ossl) {
  console.error('❌ Không tìm thấy openssl. Cài một trong hai:\n' +
    '   winget install ShiningLight.OpenSSL.Light\n' +
  '   hoặc dùng mkcert: mkcert -install && mkcert -key-file certificates/localhost-key.pem -cert-file certificates/localhost.pem localhost 127.0.0.1 ' + ip);
  process.exit(1);
}

mkdirSync('certificates', { recursive: true });

// openssl của conda/miniconda không tự tìm thấy openssl.cnf → chỉ định tường minh.
const cnf = 'certificates/.openssl.cnf';
writeFileSync(cnf, 'openssl_conf = default_conf\n[ default_conf ]\nssl_conf = ssl_sect\n[ ssl_sect ]\nsystem_default = system_default_sect\n[ system_default_sect ]\nOptions = UnsafeLegacyRenegotiation\n', 'ascii');
process.env.OPENSSL_CONF = cnf;

const san = ['DNS:localhost', 'IP:127.0.0.1', ip ? `IP:${ip}` : null].filter(Boolean).join(',');
console.log(`Sinh cert với SAN: ${san}`);

try {
  execFileSync(ossl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', 'certificates/localhost-key.pem',
    '-out', 'certificates/localhost.pem',
    '-days', '365',
    '-subj', '/CN=formapubli-dev',
    '-addext', `subjectAltName=${san}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
} catch (e) {
  console.error('❌ Sinh cert thất bại.');
  process.exit(1);
}

if (!existsSync('certificates/localhost.pem')) { console.error('❌ Không có file cert.'); process.exit(1); }

const show = execFileSync(ossl, ['x509', '-in', 'certificates/localhost.pem', '-noout', '-subject', '-ext', 'subjectAltName'], { encoding: 'utf8' });
console.log(show.trim());
console.log('\n✅ Xong. Chạy: npm run dev:https');
console.log('   Trên điện thoại mở https://' + (ip || '<IP-LAN>') + ':3000');
console.log('   Trình duyệt sẽ BÁO CHỨNG THƯ KHÔNG ĐÁNG TIN — phải chọn "Nâng cao" → "Vẫn truy cập".');
