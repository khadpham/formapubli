import { NextRequest, NextResponse } from 'next/server';
import { AIOrderParserService } from '@/services/ai-order-parser.service';
import { db } from '@/db';
import { editions, works } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  try {
    // P1b: Default-Deny — giữ nguyên WAREHOUSE trong allowlist phục vụ 5.1, chỉ khóa fallback.
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE']);
    const body = await req.json();
    const { text, source, forceFallback } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng cung cấp nội dung text để bóc tách đơn hàng.' },
        { status: 400 }
      );
    }

    // Tải danh mục ấn bản sách để cung cấp context cho AI và Rule-based
    const bookList = await db
      .select({
        editionId: editions.id,
        code: works.code,
        title: works.title,
        author: works.author,
      })
      .from(editions)
      .leftJoin(works, eq(editions.workId, works.id));

    const catalog = bookList.map((b) => ({
      editionId: b.editionId,
      code: b.code || '',
      title: b.title || '',
      author: b.author,
    }));

    const result = await AIOrderParserService.parseOrder({
      text,
      source: source || 'PASTE',
      catalog,
      forceFallback: Boolean(forceFallback),
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

