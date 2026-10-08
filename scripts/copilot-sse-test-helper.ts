/**
 * Helper cho test scripts: đọc SSE stream từ POST /api/ai/copilot (GĐ2).
 * Trả về shape cũ { success: true, data: <payload của event 'done'> }
 * để các assertion hiện có (body.data.answer, body.data.toolUsed...) giữ nguyên.
 * Event 'error' → throw với message của server.
 */
export async function readCopilotSseResponse(res: Response): Promise<{ success: boolean; data?: any; code?: string; message?: string }> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    // Lỗi HTTP (401/403/429/400) vẫn trả JSON như cũ — giữ nguyên shape.
    return await res.json();
  }
  const text = await res.text();
  const chunks = text.split('\n\n');
  for (const chunk of chunks) {
    const m = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]*)$/);
    if (!m) continue;
    const event = m[1].trim();
    let data: any = null;
    try {
      data = JSON.parse(m[2]);
    } catch {
      continue;
    }
    if (event === 'done') {
      return { success: true, data };
    }
    if (event === 'error') {
      throw new Error(`Copilot SSE error: ${data?.message || 'unknown'}`);
    }
  }
  throw new Error(`SSE stream thiếu event done (nhận ${chunks.length} chunks): ${text.slice(0, 200)}`);
}
