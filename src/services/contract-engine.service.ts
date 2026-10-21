import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module';

const ENGINE_OPTIONS = {
  paragraphLoop: true,
  linebreaks: true,
  // Draft lưu thiếu biến là bình thường (điền dần) - thiếu thì để trống,
  // không ném 500. Lỗi CÚ PHÁP vẫn ném ở constructor (validate bắt được).
  nullGetter: () => '',
};

function toBinary(templateBase64: string): string {
  // Dùng Buffer path khi có - atob ở Node cũ gây lệch byte với file thật.
  return Buffer.from(templateBase64, 'base64').toString('binary');
}

export interface TemplateValidationResult {
  isValid: boolean;
  placeholders: string[];
  errors?: string[];
}

export interface DocxPackageCheckResult {
  isValid: boolean;
  errors?: string[];
}

/** Các part bắt buộc tối thiểu của một package OOXML (.docx) theo ECMA-376. */
const REQUIRED_DOCX_PARTS = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];

/**
 * Engine merge .docx - 1 nguồn sự thật cho preview lẫn export (D1).
 * Extract/validate placeholder bằng inspect-module (D4): CẤM regex trên XML
 * vì Word bẻ `{ten_bien}` thành nhiều run.
 */
export class ContractEngineService {
  static generateDocx(templateBase64: string, data: Record<string, any>): Uint8Array {
    const zip = new PizZip(toBinary(templateBase64));
    const doc = new Docxtemplater(zip, ENGINE_OPTIONS);
    doc.render(data);
    return doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
  }

  static extractPlaceholders(templateBase64: string): string[] {
    const zip = new PizZip(toBinary(templateBase64));
    const iModule = new InspectModule();
    const doc = new Docxtemplater(zip, { ...ENGINE_OPTIONS, modules: [iModule] });
    doc.render({});
    const tags = iModule.getAllTags();
    const out = new Set<string>();
    const walk = (node: Record<string, any>, prefix = '') => {
      for (const [k, v] of Object.entries(node)) {
        const full = prefix ? `${prefix}.${k}` : k;
        out.add(full);
        if (v && typeof v === 'object') walk(v as Record<string, any>, full);
      }
    };
    walk(tags);
    return Array.from(out);
  }

  static validateTemplate(templateBase64: string): TemplateValidationResult {
    try {
      return { isValid: true, placeholders: this.extractPlaceholders(templateBase64) };
    } catch (err: any) {
      const details = Array.isArray(err?.properties?.errors)
        ? err.properties.errors.map((e: any) => e.message ?? String(e))
        : undefined;
      return {
        isValid: false,
        placeholders: [],
        errors: details?.length ? details : [err?.message || 'File Word không hợp lệ'],
      };
    }
  }

  /**
   * Kiểm tra cấu trúc package OOXML của file .docx (base64).
   * Bắt các file zip hợp lệ nhưng thiếu part bắt buộc - VD mẫu seed dựng tay
   * bằng PizZip thiếu _rels/.rels: unzip vẫn đạt nhưng Word từ chối mở.
   * Dùng ở: đường upload mẫu hợp đồng, cuối script seed (fail nhanh).
   */
  static validateDocxPackage(templateBase64: string): DocxPackageCheckResult {
    const errors: string[] = [];
    let zip: PizZip;
    try {
      zip = new PizZip(toBinary(templateBase64));
    } catch {
      return { isValid: false, errors: ['File không phải định dạng ZIP/.docx hợp lệ.'] };
    }
    for (const part of REQUIRED_DOCX_PARTS) {
      if (!zip.file(part)) errors.push(`Thiếu thành phần bắt buộc: ${part}.`);
    }
    // _rels/.rels phải khai báo quan hệ tới word/document.xml
    const rels = zip.file('_rels/.rels');
    if (rels) {
      const xml = rels.asText();
      if (!/officeDocument/.test(xml) || !/word\/document\.xml/.test(xml)) {
        errors.push('File _rels/.rels không khai báo quan hệ tới word/document.xml.');
      }
    }
    return errors.length ? { isValid: false, errors } : { isValid: true };
  }
}
