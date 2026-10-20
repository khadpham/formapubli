/**
 * Publishing Service - Quan ly du an xuat ban.
 *
 * Moi du an co 5 giai doan theo thu tu:
 *   THIET_KE_BIA -> BIEN_DICH -> BIEN_TAP -> DAN_TRANG -> DOC_MORAT
 *
 * Rule engine tu dong kiem tra logic thoi gian khi cap nhat.
 */

import { db, publishingProjects, publishingStages } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import { AppError } from './app-error';
import {
  PublishingRules,
  STAGE_ORDER,
  STAGE_LABELS,
  type StageDates,
  type RuleViolation,
} from './publishing-rules.service';

export interface CreateProjectParams {
  bookTitle: string;
  originalTitle?: string;
  author?: string;
  translator?: string;
  bookSize?: string;
  pageCount?: number;
  coverPrice?: number;
  plannedPrintDate?: string;
  notes?: string;
  createdBy?: string;
}

export interface UpdateStageParams {
  contractDate?: string;
  acceptanceDate?: string;
  plannedStart?: string;
  plannedEnd?: string;
  contractAmount?: number;
  assigneeName?: string;
  contractId?: string;
  acceptanceDocId?: string;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export class PublishingService {
  /**
   * Tao du an moi, tu dong sinh 5 giai doan.
   */
  static async create(params: CreateProjectParams) {
    if (!params.bookTitle?.trim()) {
      throw AppError.invalid('Thieu ten sach.');
    }

    // Sinh ma du an: DA-2026-XXX
    const year = new Date().getFullYear();
    const count = await db.select().from(publishingProjects);
    const code = `DA-${year}-${String(count.length + 1).padStart(3, '0')}`;

    const projectId = genId('pp');
    await db.insert(publishingProjects).values({
      id: projectId,
      code,
      bookTitle: params.bookTitle.trim(),
      originalTitle: params.originalTitle,
      author: params.author,
      translator: params.translator,
      bookSize: params.bookSize,
      pageCount: params.pageCount,
      coverPrice: params.coverPrice,
      status: 'DRAFT',
      currentStage: STAGE_ORDER[0],
      plannedPrintDate: params.plannedPrintDate,
      notes: params.notes,
      createdBy: params.createdBy,
    });

    // Tao 5 giai doan
    for (let i = 0; i < STAGE_ORDER.length; i++) {
      await db.insert(publishingStages).values({
        id: genId('ps'),
        projectId,
        stage: STAGE_ORDER[i],
        stageOrder: i + 1,
        status: i === 0 ? 'IN_PROGRESS' : 'PENDING',
      });
    }

    return { projectId, code };
  }

  /**
   * Lay chi tiet du an kem cac giai doan.
   */
  static async getById(projectId: string) {
    const projects = await db
      .select()
      .from(publishingProjects)
      .where(eq(publishingProjects.id, projectId))
      .limit(1);
    if (projects.length === 0) throw AppError.invalid('Khong tim thay du an.');

    const stages = await db
      .select()
      .from(publishingStages)
      .where(eq(publishingStages.projectId, projectId))
      .orderBy(publishingStages.stageOrder);

    return { project: projects[0], stages };
  }

  /**
   * Cap nhat giai doan, tu dong kiem tra rule engine.
   * Neu co vi pham BLOCK: tra ve loi, khong luu.
   * Neu chi co WARN: luu va tra ve canh bao.
   */
  static async updateStage(
    projectId: string,
    stage: string,
    params: UpdateStageParams,
    opts?: { force?: boolean; actorRole?: string }
  ): Promise<{ updated: boolean; warnings: RuleViolation[] }> {
    // Lay tat ca stages de kiem tra lien giai doan
    const allStages = await db
      .select()
      .from(publishingStages)
      .where(eq(publishingStages.projectId, projectId))
      .orderBy(publishingStages.stageOrder);

    const target = allStages.find((s) => s.stage === stage);
    if (!target) throw AppError.invalid(`Giai doan khong ton tai: ${stage}`);

    // Xay dung danh sach dates de validate (voi gia tri moi)
    const stageDates: StageDates[] = allStages.map((s) => {
      if (s.stage === stage) {
        return {
          stage: s.stage as any,
          contractDate: params.contractDate ?? s.contractDate,
          acceptanceDate: params.acceptanceDate ?? s.acceptanceDate,
          plannedStart: params.plannedStart ?? s.plannedStart,
          plannedEnd: params.plannedEnd ?? s.plannedEnd,
        };
      }
      return {
        stage: s.stage as any,
        contractDate: s.contractDate,
        acceptanceDate: s.acceptanceDate,
        plannedStart: s.plannedStart,
        plannedEnd: s.plannedEnd,
      };
    });

    const violations = PublishingRules.validate(stageDates);
    const blocking = violations.filter((v) => v.severity === 'BLOCK');

    // Neu co BLOCK va khong force: chan
    if (blocking.length > 0 && !opts?.force) {
      const messages = blocking.map((v) => `[${v.rule}] ${v.message}`).join('\n');
      throw AppError.invalid(
        `Vi pham logic thoi gian, khong the luu:\n${messages}\n\nCan xac nhan cua manager de bo qua.`
      );
    }

    // Luu
    const updateData: any = { updatedAt: new Date().toISOString() };
    if (params.contractDate !== undefined) updateData.contractDate = params.contractDate;
    if (params.acceptanceDate !== undefined) {
      updateData.acceptanceDate = params.acceptanceDate;
      updateData.status = 'DONE';
    }
    if (params.plannedStart !== undefined) updateData.plannedStart = params.plannedStart;
    if (params.plannedEnd !== undefined) updateData.plannedEnd = params.plannedEnd;
    if (params.contractAmount !== undefined) {
      updateData.contractAmount = params.contractAmount;
      updateData.taxAmount = Math.round(params.contractAmount * 0.1);
      updateData.netAmount = params.contractAmount - Math.round(params.contractAmount * 0.1);
    }
    if (params.assigneeName !== undefined) updateData.assigneeName = params.assigneeName;
    if (params.contractId !== undefined) updateData.contractId = params.contractId;
    if (params.acceptanceDocId !== undefined) updateData.acceptanceDocId = params.acceptanceDocId;

    await db
      .update(publishingStages)
      .set(updateData)
      .where(
        and(
          eq(publishingStages.projectId, projectId),
          eq(publishingStages.stage, stage)
        )
      );

    // Cap nhat current_stage cua project
    const nextPending = allStages.find(
      (s) => s.stage !== stage && s.status === 'PENDING'
    );
    if (updateData.status === 'DONE' && nextPending) {
      await db
        .update(publishingStages)
        .set({ status: 'IN_PROGRESS' })
        .where(
          and(
            eq(publishingStages.projectId, projectId),
            eq(publishingStages.stage, nextPending.stage)
          )
        );
      await db
        .update(publishingProjects)
        .set({ currentStage: nextPending.stage, status: 'IN_PROGRESS' })
        .where(eq(publishingProjects.id, projectId));
    }

    return {
      updated: true,
      warnings: violations.filter((v) => v.severity === 'WARN'),
    };
  }

  /**
   * Danh sach du an (moi nhat truoc).
   */
  static async list(limit = 50) {
    return db
      .select()
      .from(publishingProjects)
      .orderBy(desc(publishingProjects.createdAt))
      .limit(limit);
  }

  /**
   * Kiem tra timeline hien tai cua du an (khong luu).
   */
  static async checkTimeline(projectId: string): Promise<RuleViolation[]> {
    const { stages } = await this.getById(projectId);
    const stageDates: StageDates[] = stages.map((s) => ({
      stage: s.stage as any,
      contractDate: s.contractDate,
      acceptanceDate: s.acceptanceDate,
      plannedStart: s.plannedStart,
      plannedEnd: s.plannedEnd,
    }));
    return PublishingRules.validate(stageDates);
  }
}
