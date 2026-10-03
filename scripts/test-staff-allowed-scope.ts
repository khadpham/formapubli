/** Pham vi kho POS theo tai khoan: route/schema/session phai biet truong moi.
 * Ten cot doc TU migration that (khong hardcode chung voi code). */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mig = fs.readFileSync('src/db/migrations/0037_staff_allowed_warehouses.sql', 'utf8');
const colMatch = mig.match(/ADD COLUMN `(\w+)`/);
assert.ok(colMatch, 'migration 0037 phai co ADD COLUMN');
const col = colMatch[1]; // allowed_warehouse_ids — tu file that

const schema = fs.readFileSync('src/db/schema.ts', 'utf8');
const staffRoute = fs.readFileSync('src/app/api/staff/[staffId]/route.ts', 'utf8');
const session = fs.readFileSync('src/lib/auth-session.ts', 'utf8');
const login = fs.readFileSync('src/app/api/auth/login/route.ts', 'utf8');
const me = fs.readFileSync('src/app/api/auth/me/route.ts', 'utf8');
const cashbox = fs.readFileSync('src/app/api/cashbox/route.ts', 'utf8');

let n = 0;
const ok = (c: boolean, m: string) => { n++; assert.ok(c, m); };

ok(schema.includes(col), 'schema.ts phai co cot tu migration');
ok(staffRoute.includes('body.allowedWarehouseIds'), 'staff PATCH phai nhan allowedWarehouseIds');
ok(staffRoute.includes('JSON.stringify'), 'staff PATCH phai luu JSON');
ok(staffRoute.includes('Kho không tồn tại hoặc đã ngưng'), 'staff PATCH phai validate kho la');
ok(session.includes('allowedWarehouseIds'), 'session type phai co truong moi');
ok(session.includes('parseAllowedWarehouseIds'), 'session phai co ham parse');
ok(login.includes('allowedWarehouseIds'), 'login phai tra truong moi');
ok(me.includes('allowedWarehouseIds'), 'me phai tra truong moi');
ok(cashbox.includes('allowedWarehouseIds'), 'cashbox OPEN phai kiem list');
ok(cashbox.includes('danh sách được phép'), 'cashbox phai bao tieng Viet ro rang');

console.log(`PASS scope kho theo tai khoan (${n} checks)`);
