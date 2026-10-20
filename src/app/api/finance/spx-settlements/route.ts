import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { db, spxSettlements, spxSettlementMatches, orders } from '@/db';
import { eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/spx-settlements - Liet ke van don kem trang thai:
 * CLEAN (COD + phi khop, khong dieu chinh) / REVIEW (co lech/dieu chinh)
 * / UNPROCESSED (chua thay don). Loc ?status=.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const statusFilter = `${searchParams.get('status') || 'ALL'}`.toUpperCase();
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    const settlements = await db
      .select()
      .from(spxSettlements)
      .orderBy(desc(spxSettlements.ngayImport), desc(spxSettlements.createdAt))
      .limit(limit)
      .offset(offset);
    const matches = await db.select().from(spxSettlementMatches);
    const matchBySt = new Map(matches.map((m) => [m.settlementId, m]));
    const orderIds = [...new Set(matches.map((m) => m.orderId))];
    const orderMap = new Map<string, { orderCode: string; codAmount: number; shippingFee: number }>();
    if (orderIds.length) {
      const ords = await db.select({ id: orders.id, orderCode: orders.orderCode, codAmount: orders.codAmount, shippingFee: orders.shippingFee }).from(orders);
      for (const o of ords) {
        if (orderIds.includes(o.id)) {
          orderMap.set(o.id, { orderCode: o.orderCode, codAmount: Number(o.codAmount || 0), shippingFee: Number(o.shippingFee || 0) });
        }
      }
    }

    const items = settlements.map((s) => {
      const m = matchBySt.get(s.id);
      const coDieuChinh = Math.abs(Number(s.soTienDieuChinh || 0)) > 0;
      const status = !m ? 'UNPROCESSED' : m.codKhop && !m.phiBatThuong && !coDieuChinh ? 'CLEAN' : 'REVIEW';
      const o = m ? orderMap.get(m.orderId) : undefined;
      return {
        id: s.id,
        maVanDon: s.maVanDon,
        trangThai: s.trangThai,
        tienThuHo: Number(s.tienThuHo || 0),
        tongPhi: Number(s.tongPhi || 0),
        soTienDieuChinh: Number(s.soTienDieuChinh || 0),
        lyDoDieuChinh: s.lyDoDieuChinh,
        tongTienVe: Number(s.tongTienVe || 0),
        status,
        match: m
          ? { codKhop: Boolean(m.codKhop), phiBatThuong: Boolean(m.phiBatThuong), matchType: m.matchType, note: m.note, orderCode: o?.orderCode || null, orderCod: o?.codAmount ?? null, orderFee: o?.shippingFee ?? null }
          : null,
      };
    });

    const filtered = statusFilter === 'ALL' ? items : items.filter((i) => i.status === statusFilter);
    const counts = {
      CLEAN: items.filter((i) => i.status === 'CLEAN').length,
      REVIEW: items.filter((i) => i.status === 'REVIEW').length,
      UNPROCESSED: items.filter((i) => i.status === 'UNPROCESSED').length,
    };
    return NextResponse.json({ success: true, data: { items: filtered, counts } });
  } catch (e) {
    return handleApiError(e);
  }
}
