import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { db, bankStatements, bankStatementMatches, orders } from '@/db';
import { eq, desc } from 'drizzle-orm';
import { extractOrderCode } from '@/services/bank-reconciliation.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/bank-statements - Liet ke dong sao ke kem trang thai:
 * MATCHED (confidence HIGH) / REVIEW (MEDIUM, LOW, hoac co ma ma chua match)
 * / UNPROCESSED (con lai). Loc ?status=REVIEW|MATCHED|UNPROCESSED|ALL.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const statusFilter = `${searchParams.get('status') || 'ALL'}`.toUpperCase();
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    const statements = await db
      .select()
      .from(bankStatements)
      .orderBy(desc(bankStatements.ngayGiaoDich), desc(bankStatements.createdAt))
      .limit(limit)
      .offset(offset);
    const matches = await db.select().from(bankStatementMatches);
    const matchBySt = new Map(matches.map((m) => [m.statementId, m]));
    const orderIds = [...new Set(matches.map((m) => m.orderId))];
    const orderMap = new Map<string, { orderCode: string; finalAmount: number }>();
    if (orderIds.length) {
      const ords = await db.select({ id: orders.id, orderCode: orders.orderCode, finalAmount: orders.finalAmount }).from(orders);
      for (const o of ords) if (orderIds.includes(o.id)) orderMap.set(o.id, { orderCode: o.orderCode, finalAmount: Number(o.finalAmount || 0) });
    }

    const items = statements.map((s) => {
      const m = matchBySt.get(s.id);
      const suggestedCode = extractOrderCode(s.noiDung || '');
      const status = m && m.confidence === 'HIGH' ? 'MATCHED' : m || suggestedCode ? 'REVIEW' : 'UNPROCESSED';
      return {
        id: s.id,
        ngayGiaoDich: s.ngayGiaoDich,
        phatSinhNo: Number(s.phatSinhNo || 0),
        phatSinhCo: Number(s.phatSinhCo || 0),
        donVi: s.donVi,
        noiDung: s.noiDung,
        butToan: s.butToan,
        status,
        suggestedCode,
        match: m
          ? {
              confidence: m.confidence,
              matchType: m.matchType,
              note: m.note,
              orderCode: orderMap.get(m.orderId)?.orderCode || null,
              orderAmount: orderMap.get(m.orderId)?.finalAmount ?? null,
            }
          : null,
      };
    });

    const filtered = statusFilter === 'ALL' ? items : items.filter((i) => i.status === statusFilter);
    const counts = {
      MATCHED: items.filter((i) => i.status === 'MATCHED').length,
      REVIEW: items.filter((i) => i.status === 'REVIEW').length,
      UNPROCESSED: items.filter((i) => i.status === 'UNPROCESSED').length,
    };
    return NextResponse.json({ success: true, data: { items: filtered, counts } });
  } catch (e) {
    return handleApiError(e);
  }
}
