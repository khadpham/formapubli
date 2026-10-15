'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, Clock, XCircle } from 'lucide-react';
import Modal from '../ui/Modal';

interface InventoryCountListModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onView?: (countId: string) => void;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Nháp', color: 'bg-slate-100 text-slate-600' },
  COUNTING: { label: 'Đang đếm', color: 'bg-blue-100 text-blue-700' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', color: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'Đã duyệt', color: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Đã hủy', color: 'bg-rose-100 text-rose-700' },
};

export function InventoryCountListModal({ open, onClose, onSuccess, onView }: InventoryCountListModalProps) {
  const [counts, setCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/inventory/counts');
      const data = await res.json();
      if (data.ok) setCounts(data.data || []);
      else throw new Error(data.error);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const handleApprove = async (id: string) => {
    if (!confirm('Duyệt đợt kiểm kê này? Hệ thống sẽ tạo bút toán điều chỉnh.')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/counts/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      alert(data.message);
      await load();
      onSuccess?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Hủy đợt kiểm kê này? Thao tác không thể hoàn tác.')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/counts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      alert(data.message);
      await load();
      onSuccess?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Đợt kiểm kê" subtitle="Danh sách và phê duyệt" size="md">
      <div className="space-y-2">
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {loading && counts.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">Đang tải...</p>
        ) : counts.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">Chưa có đợt kiểm kê nào</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {counts.map(c => {
              const st = STATUS_LABEL[c.status] || STATUS_LABEL.DRAFT;
              return (
                <div key={c.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-bold">{c.note || 'Kiểm kê kho'}</p>
                    <p className="text-xs text-slate-500">
                      {c.createdAt ? new Date(c.createdAt).toLocaleString('vi-VN') : ''}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${st.color}`}>
                    {st.label}
                  </span>
                  {c.status === 'PENDING_APPROVAL' && (
                    <button
                      onClick={() => handleApprove(c.id)}
                      disabled={loading}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      Duyệt
                    </button>
                  )}
                  {(c.status === 'DRAFT' || c.status === 'COUNTING') && onView && (
                    <button
                      onClick={() => onView(c.id)}
                      disabled={loading}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      {c.status === 'COUNTING' ? 'Tiếp tục' : 'Xem'}
                    </button>
                  )}
                  {(c.status === 'DRAFT' || c.status === 'COUNTING') && (
                    <button
                      onClick={() => handleCancel(c.id)}
                      disabled={loading}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      Hủy
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button
          onClick={load}
          disabled={loading}
          className="w-full py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>
    </Modal>
  );
}
