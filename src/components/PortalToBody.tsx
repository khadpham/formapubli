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
 * Use this instead of calling `createPortal` inline - one pattern, one place to
 * fix when the next clipping bug shows up.
 *
 * Usage:
 *   {open && (
 *     <PortalToBody>
 *       <div className="fixed z-[80] ...">...</div>
 *     </PortalToBody>
 *   )}
 *
 * `className`/`style` on the wrapper are forwarded. THE RULE, learned the hard
 * way: the element that carries the measured `top`/`left` MUST also be the
 * positioned element (`fixed`/`absolute`). They used to be split - `fixed
 * z-[80]` on the wrapper, `top`/`left` on a static child - and the tab menu
 * rendered off screen with no error at all. A `position: fixed` wrapper with no
 * `top`/`left` falls back to its STATIC position, which for the last child of
 * `document.body` is far below the viewport; a static child ignores `top`/`left`
 * outright. scripts/test-mobile-kho-ui.ts asserts this for every call site.
 *
 * Both working shapes are fine, as long as they agree:
 *   A) wrapper carries both:  <PortalToBody className="fixed z-95" style={{top,left}}>
 *   B) child carries both:    <PortalToBody><div className="fixed top-4 left-1/2">
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface PortalToBodyProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export function PortalToBody({ children, className, style, onClick }: PortalToBodyProps) {
  // Gate on mount so SSR/prerender never touches `document`.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div className={className} style={style} onClick={onClick} data-portal-to-body="">
      {children}
    </div>,
    document.body
  );
}

export default PortalToBody;
