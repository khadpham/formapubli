import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import {
  db,
  contractTemplates,
  contractDocuments,
  contractCounters,
  contractCompanyProfile,
  contractPresets,
  partners,
  works,
  editions,
  bankAccounts,
} from '../db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';
import { ContractEngineService } from './contract-engine.service';
import { readVietnameseNumber } from '../lib/vietnamese-number-reader';

const PREFIX_MAP: Record<string, string> = {
  TAC_QUYEN: 'HĐXB',
  DAI_LY: 'HĐĐL',
  IN_AN: 'HĐIN',
  DICH_THUAT: 'HĐDT',
};

function formatContractNumber(seq: number, year: number, category: string): string {
  const code = PREFIX_MAP[category] ?? 'HĐ';
  const seqStr = seq < 10 ? `0${seq}` : `${seq}`;
  return `${seqStr}/${year}/${code}-FORMA`;
}

function bytesToBase64(u8: Uint8Array): string {
  return Buffer.from(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

/**
 * Nghiệp vụ hợp đồng: cấp số nguyên tử (D2), auto-fill override được (D8),
 * snapshot chống hồi tố (D3), bản cuối upload nhiều lần (D9), preset (D11).
 */
export class ContractService {
  /** Cấp số HĐ nguyên tử cho (category, year) — pattern allocateOrderCode
   * (order-code.ts): INSERT...ON CONFLICT DO UPDATE...RETURNING qua API bảng
   * Drizzle, chạy TRONG transaction gọi nó. KHÔNG dùng COUNT+1 (race). */
  static async nextSeq(txOrDb: any, category: string, year: number): Promise<number> {
    const rows = await txOrDb
      .insert(contractCounters)
      .values({ category, year, lastSeq: 1 })
      .onConflictDoUpdate({
        target: [contractCounters.category, contractCounters.year],
        set: { lastSeq: sql`${contractCounters.lastSeq} + 1` },
      })
      .returning({ lastSeq: contractCounters.lastSeq });
    return Number(rows?.[0]?.lastSeq ?? 0);
  }

  static async generateContractNumber(category: string, year = new Date().getFullYear()): Promise<string> {
    const seq = await this.nextSeq(db, category, year);
    return formatContractNumber(seq, year, category);
  }

  /** Dữ liệu tự điền — chỉ là DEFAULT, form vẫn sửa tay (D8). */
  static async getAutoFillData(params: { partnerId?: string; workId?: string; editionId?: string }) {
    const out: Record<string, any> = {};
    const [profile] = await db.select().from(contractCompanyProfile).where(eq(contractCompanyProfile.id, 'main')).limit(1);
    out.ben_a_ten = profile?.tenCongTy ?? 'FORMApubli';
    out.ben_a_dai_dien = profile?.daiDien ?? '';
    out.ben_a_chuc_vu = profile?.chucVu ?? '';
    out.ben_a_dia_chi = profile?.diaChi ?? '';
    out.ben_a_mst = profile?.mst ?? '';
    out.ben_a_sdt = profile?.sdt ?? '';
    const [bank] = await db.select().from(bankAccounts).where(eq(bankAccounts.isActive, true as any)).limit(1);
    out.ben_a_tk_ngan_hang = (bank as any)?.accountNo ?? '';
    out.ben_a_ngan_hang = (bank as any)?.label ?? '';
    if (params.partnerId) {
      const [p] = await db.select().from(partners).where(eq(partners.id, params.partnerId)).limit(1);
      if (p) {
        out.ben_b_ten = p.name;
        out.ben_b_dia_chi = (p as any).address ?? '';
        out.ben_b_sdt = (p as any).phone ?? '';
        out.ben_b_email = (p as any).email ?? '';
        out.ben_b_cccd_mst = (p as any).taxCode ?? '';
        out.ben_b_dai_dien = (p as any).receiverName ?? '';
        out.ty_le_chiet_khau = `${Math.round(Number((p as any).discountRate ?? 0) * 100)}%`;
        out.han_muc_cong_no = Number((p as any).creditLimit ?? 0);
        out.thoi_han_thanh_toan = `${Number((p as any).paymentDueDays ?? 30)} ngày`;
      }
    }
    if (params.workId) {
      const [w] = await db.select().from(works).where(eq(works.id, params.workId)).limit(1);
      if (w) {
        out.ten_tac_pham = w.title;
        out.tac_gia = w.author;
        out.dich_gia = (w as any).translator ?? '';
      }
    }
    if (params.editionId) {
      const [e] = await db.select().from(editions).where(eq(editions.id, params.editionId)).limit(1);
      if (e) {
        const cover = Number((e as any).coverPrice ?? 0);
        out.ma_isbn = (e as any).isbn ?? '';
        out.gia_bia_so = `${cover.toLocaleString('vi-VN')} VNĐ`;
        out.gia_bia_chu = readVietnameseNumber(cover).replace(/\s*đồng chẵn\s*$/i, '').trim();
      }
    }
    return out;
  }

  static async createDocument(input: {
    templateId: string;
    title: string;
    category: string;
    payloadData: Record<string, any>;
    partnerId?: string;
    workId?: string;
    signedDate?: string;
    effectiveDate?: string;
    expiryDate?: string;
    totalAmount?: number;
    createdBy: string;
    notes?: string;
  }) {
    const [tpl] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, input.templateId)).limit(1);
    if (!tpl) throw AppError.invalid('Không tìm thấy mẫu hợp đồng.');
    const year = new Date().getFullYear();
    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        const seq = await this.nextSeq(tx, input.category, year);
        const contractNumber = formatContractNumber(seq, year, input.category);
        const [doc] = await tx.insert(contractDocuments).values({
          id: `cdoc-${crypto.randomUUID()}`,
          contractNumber,
          templateId: tpl.id,
          templateVersion: tpl.version ?? 1,
          title: input.title,
          partnerId: input.partnerId ?? null,
          workId: input.workId ?? null,
          status: 'DRAFT',
          payloadData: JSON.stringify(input.payloadData),
          createdBy: input.createdBy,
          signedDate: input.signedDate ?? null,
          effectiveDate: input.effectiveDate ?? null,
          expiryDate: input.expiryDate ?? null,
          totalAmount: Math.round(input.totalAmount ?? 0),
          notes: input.notes ?? null,
        }).returning();
        const binary = ContractEngineService.generateDocx(tpl.templateData, {
          ...input.payloadData,
          so_hop_dong: contractNumber,
        });
        await tx.update(contractDocuments)
          .set({ renderedDocx: bytesToBase64(binary) })
          .where(eq(contractDocuments.id, doc.id));
        return { ...doc, contractNumber };
      })
    );
  }

  static async updateDocument(id: string, patch: {
    title?: string;
    payloadData?: Record<string, any>;
    partnerId?: string | null;
    workId?: string | null;
    signedDate?: string | null;
    effectiveDate?: string | null;
    expiryDate?: string | null;
    totalAmount?: number;
    notes?: string | null;
    status?: string;
  }) {
    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        const [doc] = await tx.select().from(contractDocuments).where(eq(contractDocuments.id, id)).limit(1);
        if (!doc) throw AppError.invalid(`Không tìm thấy hợp đồng ${id}.`);
        if (doc.status !== 'DRAFT') throw AppError.conflict('Chỉ sửa được hợp đồng ở trạng thái DRAFT.');
        if (patch.status !== undefined && !['DRAFT', 'FINALIZED', 'SIGNED', 'CANCELLED'].includes(patch.status)) {
          throw AppError.invalid(`Trạng thái không hợp lệ: ${patch.status}.`);
        }
        const nextPayload = patch.payloadData ?? JSON.parse(doc.payloadData || '{}');
        const [tpl] = await tx.select().from(contractTemplates).where(eq(contractTemplates.id, doc.templateId)).limit(1);
        const binary = tpl
          ? ContractEngineService.generateDocx(tpl.templateData, { ...nextPayload, so_hop_dong: doc.contractNumber })
          : null;
        await tx.update(contractDocuments).set({
          title: patch.title ?? doc.title,
          payloadData: JSON.stringify(nextPayload),
          partnerId: patch.partnerId !== undefined ? patch.partnerId : doc.partnerId,
          workId: patch.workId !== undefined ? patch.workId : doc.workId,
          signedDate: patch.signedDate !== undefined ? patch.signedDate : doc.signedDate,
          effectiveDate: patch.effectiveDate !== undefined ? patch.effectiveDate : doc.effectiveDate,
          expiryDate: patch.expiryDate !== undefined ? patch.expiryDate : doc.expiryDate,
          totalAmount: patch.totalAmount !== undefined ? Math.round(patch.totalAmount) : doc.totalAmount,
          notes: patch.notes !== undefined ? patch.notes : doc.notes,
          status: patch.status ?? doc.status,
          ...(binary ? { renderedDocx: bytesToBase64(binary) } : {}),
        }).where(eq(contractDocuments.id, id));
        const [after] = await tx.select().from(contractDocuments).where(eq(contractDocuments.id, id)).limit(1);
        return after;
      })
    );
  }

  /** Xuất file Word: bản cuối upload thắng, rồi tới snapshot, rồi re-render. */
  static async exportDocx(id: string): Promise<Uint8Array> {
    const [doc] = await db.select().from(contractDocuments).where(eq(contractDocuments.id, id)).limit(1);
    if (!doc) throw AppError.invalid(`Không tìm thấy hợp đồng ${id}.`);
    const b64 = doc.finalDocx ?? doc.renderedDocx;
    if (b64) return base64ToBytes(b64);
    const [tpl] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, doc.templateId)).limit(1);
    if (!tpl) throw AppError.invalid('Mẫu hợp đồng gốc đã mất, không re-render được.');
    return ContractEngineService.generateDocx(tpl.templateData, {
      ...JSON.parse(doc.payloadData || '{}'),
      so_hop_dong: doc.contractNumber,
    });
  }

  /** Upload bản cuối sau khi sửa ngoài Word (D9): validate mở được rồi mới lưu. */
  static async uploadFinalDocx(id: string, base64: string, filename: string) {
    const [doc] = await db.select().from(contractDocuments).where(eq(contractDocuments.id, id)).limit(1);
    if (!doc) throw AppError.invalid(`Không tìm thấy hợp đồng ${id}.`);
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(base64);
      // PizZip nhận Uint8Array trực tiếp — KHÔNG qua binary string (mất byte
      // với file thật có vùng text rộng/nhị phân, gây fail validate).
      const zip = new PizZip(bytes);
      if (!zip.file('word/document.xml')) throw new Error('not-docx');
      new Docxtemplater(zip);
    } catch {
      throw AppError.invalid('File tải lên không phải Word .docx hợp lệ.');
    }
    await db.update(contractDocuments).set({
      finalDocx: base64,
      finalFilename: `${filename || 'final'}`.slice(0, 200),
      status: 'FINALIZED',
    }).where(eq(contractDocuments.id, id));
    return { id, status: 'FINALIZED' as const };
  }

  static async listTemplates() {
    return db.select().from(contractTemplates).orderBy(asc(contractTemplates.code));
  }

  static async listDocuments(filter: { status?: string; partnerId?: string } = {}) {
    const conds: any[] = [];
    if (filter.status) conds.push(eq(contractDocuments.status, filter.status));
    if (filter.partnerId) conds.push(eq(contractDocuments.partnerId, filter.partnerId));
    return db.select().from(contractDocuments)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contractDocuments.createdAt));
  }

  static async getDocumentById(id: string) {
    const [doc] = await db.select().from(contractDocuments).where(eq(contractDocuments.id, id)).limit(1);
    if (!doc) throw AppError.invalid(`Không tìm thấy hợp đồng ${id}.`);
    return doc;
  }

  static async getCompanyProfile() {
    const [row] = await db.select().from(contractCompanyProfile).where(eq(contractCompanyProfile.id, 'main')).limit(1);
    return row ?? null;
  }

  static async updateCompanyProfile(patch: {
    tenCongTy?: string; daiDien?: string | null; chucVu?: string | null;
    diaChi?: string | null; mst?: string | null; sdt?: string | null; email?: string | null;
  }) {
    await db.insert(contractCompanyProfile).values({ id: 'main', tenCongTy: 'FORMApubli' })
      .onConflictDoNothing({ target: contractCompanyProfile.id });
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      clean[k] = typeof v === 'string' ? v.trim().slice(0, 300) || null : v;
    }
    if (clean.tenCongTy !== undefined && !clean.tenCongTy) throw AppError.invalid('Tên công ty không được để trống.');
    await db.update(contractCompanyProfile).set(clean).where(eq(contractCompanyProfile.id, 'main'));
    const [after] = await db.select().from(contractCompanyProfile).where(eq(contractCompanyProfile.id, 'main')).limit(1);
    return after;
  }

  static async listPresets() {
    return db.select().from(contractPresets).orderBy(asc(contractPresets.sortOrder));
  }

  static async createPreset(params: { label: string; valuesJson: string; sortOrder?: number }) {
    const label = `${params.label || ''}`.trim();
    if (!label) throw AppError.invalid('Nhãn preset không được để trống.');
    try {
      const parsed = JSON.parse(params.valuesJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
    } catch {
      throw AppError.invalid('valuesJson phải là object JSON.');
    }
    const [row] = await db.insert(contractPresets).values({
      id: `cpre-${crypto.randomUUID()}`,
      label,
      valuesJson: params.valuesJson,
      sortOrder: Number.isInteger(params.sortOrder) ? params.sortOrder! : 0,
    }).returning();
    return row;
  }

  static async updatePreset(id: string, patch: { label?: string; valuesJson?: string; sortOrder?: number; isActive?: boolean }) {
    const [row] = await db.select().from(contractPresets).where(eq(contractPresets.id, id)).limit(1);
    if (!row) throw AppError.invalid(`Không tìm thấy preset ${id}.`);
    const clean: Record<string, any> = {};
    if (patch.label !== undefined) {
      if (!`${patch.label}`.trim()) throw AppError.invalid('Nhãn preset không được để trống.');
      clean.label = `${patch.label}`.trim().slice(0, 200);
    }
    if (patch.valuesJson !== undefined) {
      try {
        const parsed = JSON.parse(patch.valuesJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
      } catch {
        throw AppError.invalid('valuesJson phải là object JSON.');
      }
      clean.valuesJson = patch.valuesJson;
    }
    if (patch.sortOrder !== undefined) {
      if (!Number.isInteger(patch.sortOrder)) throw AppError.invalid('sortOrder phải là số nguyên.');
      clean.sortOrder = patch.sortOrder;
    }
    if (patch.isActive !== undefined) clean.isActive = patch.isActive;
    await db.update(contractPresets).set(clean).where(eq(contractPresets.id, id));
    const [after] = await db.select().from(contractPresets).where(eq(contractPresets.id, id)).limit(1);
    return after;
  }

  static async deletePreset(id: string) {
    const [row] = await db.select().from(contractPresets).where(eq(contractPresets.id, id)).limit(1);
    if (!row) throw AppError.invalid(`Không tìm thấy preset ${id}.`);
    await db.delete(contractPresets).where(eq(contractPresets.id, id));
    return { id, deleted: true as const };
  }
}
