import { NextRequest, NextResponse } from 'next/server';
import { parseVoiceOrder, STT_MAX_AUDIO_BYTES, VoiceConfigError } from '@/services/ai/voice-order.service';
import { db } from '@/db';
import { editions, works } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { recordAuditLog } from '@/lib/rbac-guard';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * 5.1 — SMART VOICE POS DISPATCHER (route).
 * POST /api/ai/parse-voice-order — multipart {audio} hoặc JSON {text}.
 * Trả về GIỎ NHÁP cho thu ngân xác nhận. KHÔNG tạo đơn, KHÔNG trừ kho.
 * RBAC: OWNER/MANAGER/CASHIER (giọng thu ngân). P1b default-deny.
 */
export async function POST(req: NextRequest) {
  try {
    // P1b: Default-Deny — bắt buộc session cookie hợp lệ.
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);

    let audio: Blob | undefined;
    let filename: string | undefined;
    let text: string | undefined;

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('audio');
      if (file instanceof Blob && file.size > 0) {
        if (file.size > STT_MAX_AUDIO_BYTES) {
          return NextResponse.json(
            { success: false, code: 'INVALID_INPUT', message: `File audio vượt giới hạn ${STT_MAX_AUDIO_BYTES / 1048576}MB.` },
            { status: 413 }
          );
        }
        audio = file;
        filename = typeof (file as File).name === 'string' ? (file as File).name : 'pos-voice.webm';
      }
      const textField = form.get('text');
      if (typeof textField === 'string' && textField.trim()) text = textField.trim();
    } else {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.text === 'string' && body.text.trim()) text = body.text.trim();
    }

    if ((!audio || audio.size === 0) && !text) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: 'Gửi file audio (multipart field "audio") hoặc text dự phòng (field "text").' },
        { status: 400 }
      );
    }

    // Danh mục ấn bản cho cross-check chống bịa SKU.
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

    let draft;
    try {
      draft = await parseVoiceOrder({ audio, filename, text, catalog });
    } catch (err: unknown) {
      if (err instanceof VoiceConfigError) {
        // STT không khả dụng nhưng có text dự phòng -> parse text-only.
        if (text) {
          draft = await parseVoiceOrder({ text, catalog });
        } else {
          return NextResponse.json({ success: false, code: 'STT_UNAVAILABLE', message: err.message }, { status: 503 });
        }
      } else {
        throw err;
      }
    }

    await recordAuditLog({
      action: 'VOICE_ORDER_PARSED',
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/ai/parse-voice-order',
      details: `Giọng nói -> giỏ nháp: ${draft!.items.length} dòng qua ${draft!.transcriptSource}/${draft!.engineUsed}`.slice(0, 500),
    });

    return NextResponse.json({ success: true, data: draft });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
