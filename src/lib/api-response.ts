import { NextResponse } from 'next/server';
import { AppError, ErrorCode } from '@/services/app-error';
import { AuthError } from '@/lib/auth-session';

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const statusMap: Record<ErrorCode, number> = {
      AUTH_REQUIRED: 401,
      FORBIDDEN: 403,
      INVALID_INPUT: 400,
      INSUFFICIENT_ATP: 409,
      STATE_CONFLICT: 409,
      IDEMPOTENCY_CONFLICT: 409,
      OVER_RETURN_LIMIT: 409,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
    };
    const status = statusMap[err.code] || 400;
    return NextResponse.json(
      {
        success: false,
        code: err.code,
        error: err.message,
        details: err.details,
      },
      { status }
    );
  }

  if (err instanceof AuthError) {
    const code: ErrorCode = err.status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN';
    return NextResponse.json(
      {
        success: false,
        code,
        error: err.message,
      },
      { status: err.status }
    );
  }

  // Production: không rò chi tiết lỗi nội bộ (DB/SQL/stack) ra client.
  // Dev/test giữ message gốc để debug. Server luôn log đầy đủ ở console.
  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd ? 'Lỗi hệ thống, vui lòng thử lại.' : (err as any)?.message || 'Lỗi xử lý yêu cầu';
  if (isProd) console.error('[api] INTERNAL_ERROR:', (err as Error)?.stack || err);
  return NextResponse.json(
    {
      success: false,
      code: 'INTERNAL_ERROR',
      error: message,
    },
    { status: 500 }
  );
}
