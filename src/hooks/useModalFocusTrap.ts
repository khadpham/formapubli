import { RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocusTrap<T extends HTMLElement>(isOpen: boolean, onClose?: () => void): RefObject<T> {
  const containerRef = useRef<T>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const mainContent = document.getElementById('app-main-content');
    const mainWasInert = mainContent?.hasAttribute('inert') || false;
    const mainWasHidden = mainContent?.getAttribute('aria-hidden');
    mainContent?.setAttribute('inert', '');
    mainContent?.setAttribute('aria-hidden', 'true');

    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const initialFocusable = getFocusable();
    if (initialFocusable.length > 0) initialFocusable[0]?.focus();
    else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (!mainWasInert) mainContent?.removeAttribute('inert');
      if (mainWasHidden == null) mainContent?.removeAttribute('aria-hidden');
      else mainContent?.setAttribute('aria-hidden', mainWasHidden);
      previousFocus?.focus();
    };
  }, [isOpen]);

  return containerRef;
}
