'use client';

/**
 * THE single portal pattern for floating surfaces in this app.
 *
 * Why this exists: a dropdown/menu/popover/toast is only ever as safe as its
 * weakest ancestor. Anything absolutely positioned inside a card that carries
 * `overflow-hidden`, `overflow-x/y-auto`, or a `transform`/`filter` (which
 * creates a containing block) gets CLIPPED, silently, on some viewports. This
 * has bitten the Kho hang screen repeatedly: a nested flex tab pill, then the
 * BatchTransferModal book picker living inside an `overflow-hidden` modal.
 *
 * `createPortal(..., document.body)` is the only reliable escape: the root
 * element's own box is the viewport, so no intermediate ancestor can clip it.
 * Use this instead of calling `createPortal` inline — one pattern, one place to
 * fix when the next clipping bug shows up.
 *
 * Usage:
 *   {open && (
 *     <PortalToBody>
 *       <div className="fixed z-[80] ...">...</div>
 *     </PortalToBody>
 *   )}
 *
 * `className`/`style` on the wrapper are forwarded so callers can pin it with
 * `fixed` + measured coordinates; the wrapper itself is inert.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface PortalToBodyProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function PortalToBody({ children, className, style }: PortalToBodyProps) {
  // Gate on mount so SSR/prerender never touches `document`.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div className={className} style={style} data-portal-to-body="">
      {children}
    </div>,
    document.body
  );
}

export default PortalToBody;
