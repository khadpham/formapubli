import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module';

const ENGINE_OPTIONS = { paragraphLoop: true, linebreaks: true };

function toBinary(templateBase64: string): string {
  return typeof Buffer !== 'undefined'
    ? Buffer.from(templateBase64, 'base64').toString('binary')
    : atob(templateBase64);
}

export interface TemplateValidationResult {
  isValid: boolean;
  placeholders: string[];
  errors?: string[];
}

/**
 * Engine merge .docx — 1 nguồn sự thật cho preview lẫn export (D1).
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
}
