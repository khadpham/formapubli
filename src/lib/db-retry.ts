/**
 * Tiện ích bọc retry tự động với Exponential Backoff và Random Jitter.
 * Chỉ retry các lỗi transient database concurrency (SQLITE_BUSY, database is locked).
 * Tuyệt đối không retry AppError, Validation error, Idempotency conflict, Business logic.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxTotalTimeMs?: number;
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 30,
    initialDelayMs = 25,
    maxDelayMs = 300,
    maxTotalTimeMs = 15000,
  } = options;

  const startTime = Date.now();
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      const errorMessage = (error?.message || '').toLowerCase();
      const errorCode = error?.code || error?.rawCode;

      const isBusyError =
        errorMessage.includes('busy') ||
        errorMessage.includes('locked') ||
        errorMessage.includes('sqlite_busy') ||
        errorCode === 5 ||
        errorCode === 'SQLITE_BUSY';

      const totalElapsed = Date.now() - startTime;
      if (!isBusyError || attempt > maxRetries || totalElapsed >= maxTotalTimeMs) {
        throw error;
      }

      // Full jitter backoff: sleep = minDelay + random_between(0, min(maxDelay, initialDelay * 2^(attempt-1)))
      // Tránh các worker retry cùng nhịp sau khi kết thúc contention, đảm bảo luôn nhường CPU (sleep >= 10ms)
      const maxExponential = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1));
      const sleepTime = 10 + Math.floor(Math.random() * maxExponential);

      console.warn(
        `[DB Retry] SQLITE_BUSY/locked (Lần thử ${attempt}/${maxRetries}, đã qua ${totalElapsed}ms), đợi ${sleepTime}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, sleepTime));
    }
  }
}
