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

  const message = (err as any)?.message || 'Lỗi xử lý yêu cầu';
  return NextResponse.json(
    {
      success: false,
      code: 'INTERNAL_ERROR',
      error: message,
    },
    { status: 500 }
  );
}
