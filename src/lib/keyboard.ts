/**
 * Cross-platform Keyboard Shortcuts Helper (macOS & Windows/Linux)
 * 
 * Giải quyết triệt để lỗi phím tắt trên macOS:
 * 1. Trên macOS, phím Option (Alt) tự động sinh ra ký tự đặc biệt (Option+1 -> '¡', Option+C -> 'ç', Option+Shift+T -> 'ˇ').
 *    Do đó, bắt buộc phải dùng `e.code` ('Digit1', 'KeyC', 'KeyT'...) thay vì `e.key`.
 * 2. Trên macOS, chỉ dùng phím Option (⌥, altKey).
 *    KHÔNG dùng Command (⌘): trình duyệt giữ Cmd+1..8 (chuyển tab),
 *    Cmd+Shift+T (mở lại tab), Cmd+Shift+C (DevTools)... nên trang web
 *    không bao giờ nhận được keydown cho các tổ hợp đó.
 */

export function isMacPlatform(customUserAgent?: string): boolean {
  if (typeof customUserAgent === 'string') {
    return /Mac|iPod|iPhone|iPad/i.test(customUserAgent);
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    const platform = (navigator as any).userAgentData?.platform || navigator.platform || '';
    return /Mac|iPod|iPhone|iPad/i.test(ua) || /Mac|iPod|iPhone|iPad/i.test(platform);
  }
  return false;
}

const DIGIT_CODES: Record<string, string> = {
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
};

/**
 * Bắt phím tắt chuyển Tab 1..8:
 * - Windows: Alt + 1..8
 * - macOS: Option + 1..8 (KHÔNG dùng Cmd: trình duyệt nuốt trước để chuyển tab)
 */
export function matchNavShortcut(e: KeyboardEvent, forceMac?: boolean): string | null {
  // Đang gõ trong ô nhập liệu thì không nhảy tab (tránh mất ngữ cảnh thu ngân)
  if (isEditableTarget(e)) return null;

  // Xác định chữ số từ code ('Digit1'..'Digit8') hoặc key ('1'..'8')
  const digit = DIGIT_CODES[e.code] || (/^[1-8]$/.test(e.key) ? e.key : null);
  if (!digit) return null;

  // Win Alt+[1-8], Mac Option+[1-8]: altKey và không kèm Ctrl/Meta
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    return digit;
  }

  return null;
}

/** true khi focus đang nằm trong ô nhập liệu (không cướp phím khi đang gõ). */
function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.tagName !== 'string') return false;
  const tag = t.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

interface ActionShortcutOptions {
  shift?: boolean;
  isMac?: boolean;
}

/**
 * Bắt phím tắt chức năng (Action shortcuts):
 * Ví dụ:
 * - targetCode = 'KeyC' (Copilot)
 * - targetCode = 'KeyV' (Voice search)
 * - targetCode = 'KeyT' (Chuyển kho) với shift=true
 * - targetCode = 'KeyR' (Nhập in) với shift=true
 * - targetCode = 'KeyX' (Xuất bán) với shift=true
 */
export function matchActionShortcut(
  e: KeyboardEvent,
  targetCode: string,
  options?: ActionShortcutOptions
): boolean {
  const requireShift = Boolean(options?.shift);

  if (Boolean(e.shiftKey) !== requireShift) {
    return false;
  }

  // Khớp code vật lý (KeyC, KeyV, KeyT...)
  // Hoặc fallback kiểm tra e.key khi không bị Mac Option composing
  const letter = targetCode.replace(/^Key/, '').toUpperCase();
  const codeMatches = e.code === targetCode || e.key.toUpperCase() === letter;

  if (!codeMatches) return false;

  // Win Alt+[Shift]+[Key], Mac Option+[Shift]+[Key] (không Cmd: trình duyệt giữ).
  // Cố ý KHÔNG guard ô nhập liệu ở đây: Ctrl+Enter chốt đơn phải bấm được khi đang gõ.
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    return true;
  }

  return false;
}

/**
 * Trả về chuỗi hiển thị phím tắt đẹp mắt, tương ứng từng hệ điều hành:
 * - Windows: 'Alt+Shift+T', 'Alt+1'
 * - macOS: '⌥⇧T', '⌥1'
 */
export function getShortcutLabel(
  key: string,
  modifiers: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean },
  forceMac?: boolean
): string {
  const isMac = forceMac !== undefined ? forceMac : isMacPlatform();

  if (isMac) {
    let label = '';
    if (modifiers.ctrl) label += '⌃';
    if (modifiers.alt) label += '⌥';
    if (modifiers.shift) label += '⇧';
    if (modifiers.meta) label += '⌘';
    return `${label}${key.toUpperCase()}`;
  }

  const parts: string[] = [];
  if (modifiers.ctrl) parts.push('Ctrl');
  if (modifiers.alt) parts.push('Alt');
  if (modifiers.shift) parts.push('Shift');
  parts.push(key.toUpperCase());
  return parts.join('+');
}
