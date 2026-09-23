import { generateVietQRPayload, crc16Ccitt } from '../src/lib/vietqr';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

async function run() {
  console.log('TEST VIETQR OFFLINE PAYLOAD');
  assert(crc16Ccitt('123456789') === '29B1', 'CRC16-CCITT vector 123456789=29B1');
  const payload = generateVietQRPayload({ bankBin: '970405', accountNo: '3180281056609', amount: 100000, content: 'THANH TOAN 123' });
  assert(payload.includes('A000000727'), 'payload co GUID VietQR');
  assert(payload.includes('970405'), 'payload co bankBin');
  assert(payload.includes('3180281056609'), 'payload co so TK');
  assert(payload.includes('5406100000'), 'field 54 = 100000');
  assert(payload.includes('5303704'), 'field 53 = VND 704');
  assert(payload.startsWith('00020101021238'), 'mo dau 00=01, 01=12');
  const body = payload.slice(0, -4);
  assert(payload.endsWith(crc16Ccitt(body)), 'CRC cuoi khop recompute');
  const p2 = generateVietQRPayload({ bankBin: '970405', accountNo: '3180281056609', amount: 50000, content: 'Thanh toan don Dep qua!!!' });
  assert(!p2.includes('!!!'), 'loai ky tu dac biet');
  const p3 = generateVietQRPayload({ bankBin: '970405', accountNo: '1', amount: 0 });
  assert(!p3.includes('54'), 'amount=0 thi bo field 54');
  const p4 = generateVietQRPayload({ bankBin: '970405', accountNo: '1', amount: 50000, content: '@@@###$$$' });
  assert(!p4.includes('62'), 'content toan ky tu dac biet thi bo field 62');
  console.log('ALL VIETQR TESTS PASSED');
}

run().catch((e) => { console.error(e); process.exit(1); });
