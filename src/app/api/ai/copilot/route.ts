import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole, checkWindowRateLimit, AuthError, extractClientIp, getSessionFromRequest } from '@/lib/auth-session';
import { recordAuditLog } from '@/lib/rbac-guard';
import { CopilotGuardrails } from '@/services/ai/copilot-guardrails';
import { callGeminiJsonRaw, callOpenAIJsonRaw, resolveGeminiModel } from '@/services/ai/llm-client';

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  let sessionPayload: any = null;

  try {
    // 1. Kiểm tra xác thực và ma trận phân quyền: Chỉ ROLE_OWNER & ROLE_MANAGER
    sessionPayload = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
  } catch (authErr: any) {
    // Nếu có session nhưng không đủ thẩm quyền (vd: ROLE_CASHIER, ROLE_TAX)
    const rawSession = await getSessionFromRequest(req);
    await recordAuditLog({
      action: 'COPILOT_UNAUTHORIZED_ATTEMPT',
      actorRole: rawSession?.role || 'UNKNOWN_ROLE',
      actorId: rawSession?.actorId || 'unknown-actor',
      resource: 'api/ai/copilot',
      details: `Từ chối truy cập Copilot: ${authErr?.message || 'Unauthorized'}`,
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

  // 3. Đọc dữ liệu câu hỏi từ request body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, code: 'INVALID_INPUT', message: 'Body request phải là JSON hợp lệ.' },
      { status: 400 }
    );
  }

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return NextResponse.json(
      { success: false, code: 'INVALID_INPUT', message: 'Vui lòng cung cấp nội dung câu hỏi (`question`).' },
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
      sessionPayload
    );

    // 7. Tổng hợp câu trả lời từ kết quả Tool
    let synthesizedAnswer = '';
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (geminiKey || openaiKey) {
      const synthPrompt = `Bạn là Trợ lý Điều hành Executive Copilot của Formapubli.
Lãnh đạo vừa hỏi: "${question}"
Hệ thống đã tra cứu dữ liệu thực tế từ công cụ [${toolCall.toolName}]:
${JSON.stringify(toolResult, null, 2)}

HÃY TRẢ LỜI NGẮN GỌN, CHÍNH XÁC, DẠNG MARKDOWN CHO BAN GIÁM ĐỐC:
- Mọi con số PHẢI lấy chính xác từ dữ liệu trên, không tự tính toán thêm.
- Nếu là két tiền, TUYỆT ĐỐI không suy diễn thành gian lận hay buộc tội.
- Trình bày dạng danh sách/bảng nếu có nhiều mục.`;

      try {
        if (geminiKey) {
          synthesizedAnswer = await callGeminiJsonRaw({
            systemPrompt: synthPrompt,
            userText: 'Hãy tổng hợp kết quả.',
            apiKey: geminiKey,
            timeoutMs: 5000,
          });
        } else if (openaiKey) {
          synthesizedAnswer = await callOpenAIJsonRaw({
            systemPrompt: synthPrompt,
            userText: 'Hãy tổng hợp kết quả.',
            apiKey: openaiKey,
            timeoutMs: 5000,
          });
        }
      } catch (synthErr) {
        console.warn('⚠️ Lỗi tổng hợp LLM, dùng formatter nội bộ:', synthErr);
      }
    }

    // Fallback format tin nhắn nếu không có LLM hoặc LLM lỗi
    if (!synthesizedAnswer) {
      synthesizedAnswer = formatFallbackAnswer(toolCall.toolName, toolResult);
    }

    const finalAnswer = CopilotGuardrails.postProcessAnswer(synthesizedAnswer, toolCall.toolName);

    return NextResponse.json({
      success: true,
      data: {
        answer: finalAnswer,
        action: 'CALL_TOOL',
        toolUsed: toolCall.toolName,
        toolData: toolResult,
      },
    });
  } catch (err: any) {
    console.error('❌ Lỗi xử lý Copilot:', err);
    return NextResponse.json(
      { success: false, code: 'INTERNAL_ERROR', message: `Lỗi xử lý Copilot: ${err?.message || err}` },
      { status: 500 }
    );
  }
}

function formatFallbackAnswer(toolName: string, data: any): string {
  if (toolName === 'query_stock_level') {
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
  return JSON.stringify(data, null, 2);
}
