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
    maxRetries = 20,
    initialDelayMs = 25,
    maxDelayMs = 250,
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

      // Exponential backoff with jitter: delay = min(maxDelay, initialDelay * 2^(attempt-1)) + random jitter
      const exponentialDelay = initialDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 40);
      const sleepTime = Math.min(maxDelayMs, exponentialDelay + jitter);

      console.warn(
        `[DB Retry] SQLITE_BUSY/locked (Lần thử ${attempt}/${maxRetries}, đã qua ${totalElapsed}ms), đợi ${sleepTime}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, sleepTime));
    }
  }
}
