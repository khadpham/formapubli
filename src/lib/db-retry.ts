/**
 * Tiện ích bọc retry tự động với Exponential Backoff và Random Jitter
 * Giúp giải quyết xung đột khóa ghi (SQLITE_BUSY, database is locked)
 * khi nhiều thiết bị thu ngân cùng đồng bộ đơn hàng về máy chủ tại hội chợ.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 50, maxDelayMs = 300 } = options;

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

      if (!isBusyError || attempt > maxRetries) {
        throw error;
      }

      // Exponential backoff with jitter: delay = min(maxDelay, initialDelay * 2^(attempt-1)) + random jitter
      const exponentialDelay = initialDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 30);
      const sleepTime = Math.min(maxDelayMs, exponentialDelay + jitter);

      console.warn(
        `[DB Retry] Phát hiện SQLITE_BUSY (Lần thử ${attempt}/${maxRetries}), đang đợi ${sleepTime}ms trước khi thử lại...`
      );

      await new Promise((resolve) => setTimeout(resolve, sleepTime));
    }
  }
}
