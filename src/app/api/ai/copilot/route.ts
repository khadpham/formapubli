import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole, checkWindowRateLimit, AuthError, extractClientIp, getSessionFromRequest, type SessionPayload } from '@/lib/auth-session';
import { checkDbWindowLimit } from '@/lib/login-attempts-db';
import { recordAuditLog } from '@/lib/rbac-guard';
import { CopilotGuardrails, renderHistoryForPrompt, sanitizeHistory } from '@/services/ai/copilot-guardrails';
import { callGeminiWithFallback, callCfWorkerAiJsonRaw, callGroqChatJsonRaw, callOpenAIJsonRaw, resolveOpenAIModel } from '@/services/ai/llm-client';

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
  // Model do user chọn ở drawer (Tự động / 3.8 / 3.5-lite / nội bộ). Ngoài
  // allowlist thì bỏ qua (về mặc định env) — không tin input thô.
  const rawModel = (body as { model?: unknown })?.model;
  // Lịch sử hội thoại để nhớ ngữ cảnh ("giờ vàng của nó là mấy giờ?"). Chỉ giữ
  // N lượt gần nhất, cắt độ dài, bỏ mọi role ngoài user/assistant.
  const history = sanitizeHistory((body as { history?: unknown })?.history);
  const MODEL_ALLOWLIST = [
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'groq/gpt-oss-120b',
    'groq/gpt-oss-20b',
    'cf/nemotron-3-120b-a12b',
    'cf/gpt-oss-120b',
    'cf/glm-4.7-flash',
    'local',
  ];
  const modelOverride =
    typeof rawModel === 'string' && (MODEL_ALLOWLIST as string[]).includes(rawModel.trim())
      ? rawModel.trim()
      : undefined;
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

  // 4. Ghi vết kiểm toán phiên hỏi đáp — KHÔNG log nguyên văn câu hỏi
  // (có thể chứa tên/SĐT/khách hàng = PII). Chỉ lưu độ dài để debug quota.
  await recordAuditLog({
    action: 'COPILOT_QUERY',
    actorRole: sessionPayload.role,
    actorId: sessionPayload.actorId,
    resource: 'api/ai/copilot',
    details: `q_len=${question.length}`,
    ipAddress: ip,
  });

  // 5. Phân tích kế hoạch gọi Tool
  try {
    const track: { planner?: string } = {};
    const plan = await CopilotGuardrails.planQuery(question, track, modelOverride, history);

    if (plan.action === 'REFUSE_OUT_OF_SCOPE' || plan.action === 'DIRECT_ANSWER') {
      // Câu hỏi ngoài dữ liệu (chuyện đời, câu đùa) vẫn phải có người trả lời tự
      // nhiên — trả "Không có phản hồi." là lỗi lớn nhất về phong cách.
      const emptyAnswer =
        `Câu này tôi chưa có dữ liệu để trả lời chính xác, và tôi cũng không muốn bịa số cho sếp. ` +
        `Tôi giỏi tồn kho, doanh số, két tiền, danh mục và nhịp bán — sếp hỏi một trong số đó là có số liệu ngay.`;
      const finalMsg = CopilotGuardrails.postProcessAnswer((plan.directAnswer || '').trim() || emptyAnswer);
      return NextResponse.json({
        success: true,
        data: {
          answer: finalMsg,
          action: plan.action,
          toolUsed: null,
          toolData: null,
          engine: track.planner || 'nội bộ',
        },
      });
    }

    // 6. Thực thi Tool (1 bước, hoặc nhiều bước với CALL_MANY).
    //    Mỗi bước đi qua executeToolSafely (RBAC + kiểm toán + guard riêng).
    const steps =
      plan.action === 'CALL_MANY' && Array.isArray(plan.steps) && plan.steps.length > 0
        ? plan.steps.slice(0, 4)
        : [{ toolName: plan.toolCall!.toolName, args: plan.toolCall?.args || {} }];
    const results: Array<{ toolName: string; toolData: any }> = [];
    for (const step of steps) {
      const toolData = await CopilotGuardrails.executeToolSafely(
        step.toolName,
        step.args || {},
        { staffId: sessionPayload.actorId, role: sessionPayload.role }
      );
      results.push({ toolName: step.toolName, toolData });
    }
    const multi = results.length > 1;
    const toolCall = { toolName: multi ? results.map((r) => r.toolName).join(' + ') : results[0].toolName };
    const toolResult = multi
      ? Object.fromEntries(results.map((r) => [r.toolName, r.toolData]))
      : results[0].toolData;

    // 7. Tổng hợp câu trả lời từ kết quả Tool — chuỗi dự phòng:
    // Gemini (model chọn/env) → Groq 120B → Groq 20B → OpenAI → formatter nội bộ.
    // Engine báo đúng model đã viết câu trả lời.
    let synthesizedAnswer = '';
    let synthEngine: string | null = null;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const groqModels = (process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b,openai/gpt-oss-20b')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    const cfReady = !!(process.env.WORKERS_AI_TOKEN && process.env.CF_ACCOUNT_ID);

    if (geminiKey || openaiKey || groqKey || cfReady) {
      // Cau hoi nam o userText (khong noi suy truc tiep vao system) de giam
      // prompt-injection vao ngu canh tong hop; system chi chua du lieu tool.
      // Chế độ lời dặn (REFLECTIVE_ADVICE): sếp xin lời dặn dò/bàn giao — viết
      // như người đi trước tận tâm, mỗi lời dặn gắn số thật từ dữ liệu.
      const adviceMode = (plan.reason || '').includes('REFLECTIVE_ADVICE');
      const synthPrompt = `Bạn là Trợ lý Điều hành Executive Copilot của Formapubli.
Hôm nay (giờ Việt Nam): ${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)}.
${renderHistoryForPrompt(history)}
Hệ thống đã tra cứu dữ liệu thực tế từ ${multi ? 'NHIỀU công cụ (mỗi công cụ là 1 ý của câu hỏi)' : 'công cụ'} [${toolCall.toolName}]:
${JSON.stringify(toolResult, null, 2)}

CÂU HỎI CỦA SẾP: "${question.slice(0, 500)}"

${
  adviceMode
    ? `SẾP ĐANG XIN LỜI DẶN DÒ / BÀN GIAO CHO THẾ HỆ SAU — KHÔNG phải báo cáo khô.
HÃY VIẾT NHƯ MỘT NGƯỜI ĐI TRƯỚC TẬN TÂM:
- Mở đầu 1 câu đồng cảm, ngắn.
- Dặn 3–5 điều CỤ THỂ, mỗi điều GẮN CON SỐ THẬT từ dữ liệu trên (tồn tổng bao nhiêu cuốn, bao nhiêu ấn bản, mấy đầu sách cạn kho cần tái bản...).
- Giọng ấm, chân thành, không giáo điều, KHÔNG nhắc máy móc "theo công cụ...".
- Tuyệt đối không bịa số ngoài dữ liệu; thiếu số nào thì bỏ qua điều đó.`
    : `HÃY TRẢ LỜI NHƯ MỘT NGƯỜI TRỢ LÝ ĐIỀU HÀNH THẬT:
- Tự nhiên, gọn, đi thẳng vào ý chính sếp hỏi. KHÔNG giáo điều, KHÔNG nhắc máy móc "theo công cụ...".
- Mọi con số PHẢI lấy chính xác từ dữ liệu trên; không tự tính thêm ngoài dữ liệu.
- Câu hỏi nhiều ý thì trình bày từng ý rõ ràng; thiếu số liệu cho 1 ý thì nói thẳng là thiếu.
- Sếp có thể hỏi tiếp bằng đại từ ("nó", "cuốn đó", "kho đó") — hiểu là nói tiếp lượt trước, đừng hỏi lại.
- Nếu là két tiền, TUYỆT ĐỐI không suy diễn thành gian lận hay buộc tội.
- Trình bày danh sách/bảng khi có nhiều mục.
- Nếu dữ liệu 1 đầu sách (itemsCount=1) chỉ trả đúng cuốn đó; itemsCount=0 báo không tìm thấy, TUYỆT ĐỐI không tự chế tồn kho.`
}
- CHI TRA VE duy nhat 1 object JSON: {"response": "<markdown tieng Viet tu nhien>"}.`;

      try {
        let raw = '';
        const userText = adviceMode
          ? `Sếp xin lời dặn dò cho thế hệ sau: "${question.slice(0, 500)}"\n\nDựa vào số liệu thật vừa tra, viết lời dặn chân thành, mỗi điều gắn số cụ thể.`
          : multi
            ? `Câu hỏi của lãnh đạo (nhiều ý): "${question.slice(0, 500)}"\n\nTổng hợp từ các công cụ tương ứng, trình bày từng ý rõ ràng, ngôn ngữ tự nhiên.`
            : `Câu hỏi của lãnh đạo: "${question.slice(0, 500)}"\n\nHãy tổng hợp kết quả.`;
        // Model user ép chọn (picker) đi trước; 'local' thì bỏ qua hết LLM.
        // 'cf/...' = Cloudflare Workers AI (model free).
        const picked = modelOverride && modelOverride !== 'local' ? modelOverride : null;
        if (picked && picked.startsWith('cf/')) {
          const cfModel = picked.slice(3); // 'cf/gpt-oss-120b' -> 'gpt-oss-120b'
          try {
            raw = await callCfWorkerAiJsonRaw({
              systemPrompt: synthPrompt,
              userText,
              model: cfModel,
              timeoutMs: 25000,
            });
            synthEngine = 'cf:' + cfModel;
          } catch (cfPickedErr) {
            // KHÔNG throw cứng: model sếp chọn chết thì vẫn trả lời được bằng
            // tầng dưới, thay vì rơi thẳng vào formatter in JSON thô.
            console.warn('⚠️ Workers AI (model sếp chọn) lỗi:', (cfPickedErr as any)?.message || cfPickedErr);
          }
        } else if (picked && picked.startsWith('groq/') && groqKey) {
          raw = await callGroqChatJsonRaw({
            systemPrompt: synthPrompt,
            userText,
            apiKey: groqKey,
            model: picked,
            timeoutMs: 8000,
          });
          synthEngine = 'groq:' + picked;
        } else {
          if (geminiKey && (!picked || picked.startsWith('gemini'))) {
            try {
              raw = await callGeminiWithFallback({
                systemPrompt: synthPrompt,
                userText,
                apiKey: geminiKey,
                timeoutMs: 5000,
                model: picked && picked.startsWith('gemini') ? picked : undefined,
                onModel: (m) => {
                  synthEngine = 'gemini:' + m;
                },
              });
            } catch (gemErr) {
              console.warn('⚠️ Gemini nghẽn, thử Groq:', (gemErr as any)?.message || gemErr);
            }
          }
          if (!raw && groqKey && (!picked || !picked.startsWith('groq'))) {
            for (const gm of groqModels) {
              try {
                raw = await callGroqChatJsonRaw({
                  systemPrompt: synthPrompt,
                  userText,
                  apiKey: groqKey,
                  model: gm,
                  timeoutMs: 8000,
                });
                synthEngine = 'groq:' + gm;
                break;
              } catch (groqErr) {
                console.warn(`⚠️ Groq ${gm} lỗi, thử tiếp:`, (groqErr as any)?.message || groqErr);
              }
            }
          }
          if (!raw && openaiKey) {
            try {
              raw = await callOpenAIJsonRaw({
                systemPrompt: synthPrompt,
                userText,
                apiKey: openaiKey,
                timeoutMs: 5000,
              });
              synthEngine = 'openai:' + resolveOpenAIModel();
            } catch (openaiErr) {
              console.warn('⚠️ OpenAI lỗi:', (openaiErr as any)?.message || openaiErr);
            }
          }
          // Tầng cuối cùng trước formatter: Cloudflare Workers AI free
          // (GLM-4.7-flash đã đo thật: JSON chuẩn, tiếng Việt tốt).
          if (!raw) {
            try {
              raw = await callCfWorkerAiJsonRaw({
                systemPrompt: synthPrompt,
                userText,
                timeoutMs: 25000,
                onModel: (m) => {
                  synthEngine = 'cf:' + m.replace(/^@cf\//, '');
                },
              });
            } catch (cfErr) {
              console.warn('⚠️ Workers AI lỗi, dùng formatter nội bộ:', (cfErr as any)?.message || cfErr);
            }
          }
        }
        synthesizedAnswer = extractNaturalAnswer(raw);
        // Sanitize cuối: model vẫn có thể trả JSON mảng/object lạ mà bộ bóc
        // không nhận ra — còn { hoặc [ thì rơi về formatter, không bao giờ
        // hiện JSON thô cho lãnh đạo.
        if (/^\s*[\{\[]/.test(synthesizedAnswer)) synthesizedAnswer = '';
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
        // Model nào viết câu trả lời này: synth trước, planner sau, luật cuối.
        engine: synthEngine || track.planner || 'nội bộ',
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

/** Nhãn tiếng Việt cho phần trả lời khi câu hỏi có nhiều ý. */
// Không kèm emoji ở đây — formatter bên dưới đã tự thêm icon cho từng phần.
const LABEL_BY_TOOL: Record<string, string> = {
  query_stock_level: 'Tồn kho',
  query_sales_summary: 'Doanh số',
  query_sales_lines: 'Món bán',
  query_product_flow: 'Nhịp Bán',
  query_cashbox_reconciliation: 'Két tiền',
  query_catalog: 'Danh mục',
  query_reprint_forecast: 'Cạn kho',
  prepare_sale_draft: 'Đơn nháp',
};

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
  if (toolName === 'query_sales_lines') {
    const items = ((data as any).items || []).slice(0, 20);
    if (items.length === 0) {
      return `🧾 **Món bán trong khung hỏi**: chưa phát sinh đơn nào.`;
    }
    const lines = items.map(
      (it: any, i: number) =>
        `${i + 1}. **${it.code} - ${it.title}** — ${Number(it.qty || 0).toLocaleString('vi-VN')} cuốn (${Number(it.revenue || 0).toLocaleString('vi-VN')} đ)`
    );
    return `🧾 **Món bán trong khung hỏi** (tổng ${Number((data as any).totalQty || 0).toLocaleString('vi-VN')} cuốn):\n${lines.join('\n')}`;
  }
  if (toolName === 'query_sales_summary') {
    const scope = (data as any).scopeLabel ? ` (${(data as any).scopeLabel})` : '';
    return `📊 **Báo cáo Doanh số${scope}**:
- Số cuốn bán: **${Number((data as any).totalQty || 0).toLocaleString('vi-VN')} cuốn**
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
  if (toolName === 'query_product_flow') {
    if ((data as any).warning) {
      return `⏱️ **Nhịp Bán**: ${(data as any).warning}`;
    }
    const p = (data as any).product || {};
    const t = (data as any).totals || {};
    const peakDay = (data as any).peakDay;
    const peakHour = (data as any).peakHour;
    const picked = (data as any).note || '';
    const title = p.code || p.title || 'món này';
    if (!t.orders) {
      return `⏱️ **Nhịp Bán ${title}**: chưa phát sinh đơn nào trong kỳ xem.${picked}`;
    }
    return `⏱️ **Nhịp Bán ${title}${p.title && p.code ? ' - ' + p.title : ''}**${picked}:
- Tổng: **${Number(t.qty || 0).toLocaleString('vi-VN')} cuốn** · **${Number(t.revenue || 0).toLocaleString('vi-VN')} đ** (${t.orders} đơn, ${t.activeDays} ngày có bán).
- Giờ vàng: **${peakHour != null ? `${peakHour}h` : 'chưa rõ'}**${peakDay ? ` · Ngày đỉnh: **${peakDay.date}** (${Number(peakDay.qty || 0)} cuốn)` : ''}.`;
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
  // Đa bước: toolName là "a + b + c". Ghép formatter từng phần, KHÔNG nhét thẳng
  // toolData dạng thô vào markdown (đã dính: sếp thấy khối JSON trong chat).
  if (toolName.includes(' + ')) {
    const parts = toolName
      .split(' + ')
      .map((name) => {
        const chunk = (data as Record<string, any>)[name];
        if (chunk === undefined || chunk === null) return null;
        const one = formatFallbackAnswer(name.trim(), chunk as Record<string, any>);
        return one && one.trim() ? `**${LABEL_BY_TOOL[name.trim()] || name.trim()}**\n${one}` : null;
      })
      .filter(Boolean) as string[];
    if (parts.length > 0) return parts.join('\n\n');
  }
  // Không có formatter nào khớp: nói thẳng bằng tiếng Việt, TUYỆT ĐỐI không in
  // JSON thô cho lãnh đạo.
  return `📋 Đã tra cứu xong (**${toolName}**), nhưng tôi chưa có cách trình bày tự nhiên cho dữ liệu này. Bạn có thể xem chi tiết ở bảng bên dưới.`;
}
