'use client';

import React, { useEffect, useState } from 'react';
import type { UserRole } from '@/lib/roles';

interface QueueOrder {
  orderSn: string;
  customerName: string;
  finalAmount: number;
  paymentMethod: string;
  carrier: string | null;
}

/**
 * Tab Shopee — view vận hành lọc trên API có sẵn.
 * Nút Giao/In đầy đủ + đơn lỗi + thẻ doanh thu link chờ: Task 4.
 */
export function ShopeeTab({ sessionRole }: { sessionRole: UserRole }) {
  const [queue, setQueue] = useState<QueueOrder[]>([]);

  useEffect(() => {
    fetch('/api/shopee/queue')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setQueue(j.data.toPack || []);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
          Đơn Shopee cần gói ({queue.length})
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Vai trò: {sessionRole}. Chỉ đơn trong kho được cấp.
        </p>
      </div>
    </div>
  );
}
