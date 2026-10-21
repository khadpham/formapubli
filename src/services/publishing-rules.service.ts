/**
 * Rule Engine - Kiem tra logic thoi gian du an xuat ban.
 *
 * Chuoi san xuat (theo thu tu, anh Kha chot 2026-10-13):
 *   1. THIET_KE_BIA -> 2. BIEN_DICH -> 3. BIEN_TAP -> 4. DAN_TRANG -> 5. DOC_MORAT
 *
 * 5 rules:
 *   R1: Ngay ky HD giai doan sau khong som hon ngay ky HD giai doan truoc.
 *   R2: Ngay nghiem thu khong som hon ngay ky cung giai doan.
 *   R3: Ngay nghiem thu giai doan sau khong som hon ngay nghiem thu giai doan truoc.
 *   R4: Canh bao khi ngay thuc te lech qua 7 ngay so voi du kien.
 *   R5: Phat hien dau hieu ky lui ngay (ngay ky sau ngay nghiem thu).
 *
 * R1, R2, R3, R5: chan luu (can xac nhan manager).
 * R4: canh bao vang.
 */

export type PublishingStage =
  | 'THIET_KE_BIA'
  | 'BIEN_DICH'
  | 'BIEN_TAP'
  | 'DAN_TRANG'
  | 'DOC_MORAT';

export const STAGE_ORDER: PublishingStage[] = [
  'THIET_KE_BIA',
  'BIEN_DICH',
  'BIEN_TAP',
  'DAN_TRANG',
  'DOC_MORAT',
];

export const STAGE_LABELS: Record<PublishingStage, string> = {
  THIET_KE_BIA: 'Thiết kế bìa',
  BIEN_DICH: 'Biên dịch',
  BIEN_TAP: 'Biên tập',
  DAN_TRANG: 'Dàn trang',
  DOC_MORAT: 'Đọc morat',
};

export interface StageDates {
  stage: PublishingStage;
  contractDate?: string | null;      // Ngay ky hop dong (YYYY-MM-DD)
  acceptanceDate?: string | null;    // Ngay nghiem thu (YYYY-MM-DD)
  plannedStart?: string | null;      // Ngay bat dau du kien
  plannedEnd?: string | null;        // Ngay ket thuc du kien
}

export interface RuleViolation {
  rule: string;                       // R1, R2, R3, R4, R5
  severity: 'BLOCK' | 'WARN';         // BLOCK: chan luu, WARN: canh bao
  stage: PublishingStage;
  message: string;
}

function toTime(s?: string | null): number | null {
  if (!s) return null;
  const t = new Date(s + 'T00:00:00').getTime();
  return isNaN(t) ? null : t;
}

function fmtDate(s?: string | null): string {
  if (!s) return '(chua co)';
  return s;
}

export class PublishingRules {
  /**
   * Kiem tra toan bo timeline cua du an.
   * Tra ve danh sach vi pham (rong = hop le).
   */
  static validate(stages: StageDates[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const byStage = new Map<PublishingStage, StageDates>();
    for (const s of stages) byStage.set(s.stage, s);

    // R2 + R5: kiem tra trong tung giai doan
    for (const s of stages) {
      const cd = toTime(s.contractDate);
      const ad = toTime(s.acceptanceDate);

      // R2: nghiem thu khong som hon ky HD
      if (cd !== null && ad !== null && ad < cd) {
        violations.push({
          rule: 'R2',
          severity: 'BLOCK',
          stage: s.stage,
          message: `${STAGE_LABELS[s.stage]}: ngay nghiem thu (${fmtDate(s.acceptanceDate)}) som hon ngay ky hop dong (${fmtDate(s.contractDate)}).`,
        });
      }

      // R5: dau hieu ky lui ngay (ky sau nghiem thu = bat thuong nghiem trong)
      // Thuc te R2 da bao, nhung R5 nhan manh nguyen nhan: co the do ky lui
      if (cd !== null && ad !== null && cd > ad) {
        violations.push({
          rule: 'R5',
          severity: 'BLOCK',
          stage: s.stage,
          message: `${STAGE_LABELS[s.stage]}: phat hien dau hieu ky lui ngay - ngay ky (${fmtDate(s.contractDate)}) sau ngay nghiem thu (${fmtDate(s.acceptanceDate)}). Can xac nhan cua manager.`,
        });
      }

      // R4: lech qua 7 ngay so voi du kien
      if (s.plannedEnd && ad !== null) {
        const pe = toTime(s.plannedEnd);
        if (pe !== null) {
          const diffDays = Math.round((ad - pe) / 86400000);
          if (Math.abs(diffDays) > 7) {
            violations.push({
              rule: 'R4',
              severity: 'WARN',
              stage: s.stage,
              message: `${STAGE_LABELS[s.stage]}: ngay nghiem thu thuc te lech ${Math.abs(diffDays)} ngay so voi du kien (${fmtDate(s.plannedEnd)}).`,
            });
          }
        }
      }
    }

    // R1 + R3: kiem tra lien giai doan theo thu tu
    for (let i = 1; i < STAGE_ORDER.length; i++) {
      const prev = byStage.get(STAGE_ORDER[i - 1]);
      const curr = byStage.get(STAGE_ORDER[i]);
      if (!prev || !curr) continue;

      // R1: ky HD giai doan sau khong som hon giai doan truoc
      const prevCd = toTime(prev.contractDate);
      const currCd = toTime(curr.contractDate);
      if (prevCd !== null && currCd !== null && currCd < prevCd) {
        violations.push({
          rule: 'R1',
          severity: 'BLOCK',
          stage: curr.stage,
          message: `${STAGE_LABELS[curr.stage]}: ngay ky hop dong (${fmtDate(curr.contractDate)}) som hon giai doan truoc ${STAGE_LABELS[prev.stage]} (${fmtDate(prev.contractDate)}). Sai thu tu chuoi san xuat.`,
        });
      }

      // R3: nghiem thu giai doan sau khong som hon giai doan truoc
      const prevAd = toTime(prev.acceptanceDate);
      const currAd = toTime(curr.acceptanceDate);
      if (prevAd !== null && currAd !== null && currAd < prevAd) {
        violations.push({
          rule: 'R3',
          severity: 'BLOCK',
          stage: curr.stage,
          message: `${STAGE_LABELS[curr.stage]}: ngay nghiem thu (${fmtDate(curr.acceptanceDate)}) som hon nghiem thu giai doan truoc ${STAGE_LABELS[prev.stage]} (${fmtDate(prev.acceptanceDate)}).`,
        });
      }
    }

    return violations;
  }

  /**
   * Kiem tra nhanh mot cap nhat don le co vi pham khong.
   */
  static hasBlockingViolations(violations: RuleViolation[]): boolean {
    return violations.some((v) => v.severity === 'BLOCK');
  }
}
