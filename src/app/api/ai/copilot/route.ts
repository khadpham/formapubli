import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole, checkWindowRateLimit, AuthError, extractClientIp, getSessionFromRequest, type SessionPayload } from '@/lib/auth-session';
import { checkDbWindowLimit } from '@/lib/login-attempts-db';
import { recordAuditLog } from '@/lib/rbac-guard';
import { CopilotGuardrails } from '@/services/ai/copilot-guardrails';
import { callGeminiJsonRaw, callOpenAIJsonRaw, resolveGeminiModel } from '@/services/ai/llm-client';

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  let sessionPayload: SessionPayload;

  try {
    // 1. Kiểm tra xác thực và ma trận phân quyền: Chỉ ROLE_OWNER & ROLE_MANAGER
    sessionPayload = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
  } catch (authErr: unknown) {
    // Nếu có session nhưng không đủ thẩm quyền (vd: ROLE_CASHIER, ROLE_TAX)
    const rawSession = await getSessionFromRequest(req);
    await recordAuditLog({
      action: 'COPILOT_UNAUTHORIZED_ATTEMPT',
      actorRole: rawSession?.role || 'UNKNOWN_ROLE',
      actorId: rawSession?.actorId || 'unknown-actor',
      resource: 'api/ai/copilot',
      details: `Từ chối truy cập Copilot: ${authErr instanceof Error ? authErr.message : "Unauthorized"}`,
      ipAddress: ip,
    });

    if (authErr instanceof AuthError) {
      return NextResponse.json(
        { success: false, code: authErr.status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN', message: authErr.message },
        { status: authErr.status }
      );
    }
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', message: 'Bạn không có quyền truy cập Executive Copilot.' },
      { status: 403 }
    );
  }

  // 2. Sliding Window Rate Limiting: 15 req / phút / staffId
  // Tầng memory (nhanh) + tầng DB bền vững (sống qua restart isolate) — chặn
  // nếu MỘT trong hai từ chối.
  const rateKey = `copilot:${sessionPayload.actorId}`;
  const rateResult = checkWindowRateLimit(rateKey, 15, 60 * 1000);
  if (!rateResult.allowed) {
    const waitSec = Math.ceil(rateResult.resetAfterMs / 1000);
    return NextResponse.json(
      {
        success: false,
        code: 'RATE_LIMITED',
        message: `Bạn đã vượt quá giới hạn 15 câu hỏi/phút. Vui lòng thử lại sau ${waitSec} giây.`,
        resetAfterMs: rateResult.resetAfterMs,
      },
      { status: 429 }
    );
  }
  const dbRate = await checkDbWindowLimit(rateKey, 15, 60 * 1000);
  if (!dbRate.allowed) {
    const waitSec = Math.ceil(dbRate.resetAfterMs / 1000);
    return NextResponse.json(
      {
        success: false,
        code: 'RATE_LIMITED',
        message: `Bạn đã vượt quá giới hạn 15 câu hỏi/phút. Vui lòng thử lại sau ${waitSec} giây.`,
        resetAfterMs: dbRate.resetAfterMs,
      },
      { status: 429 }
    );
  }

  // 3. Đọc dữ liệu câu hỏi từ request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, code: 'INVALID_INPUT', message: 'Body request phải là JSON hợp lệ.' },
      { status: 400 }
    );
  }

  const rawQuestion = (body as { question?: unknown })?.question;
  const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : '';
  if (!question) {
    return NextResponse.json(
      { success: false, code: 'INVALID_INPUT', message: 'Vui lòng cung cấp nội dung câu hỏi (`question`).' },
      { status: 400 }
    );
  }
  // Chan DoS CPU/LLM: cau hoi toi da 1000 ky tu (du cho cau phuc tap, chan dump KB).
  if (question.length > 1000) {
    return NextResponse.json(
      { success: false, code: 'INVALID_INPUT', message: 'Câu hỏi tối đa 1000 ký tự — tách thành nhiều câu ngắn.' },
      { status: 400 }
    );
  }

  // 4. Ghi vết kiểm toán phiên hỏi đáp
  await recordAuditLog({
    action: 'COPILOT_QUERY',
    actorRole: sessionPayload.role,
    actorId: sessionPayload.actorId,
    resource: 'api/ai/copilot',
    details: question.slice(0, 500),
    ipAddress: ip,
  });

  // 5. Phân tích kế hoạch gọi Tool
  try {
    const plan = await CopilotGuardrails.planQuery(question);

    if (plan.action === 'REFUSE_OUT_OF_SCOPE' || plan.action === 'DIRECT_ANSWER') {
      const finalMsg = CopilotGuardrails.postProcessAnswer(plan.directAnswer || 'Không có phản hồi.');
      return NextResponse.json({
        success: true,
        data: {
          answer: finalMsg,
          action: plan.action,
          toolUsed: null,
          toolData: null,
        },
      });
    }

    // 6. Thực thi Tool
    const toolCall = plan.toolCall!;
    const toolResult = await CopilotGuardrails.executeToolSafely(
      toolCall.toolName,
      toolCall.args || {},
      { staffId: sessionPayload.actorId, role: sessionPayload.role }
    );

    // 7. Tổng hợp câu trả lời từ kết quả Tool
    let synthesizedAnswer = '';
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (geminiKey || openaiKey) {
      // Cau hoi nam o userText (khong noi suy truc tiep vao system) de giam
      // prompt-injection vao ngu canh tong hop; system chi chua du lieu tool.
      const synthPrompt = `Bạn là Trợ lý Điều hành Executive Copilot của Formapubli.
Hệ thống đã tra cứu dữ liệu thực tế từ công cụ [${toolCall.toolName}]:
${JSON.stringify(toolResult, null, 2)}

HÃY TRẢ LỜI NGẮN GỌN, CHÍNH XÁC, DẠNG MARKDOWN CHO BAN GIÁM ĐỐC:
- Mọi con số PHẢI lấy chính xác từ dữ liệu trên, không tự tính toán thêm.
- Nếu là két tiền, TUYỆT ĐỐI không suy diễn thành gian lận hay buộc tội.
- Trình bày dạng danh sách/bảng nếu có nhiều mục.
- NEU DU LIEU CHI CO 1 DAU SACH (itemsCount=1): chi tra loi ve dung cuon do, lay so
  availableStock va warehouseBreakdown. Neu itemsCount=0: bao khong tim thay, TUYET DOI
  khong tu che so ton kho.
- CHI TRA VE duy nhat 1 object JSON: {"response": "<markdown tieng Viet tu nhien>"}.`;

      try {
        let raw = '';
        if (geminiKey) {
          raw = await callGeminiJsonRaw({
            systemPrompt: synthPrompt,
            userText: `Câu hỏi của lãnh đạo: "${question.slice(0, 500)}"\n\nHãy tổng hợp kết quả.`,
            apiKey: geminiKey,
            timeoutMs: 5000,
          });
        } else if (openaiKey) {
          raw = await callOpenAIJsonRaw({
            systemPrompt: synthPrompt,
            userText: `Câu hỏi của lãnh đạo: "${question.slice(0, 500)}"\n\nHãy tổng hợp kết quả.`,
            apiKey: openaiKey,
            timeoutMs: 5000,
          });
        }
        synthesizedAnswer = extractNaturalAnswer(raw);
      } catch (synthErr) {
        console.warn('⚠️ Lỗi tổng hợp LLM, dùng formatter nội bộ:', synthErr);
      }
    }

    // Fallback format tin nhắn nếu không có LLM hoặc LLM lỗi
    if (!synthesizedAnswer) {
      synthesizedAnswer = formatFallbackAnswer(toolCall.toolName, toolResult);
    }

    const finalAnswer0 = CopilotGuardrails.postProcessAnswer(synthesizedAnswer, toolCall.toolName);

    // Ep grounded: moi so co nghia trong cau tra loi PHAI co trong toolData.
    // Neu LLM bia so (vd bao het hang trong khi ton > 0) → dung formatter noi bo.
    // zeroClaim chi ban khi cau "het hang" KHONG kem con so nao (dau hieu bia);
    // cau dung kieu "0 cuon o Au Co, con 10 o Quynh Mai" co so nen duoc giu.
    // Rieng hoi 1 cuon: cau tra loi co so ma thieu dung tong ton that → fallback
    // (bat duoc ca ao giac so nho "con 5" vs that "con 8").
    let finalAnswer = finalAnswer0;
    try {
      const orphans = CopilotGuardrails.findUngroundedNumbers(finalAnswer, toolResult);
      const hasAnyNumber = /\d/.test(finalAnswer);
      const claimsZeroStock =
        toolCall.toolName === 'query_stock_level' &&
        Number(toolResult?.totalAvailable || 0) > 0 &&
        !hasAnyNumber &&
        /(hết hàng|het hang|không còn|khong con)\b/i.test(finalAnswer);
      let wrongSingleTotal = false;
      if (toolCall.toolName === 'query_stock_level' && Number(toolResult?.itemsCount) === 1) {
        const trueTotal = Number(toolResult.items[0]?.availableStock);
        const deGrouped = finalAnswer.replace(/(\d)[.,](?=\d{3}\b)/g, '$1');
        const nums = (deGrouped.match(/\d+/g) || []).map(Number);
        if (nums.length > 0 && !nums.includes(trueTotal)) wrongSingleTotal = true;
      }
      if (orphans.length > 0 || claimsZeroStock || wrongSingleTotal) {
        console.warn(`Copilot ungrounded [${toolCall.toolName}]: orphans=${orphans.join(',')} zeroClaim=${claimsZeroStock} wrongTotal=${wrongSingleTotal} — dung fallback.`);
        finalAnswer = formatFallbackAnswer(toolCall.toolName, toolResult);
      }
    } catch (err) {
      console.warn('[copilot] grounded check failed:', err);
    }

    return NextResponse.json({
      success: true,
      data: {
        answer: finalAnswer,
        action: 'CALL_TOOL',
        toolUsed: toolCall.toolName,
        toolData: toolResult,
      },
    });
  } catch (err: unknown) {
    console.error('❌ Lỗi xử lý Copilot:', err);
    return NextResponse.json(
      { success: false, code: "INTERNAL_ERROR", message: `Lỗi xử lý Copilot: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

function extractNaturalAnswer(raw: string): string {
  let text = (raw || '').trim();
  if (!text) return '';
  // LLM doi khi boc fence ```json ... ``` — lot vo truoc khi parse.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!text) return '';
  // LLM o che do JSON thuong tra {"response": "..."} — boc lay markdown tu nhien.
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const candidates = ['response', 'answer', 'text', 'content', 'message', 'result'];
      for (const key of candidates) {
        const v = parsed[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      // Truong hop model boc { "tool": ..., "data": ... } — khong hien JSON tho.
      return '';
    } catch {
      return text;
    }
  }
  return text;
}

function formatFallbackAnswer(toolName: string, data: Record<string, any>): string {
  if (toolName === 'query_stock_level') {
    if (data.warning && (!data.items || data.items.length === 0)) {
      return `📦 **Tra cứu tồn kho**: ${data.warning}`;
    }
    if (data.itemsCount === 1 && data.items?.length === 1) {
      const it = data.items[0];
      const lines = Object.entries(it.warehouseBreakdown || {}).map(([w, q]) => `- ${w}: **${Number(q).toLocaleString('vi-VN')}** cuốn`);
      return `📦 **${it.code}${it.title ? ' - ' + it.title : ''} còn ${Number(it.availableStock).toLocaleString('vi-VN')} cuốn khả dụng** (${data.warehouseScope}):\n${lines.join('\n')}`;
    }
    return `📦 **Báo cáo Tồn kho Khả dụng**:
- Phạm vi: ${data.warehouseScope}
- Tổng số cuốn khả dụng: **${data.totalAvailable}** cuốn (${data.itemsCount} ấn bản).`;
  }
  if (toolName === 'query_sales_summary') {
    return `📊 **Báo cáo Doanh số (${data.windowDays} ngày qua)**:
- Tổng doanh thu: **${data.totalRevenue?.toLocaleString('vi-VN')} đ** (${data.totalOrders} đơn).
- Sổ Thuế (VAT): **${data.officialTax?.revenue?.toLocaleString('vi-VN')} đ** (${data.officialTax?.ordersCount} đơn).
- Sổ Quản trị Thực tế: **${data.internalManagement?.revenue?.toLocaleString('vi-VN')} đ** (${data.internalManagement?.ordersCount} đơn).`;
  }
  if (toolName === 'query_reprint_forecast') {
    return `⚠️ **Cảnh báo Cạn kho & Đề xuất In 105 ngày**:
- Cảnh báo Đỏ (≤30 ngày): **${data.summary?.RED_ALERT ?? 0}** đầu sách.
- Cảnh báo Vàng (≤45 ngày): **${data.summary?.YELLOW_WARNING ?? 0}** đầu sách.
- Bình thường: **${data.summary?.HEALTHY_NORMAL ?? 0}** đầu sách.`;
  }
  if (toolName === 'query_catalog') {
    if (data.warning && (!data.items || data.items.length === 0) && (!data.authors || data.authors.length === 0)) {
      return `📚 **Tra cứu danh mục**: ${data.warning}`;
    }
    if (data.mode === 'top-authors' && data.authors?.length) {
      const lines = data.authors.slice(0, 20).map((a: { author?: string; titlesCount?: number; soldQty?: number }, i: number) =>
        `${i + 1}. **${a.author}** — ${a.titlesCount} đầu sách, đã bán ${Number(a.soldQty).toLocaleString('vi-VN')} cuốn`);
      return `📚 **Top tác giả được yêu thích (${data.query})** — tổng ${data.total} tác giả:\n${lines.join('\n')}`;
    }
    const lines = (data.items || []).slice(0, 20).map((it: { code?: string; title?: string; author?: string; coverPrice?: number; availableStock?: number }, i: number) => {
      const stock = Number(it.availableStock || 0);
      return `${i + 1}. **${it.code} - ${it.title}** (${it.author || 'chưa rõ tác giả'}) — giá bìa ${Number(it.coverPrice || 0).toLocaleString('vi-VN')} đ — ${stock > 0 ? 'Còn hàng' : 'Hết hàng'}: ${stock.toLocaleString('vi-VN')} cuốn`;
    });
    const head = data.mode === 'author' ? `📚 **Sách của tác giả ${data.query}**`
      : data.mode === 'title-prefix' ? `📚 **Tác phẩm bắt đầu bằng ${data.query}**`
      : data.mode === 'top-editions' ? `📚 **Sách bán chạy (${data.query})**`
      : `📚 **Danh mục (${data.query})**`;
    return `${head} — tổng ${data.total} đầu sách:\n${lines.join('\n')}`;
  }
  if (toolName === 'query_cashbox_reconciliation') {
    const active = data.activeSession;
    if (!active) {
      return `💵 **Đối soát Két tiền Ca Quầy**: Hiện không có ca làm việc nào đang mở.`;
    }
    return `💵 **Đối soát Két tiền Ca Quầy**:
- Thu ngân ca: **${active.cashierId}** (Kho: ${active.warehouseId}).
- Tiền đầu ca: **${active.openingCash?.toLocaleString('vi-VN')} đ**.
- Tiền mặt thu bán: **${active.totalCashSales?.toLocaleString('vi-VN')} đ** (${active.totalOrdersCount} đơn).`;
  }
  if (toolName === 'prepare_sale_draft') {
    if (!data.items || data.items.length === 0) {
      return `🧾 **Lên đơn nháp**: ${(data.warnings || []).join(' ')}`;
    }
    const lines = data.items.map((it: { code?: string; title?: string; author?: string; coverPrice?: number; quantity?: number; availableStock?: number }, i: number) =>
      `${i + 1}. **${it.code} - ${it.title}** × ${it.quantity} (giá bìa ${Number(it.coverPrice || 0).toLocaleString('vi-VN')} đ, tồn ${Number(it.availableStock || 0).toLocaleString('vi-VN')})`);
    const warn = (data.warnings || []).length > 0 ? `\n⚠️ ${(data.warnings || []).join(' ')}` : '';
    const who = data.customerName ? ` cho **${data.customerName}**` : '';
    return `🧾 **Đơn nháp${who}** (${data.items.length} dòng) — mới là NHÁP, chưa tạo đơn, chưa trừ kho:\n${lines.join('\n')}${warn}\n\nBấm **Áp vào POS** để đổ vào giỏ, kiểm tra lại rồi tự bấm Thanh toán.`;
  }
  return JSON.stringify(data, null, 2);
}
