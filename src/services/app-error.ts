/**
 * Lane B — Lỗi nghiệp vụ có cấu trúc (theo docs/PHASE0_CONTRACT.md §2).
 * Service ném AppError mang `code`; Lane A map code → HTTP + JSON.
 * Message tiếng Việt giữ nguyên để test cũ (match chuỗi) và log không đổi.
 */
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'INSUFFICIENT_ATP'
  | 'STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'OVER_RETURN_LIMIT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  code: ErrorCode;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  static invalid(message: string, details?: unknown): AppError {
    return new AppError('INVALID_INPUT', message, details);
  }

  static atp(message: string, details?: unknown): AppError {
    return new AppError('INSUFFICIENT_ATP', message, details);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('STATE_CONFLICT', message, details);
  }

  static forbidden(message: string, details?: unknown): AppError {
    return new AppError('FORBIDDEN', message, details);
  }

  static idempotency(message: string, details?: unknown): AppError {
    return new AppError('IDEMPOTENCY_CONFLICT', message, details);
  }

  static overReturnLimit(message = 'Số lượng trả vượt quá giới hạn đơn hàng gốc', details?: unknown): AppError {
    return new AppError('OVER_RETURN_LIMIT', message, details);
  }
}
