import { NextResponse } from 'next/server';

const MS_BASE = 'https://docker-myinvoice.iamsoftware.com.vn';
const MS_USER = '0312303803-999';
const MS_PASS = '12345678';

export async function GET() {
  try {
    // Step 1: Login
    const loginRes = await fetch(MS_BASE + '/api/rest/s1/iam-auth/login-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: MS_USER, password: MS_PASS }),
    });
    const loginData = await loginRes.json();
    if (loginData.isSuccess !== 'Y') {
      return NextResponse.json({ step: 'login', ok: false, data: loginData });
    }
    const key = loginData.login_key;

    // Step 2: Get tax rates
    const taxRes = await fetch(MS_BASE + '/erp/rest/s1/iam-common/invoice/tax-rate', {
      headers: { 'api_key': key },
    });
    const taxData = await taxRes.json();

    // Step 3: Get CTS list
    const ctsRes = await fetch(MS_BASE + '/api/rest/s1/iam-invoice/invoices/intrust-signed-3rd', {
      headers: { 'api_key': key },
    });
    const ctsData = await ctsRes.json();

    return NextResponse.json({
      step: 'all',
      ok: true,
      login: 'OK',
      taxRates: (taxData.listData || []).map((t: any) => t.description),
      certs: (ctsData.listData || []).map((c: any) => ({ issuedBy: c.issuedBy, requirePin: c.requirePinCode })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}
