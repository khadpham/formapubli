import { callGeminiWithFallback } from './llm-client';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import PizZip from 'pizzip';
import { createHash } from 'crypto';
import { getChecklist } from './contract-checklists';
import { db, contractTemplates } from '@/db';
import { eq } from 'drizzle-orm';
import { ContractEngineService } from '../contract-engine.service';
import { generateUUIDv7 } from '@/lib/uuidv7';

export const CONTRACT_CATEGORIES = [
  'THUE_DIA_DIEM_SK',
  'DAT_HANG_HOA_SK',
  'TAC_QUYEN',
  'IN_AN',
  'DAI_LY_PHAN_PHOI',
  'KHAC',
] as const;

export class ContractAIError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

type LlmCaller = (params: { systemPrompt: string; userText: string; apiKey?: string }) => Promise<string>;

const defaultCaller: LlmCaller = (p) => callGeminiWithFallback({ ...p, apiKey: geminiKey() });

function geminiKey(): string {
  const k = (process.env.GEMINI_API_KEY || '').trim();
  if (!k) throw new ContractAIError('THIEU_GEMINI_API_KEY', 'Chưa cấu hình GEMINI_API_KEY');
  return k;
}

function parseJson<T>(raw: string): T {
  // LLM đôi khi bọc JSON trong ``` - lột vỏ trước khi parse
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new ContractAIError('LLM_TRA_JSON_HONG', 'AI trả về dữ liệu không đúng định dạng');
  }
}

const LEGAL_STYLE = `Bạn là trợ lý pháp chế cho một công ty xuất bản tại Việt Nam.
Văn phong: pháp lý tiếng Việt chuẩn. Dùng thuật ngữ luật Việt Nam
("bên vi phạm nghĩa vụ", "bồi thường thiệt hại", "chấm dứt hợp đồng",
"bất khả kháng"...). CẤM dùng từ thông dụng thay thuật ngữ pháp lý.
Chỉ trả về JSON thuần, không giải thích thêm.`;

export interface DraftResult {
  title: string;
  bodyText: string;
  suggestedPlaceholders: string[];
}

/** GĐ1a: soạn nháp mẫu hợp đồng từ lời mô tả. */
export async function draftTemplateFromDescription(
  input: { category: string; description: string },
  callLlm: LlmCaller = defaultCaller,
): Promise<DraftResult> {
  if (!CONTRACT_CATEGORIES.includes(input.category as never)) {
    throw new ContractAIError('LOAI_HOP_DONG_KHONG_HOP_LE');
  }
  const raw = await callLlm({
    systemPrompt: LEGAL_STYLE,
    userText:
      `Soạn nháp mẫu hợp đồng loại ${input.category} dựa trên mô tả sau:\n"${input.description}"\n\n` +
      `Yêu cầu: đầy đủ các điều khoản cơ bản (đối tượng, giá trị/thù lao, thời hạn, ` +
      `quyền-nghĩa vụ các bên, thanh toán, vi phạm/bồi thường, chấm dứt, giải quyết tranh chấp). ` +
      `Các điểm cần điền thông tin cụ thể thì để dạng {ten_placeholder} (snake_case, tiếng Việt không dấu). ` +
      `Trả JSON: {"title": "...", "bodyText": "...", "suggestedPlaceholders": ["..."]}. ` +
      `Mọi placeholder trong suggestedPlaceholders PHẢI xuất hiện trong bodyText dạng {ten}.`,
  });
  const data = parseJson<DraftResult>(raw);
  if (!data.title || !data.bodyText || !Array.isArray(data.suggestedPlaceholders)) {
    throw new ContractAIError('LLM_TRA_JSON_HONG', 'Thiếu trường bắt buộc trong kết quả AI');
  }
  return data;
}

/** GĐ1b: tải text từ link Google Docs (dùng export?format=txt). */
export async function fetchGdocText(gdocUrl: string): Promise<string> {
  const m = /\/document\/d\/([a-zA-Z0-9-_]+)/.exec(gdocUrl || '');
  if (!m) throw new ContractAIError('GDOC_KHONG_DOC_DUOC', 'Link không phải Google Docs hợp lệ');
  const url = `https://docs.google.com/document/d/${m[1]}/export?format=txt`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new ContractAIError('GDOC_KHONG_DOC_DUOC', 'Không tải được tài liệu (cần để chế độ chia sẻ công khai)');
    const text = (await res.text()).trim();
    if (!text) throw new ContractAIError('GDOC_KHONG_DOC_DUOC', 'Tài liệu rỗng');
    return text;
  } catch (e) {
    if (e instanceof ContractAIError) throw e;
    throw new ContractAIError('GDOC_KHONG_DOC_DUOC', 'Không tải được tài liệu Google Docs');
  } finally {
    clearTimeout(timer);
  }
}

export interface StructuredTemplate {
  title: string;
  bodyText: string;
  suggestedPlaceholders: { placeholder: string; originalText: string }[];
}

/** GĐ1b: cấu trúc hóa văn bản mẫu thật - giữ nguyên điều khoản, chỉ đánh dấu điểm điền. */
export async function structureGdocTemplate(
  rawText: string,
  callLlm: LlmCaller = defaultCaller,
): Promise<StructuredTemplate> {
  const raw = await callLlm({
    systemPrompt:
      LEGAL_STYLE +
      `\nNhiệm vụ: cấu trúc hóa một mẫu hợp đồng CÓ SẴN. GIỮ NGUYÊN từng câu chữ ` +
      `của điều khoản gốc - CẤM viết lại, cấm thêm bớt điều khoản. Chỉ tìm các điểm ` +
      `cần điền thông tin (tên công ty/cá nhân, số tiền, ngày tháng, địa chỉ...) và ` +
      `thay bằng {placeholder} (snake_case, tiếng Việt không dấu). Chỉ trả JSON.`,
    userText:
      `Văn bản mẫu:\n"""\n${rawText.slice(0, 12000)}\n"""\n\n` +
      `Trả JSON: {"title": "tên loại hợp đồng suy từ văn bản", "bodyText": "toàn văn với {placeholder}", ` +
      `"suggestedPlaceholders": [{"placeholder": "...", "originalText": "chuỗi gốc bị thay"}]}. ` +
      `Mỗi originalText PHẢI là chuỗi con chính xác của văn bản gốc.`,
  });
  const data = parseJson<StructuredTemplate>(raw);
  if (!data.bodyText || !Array.isArray(data.suggestedPlaceholders)) {
    throw new ContractAIError('LLM_TRA_JSON_HONG', 'Thiếu trường bắt buộc trong kết quả AI');
  }
  return data;
}

export interface FinalizeInput {
  code: string;
  title: string;
  category: string;
  bodyText: string;
  placeholders: string[];
  sourceUrl?: string;
}

/** GĐ1c: sinh .docx từ văn bản đã chốt → validate → lưu contract_templates. */
export async function finalizeAiTemplate(input: FinalizeInput): Promise<string> {
  const code = input.code.trim();
  const title = input.title.trim();
  const bodyText = input.bodyText.trim();
  if (!code) throw new ContractAIError('THIEU_CODE', 'Thiếu mã mẫu (code).');
  if (!title) throw new ContractAIError('THIEU_TIEU_DE', 'Thiếu tiêu đề mẫu.');
  if (!bodyText) throw new ContractAIError('THIEU_NOI_DUNG', 'Thiếu nội dung mẫu.');
  if (!CONTRACT_CATEGORIES.includes(input.category as never)) {
    throw new ContractAIError('LOAI_HOP_DONG_KHONG_HOP_LE');
  }
  const [dup] = await db.select({ id: contractTemplates.id }).from(contractTemplates).where(eq(contractTemplates.code, code)).limit(1);
  if (dup) throw new ContractAIError('TRUNG_CODE', `Mã mẫu ${code} đã tồn tại.`);

  // Sinh .docx: mỗi dòng văn bản = 1 Paragraph, giữ nguyên {placeholder}
  const paragraphs = bodyText.split('\n').map((line) => new Paragraph({ children: [new TextRun(line || ' ')] }));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buffer = await Packer.toBuffer(doc);
  const templateData = buffer.toString('base64');

  // Validate bằng engine hiện tại - .docx sinh ra phải merge được
  const check = ContractEngineService.validateTemplate(templateData);
  if (!check.isValid) {
    throw new ContractAIError('DOCX_KHONG_HOP_LE', `File mẫu lỗi: ${(check.errors || []).join('; ')}`);
  }

  const schemaFields = JSON.stringify(input.placeholders.map((key) => ({ key, label: key, type: 'text', required: false })));
  const [row] = await db.insert(contractTemplates).values({
    id: `ctpl-${generateUUIDv7()}`,
    code,
    title,
    category: input.category,
    description: 'Mẫu do AI soạn/nhập - CHƯA DUYỆT PHÁP LÝ.',
    templateFilename: `${code}.docx`,
    templateData,
    schemaFields,
    version: 1,
    isActive: true,
    legalReviewed: false,
    aiGenerated: true,
    sourceUrl: input.sourceUrl?.trim() || null,
  }).returning();
  return row.id;
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface DraftAdjustment {
  id: string;
  clauseRef: string;
  original: string;
  proposed: string;
  reason: string;
}

export interface SmartDraftResult {
  filledText: string;
  adjustments: DraftAdjustment[];
}

/** GĐ3: điền placeholder từ fieldValues + đề xuất điều chỉnh điều khoản (riêng biệt, chờ duyệt). */
export async function smartDraft(
  input: { templateId: string; fieldValues: Record<string, string>; notes: string },
  callLlm: LlmCaller = defaultCaller,
): Promise<SmartDraftResult> {
  const [tpl] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, input.templateId)).limit(1);
  if (!tpl || !tpl.isActive) throw new ContractAIError('MAU_KHONG_TON_TAI', 'Không tìm thấy mẫu hợp đồng.');
  const templateText = extractDocxText(tpl.templateData);
  const valuesText = Object.entries(input.fieldValues)
    .map(([k, v]) => `{${k}} = ${v}`)
    .join('\n');
  const raw = await callLlm({
    systemPrompt:
      LEGAL_STYLE +
      `\nNhiệm vụ: soạn thảo thông minh từ mẫu. Hai quy tắc BẤT DI BẤT DỊCH:\n` +
      `1. filledText: điền giá trị vào các {placeholder} theo bảng giá trị. GIỮ NGUYÊN từng câu chữ điều khoản gốc - CẤM sửa/xóa/thêm điều khoản trong filledText.\n` +
      `2. Mọi điều chỉnh điều khoản theo ghi chú tình huống PHẢI đưa vào adjustments (mảng riêng), mỗi mục ghi rõ điều khoản gốc (original), bản đề xuất (proposed), lý do (reason). ` +
      `Không có gì để điều chỉnh thì adjustments = []. Chỉ trả JSON.`,
    userText:
      `Mẫu hợp đồng:\n"""\n${templateText.slice(0, 10000)}\n"""\n\n` +
      `Bảng giá trị:\n${valuesText || '(trống)'}\n\n` +
      `Ghi chú tình huống: "${input.notes || '(không có)'}"\n\n` +
      `Trả JSON: {"filledText": "toàn văn đã điền giá trị", "adjustments": [{"id": "adj-1", "clauseRef": "...", "original": "...", "proposed": "...", "reason": "..."}]}.`,
  });
  const data = parseJson<SmartDraftResult>(raw);
  if (typeof data.filledText !== 'string' || !Array.isArray(data.adjustments)) {
    throw new ContractAIError('LLM_TRA_JSON_HONG', 'Thiếu trường bắt buộc trong kết quả AI');
  }
  const adjustments = data.adjustments.filter(
    (a) => a && a.id && a.clauseRef && a.original && a.proposed && typeof a.reason === 'string',
  );
  return { filledText: data.filledText, adjustments };
}

/** GĐ2: trích text từ file .docx (base64) - chỉ đọc, không merge. */
export function extractDocxText(base64: string): string {
  let zip: PizZip;
  try {
    zip = new PizZip(Buffer.from(base64, 'base64'));
  } catch {
    throw new ContractAIError('DOCX_KHONG_DOC_DUOC', 'File không phải định dạng Word hợp lệ.');
  }
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) throw new ContractAIError('DOCX_KHONG_DOC_DUOC', 'File không phải định dạng Word hợp lệ.');
  const xml = xmlFile.asText();
  const parts: string[] = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(m[1]);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new ContractAIError('DOCX_KHONG_DOC_DUOC', 'Không trích được nội dung từ file Word.');
  return text;
}

export interface ContractAnalysis {
  contractType: string;
  parties: string[];
  valueText: string | null;
  keyDates: string[];
  obligations: string[];
  summary: string;
}

/** GĐ2: AI tóm tắt + trích xuất thực thể từ văn bản hợp đồng. */
export async function analyzeContract(
  text: string,
  callLlm: LlmCaller = defaultCaller,
): Promise<ContractAnalysis> {
  const clean = text.trim();
  if (!clean) throw new ContractAIError('VAN_BAN_RONG', 'Văn bản hợp đồng rỗng.');
  const truncated = clean.length > 12000;
  const raw = await callLlm({
    systemPrompt: LEGAL_STYLE,
    userText:
      `Đọc văn bản hợp đồng sau và trích xuất thông tin. Chỉ trả JSON.\n"""\n${clean.slice(0, 12000)}\n"""\n\n` +
      `Trả JSON: {"contractType": "loại hợp đồng", "parties": ["tên các bên"], ` +
      `"valueText": "giá trị (hoặc null)", "keyDates": ["ngày quan trọng"], ` +
      `"obligations": ["nghĩa vụ chính mỗi bên, tối đa 6"], "summary": "tóm tắt 3-5 câu"}.`,
  });
  const data = parseJson<ContractAnalysis>(raw);
  if (!data.summary || !Array.isArray(data.parties)) {
    throw new ContractAIError('LLM_TRA_JSON_HONG', 'Thiếu trường bắt buộc trong kết quả AI');
  }
  return { ...data, summary: truncated ? data.summary + ' (Lưu ý: văn bản đã bị cắt bớt khi phân tích.)' : data.summary };
}

export interface ReviewIssue {
  checklistId: string;
  level: 'THIEU' | 'MO_HO' | 'RUI_RO' | 'DAT';
  finding: string;
  suggestion: string;
}

/** GĐ2: AI phản biện văn bản theo checklist của loại hợp đồng. */
export async function reviewContract(
  text: string,
  category: string,
  callLlm: LlmCaller = defaultCaller,
): Promise<{ issues: ReviewIssue[] }> {
  const clean = text.trim();
  if (!clean) throw new ContractAIError('VAN_BAN_RONG', 'Văn bản hợp đồng rỗng.');
  const checklist = getChecklist(category);
  const checklistText = checklist.map((c) => `- [${c.id}] ${c.label}: ${c.hint}`).join('\n');
  const raw = await callLlm({
    systemPrompt:
      LEGAL_STYLE +
      `\nNhiệm vụ: PHẢN BIỆN hợp đồng theo checklist. Với mỗi mục checklist, đánh giá: ` +
      `DAT (điều khoản đã có và ổn), THIEU (thiếu hẳn), MO_HO (có nhưng mơ hồ), RUI_RO (có nhưng rủi ro cho công ty). ` +
      `finding: nhận xét ngắn gọn. suggestion: đề xuất câu chữ cụ thể để bổ sung/sửa (để trống nếu DAT). ` +
      `Kết quả là THAM KHẢO - không phải tư vấn pháp lý. Chỉ trả JSON.`,
    userText:
      `Checklist:\n${checklistText}\n\nVăn bản hợp đồng:\n"""\n${clean.slice(0, 12000)}\n"""\n\n` +
      `Trả JSON: {"issues": [{"checklistId": "...", "level": "THIEU|MO_HO|RUI_RO|DAT", "finding": "...", "suggestion": "..."}]}. ` +
      `Mỗi checklistId PHẢI thuộc checklist trên.`,
  });
  const data = parseJson<{ issues: ReviewIssue[] }>(raw);
  if (!Array.isArray(data.issues)) throw new ContractAIError('LLM_TRA_JSON_HONG', 'Thiếu trường issues.');
  const validIds = new Set(checklist.map((c) => c.id));
  const validLevels = new Set(['THIEU', 'MO_HO', 'RUI_RO', 'DAT']);
  const issues = data.issues.filter(
    (i) => i && validIds.has(i.checklistId) && validLevels.has(i.level) && typeof i.finding === 'string',
  ).map((i) => ({ checklistId: i.checklistId, level: i.level, finding: i.finding, suggestion: `${i.suggestion || ''}` }));
  return { issues };
}
