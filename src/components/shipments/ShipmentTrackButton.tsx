'use client';

import React from 'react';
import { Truck } from 'lucide-react';

/** Base tra cứu SPX — team đối chiếu lại với tài liệu SPX khi có AppKey. */
export const SPX_TRACK_URL_BASE = 'https://spx.vn/track';

export function buildTrackingUrl(carrier: string | null, trackingCode: string | null): string | null {
  if (!carrier || !trackingCode) return null;
  if (carrier === 'SPX') return `${SPX_TRACK_URL_BASE}?code=${encodeURIComponent(trackingCode)}`;
  return null;
}

/**
 * Bước 2 — Nút tra cứu vận đơn 1-click (team wire vào màn chi tiết đơn).
 * Không fetch gì, chỉ mở link tracking.
 */
export function ShipmentTrackButton({
  carrier,
  trackingCode,
}: {
  carrier: string | null;
  trackingCode: string | null;
}) {
  const url = buildTrackingUrl(carrier, trackingCode);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition"
      title={`Tra cứu ${carrier} — ${trackingCode}`}
    >
      <Truck className="w-4 h-4" />
      <span>Tra cứu {carrier} ({trackingCode})</span>
    </a>
  );
}
