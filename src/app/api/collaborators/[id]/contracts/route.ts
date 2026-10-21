/**
 * GET /api/collaborators/[id]/contracts - Tổng hợp hợp đồng của một cộng tác viên.
 * Trả về: số lượng hợp đồng, tổng giá trị, chia theo loại, danh sách từng hợp đồng.
 * Chỉ OWNER/MANAGER được xem (đồng bộ với quyền API collaborators).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, collaborators, contractDocuments, contractTemplates } from '@/db';
import { eq, desc } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  THIET_KE_BIA: 'Thiết kế bìa',
  BIEN_DICH: 'Biên dịch',
  BIEN_TAP: 'Biên tập',
  DAN_TRANG: 'Dàn trang',
  DOC_MORAT: 'Đọc morat',
  TAC_QUYEN: 'Tác quyền',
  DAI_LY: 'Đại lý',
  IN_AN: 'In ấn',
  DICH_THUAT: 'Dịch thuật',
  BB_NGHIEM_THU: 'Biên bản nghiệm thu',
  PHIEU_CHI: 'Phiếu chi',
  UY_NHIEM_CHI: 'Ủy nhiệm chi',
  KHAC: 'Khác',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  FINALIZED: 'Đã chốt',
  SIGNED: 'Đã ký',
  CANCELLED: 'Đã hủy',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { id } = await params;
    const [ctv] = await db.select().from(collaborators).where(eq(collaborators.id, id)).limit(1);
    if (!ctv) {
      return NextResponse.json({ success: false, message: 'Không tìm thấy cộng tác viên.' }, { status: 404 });
    }
    const rows = await db
      .select({
        id: contractDocuments.id,
        contractNumber: contractDocuments.contractNumber,
        title: contractDocuments.title,
        category: contractTemplates.category,
        totalAmount: contractDocuments.totalAmount,
        signedDate: contractDocuments.signedDate,
        status: contractDocuments.status,
      })
      .from(contractDocuments)
      .leftJoin(contractTemplates, eq(contractDocuments.templateId, contractTemplates.id))
      .where(eq(contractDocuments.collaboratorId, id))
      .orderBy(desc(contractDocuments.signedDate));
    const totalAmount = rows.reduce((s, r) => s + (r.totalAmount || 0), 0);
    const byCat = new Map<string, { count: number; amount: number }>();
    for (const r of rows) {
      const cat = r.category || 'KHAC';
      const e = byCat.get(cat) || { count: 0, amount: 0 };
      e.count += 1;
      e.amount += r.totalAmount || 0;
      byCat.set(cat, e);
    }
    return NextResponse.json({
      success: true,
      data: {
        collaborator: {
          id: ctv.id,
          fullName: ctv.fullName,
          penName: ctv.penName,
          collabType: ctv.collabType,
          roleTitle: ctv.roleTitle,
        },
        stats: {
          contractCount: rows.length,
          totalAmount,
          byCategory: [...byCat.entries()].map(([category, v]) => ({
            category,
            label: CATEGORY_LABELS[category] || category,
            ...v,
          })),
        },
        contracts: rows.map((r) => ({
          ...r,
          categoryLabel: CATEGORY_LABELS[r.category || 'KHAC'] || r.category,
          statusLabel: STATUS_LABELS[r.status] || r.status,
        })),
      },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
