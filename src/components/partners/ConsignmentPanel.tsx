'use client';

import React, { useState, useEffect } from 'react';
import { Handshake, RefreshCw, Banknote, XCircle } from 'lucide-react';
import { UserRole } from '@/lib/roles';

interface ConsignmentPanelProps {
  currentRole: UserRole;
}

export function ConsignmentPanel({ currentRole }: ConsignmentPanelProps) {
  const [statements, setStatements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [balance, setBalance] = useState<any | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [reference, setReference] = useState('');
  const [acting, setActing] = useState(false);

  if (currentRole === 'ROLE_WAREHOUSE') {
    return <p className="p-4 text-center text-xs text-slate-400">Thủ kho bị chặn 403 ở sổ ký gửi.</p>;
  }

  const fetchStatements = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/consignments?limit=50', { headers: { 'x-formapubli-role': currentRole } });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setStatements(data.data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  const fetchBalance = async (id: string) => {
    setSelectedId(id);
    try {
      const res = await fetch(`/api/settlements?statementId=${encodeURIComponent(id)}`, {
        headers: { 'x-formapubli-role': currentRole },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setBalance(data.data);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const submitPayment = async () => {
    if (!selectedId || !amount) return;
    setActing(true);
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-formapubli-role': currentRole },
        body: JSON.stringify({
          action: 'record',
          statementId: selectedId,
          amount: Number(amount),
          paymentMethod: method,
          reference: reference || `REF-${Date.now()}`,
          receivedBy: currentRole,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAmount('');
      setReference('');
      fetchBalance(selectedId);
      fetchStatements();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActing(false);
    }
  };

  const voidPayment = async (id: string) => {
    const reason = prompt(`Hủy phiếu thu ${id}? Nhập lý do bắt buộc:`);
    if (!reason) return;
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-formapubli-role': currentRole },
        body: JSON.stringify({ action: 'void', settlementId: id, voidReason: reason, actorId: currentRole }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (selectedId) fetchBalance(selectedId);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Handshake className="w-4 h-4 text-purple-600" />
          Sổ Ký Gửi & Công Nợ Phải Thu (AR)
        </h3>
        <button onClick={fetchStatements} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <p className="px-4 py-2 text-xs text-rose-600 bg-rose-50">{error}</p>}
      {loading ? (
        <p className="p-4 text-center text-xs text-slate-400">Đang tải kỳ đối soát...</p>
      ) : statements.length === 0 ? (
        <p className="p-4 text-center text-xs text-slate-400">Chưa có kỳ DRAFT/CONFIRMED nào. Tạo kỳ bằng API khi cần.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100">
              <tr>
                <th className="px-3 py-2">Kỳ</th>
                <th className="px-3 py-2">Đại lý</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2 text-right">AR phải thu</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statements.slice(0, 20).map((s: any) => (
                <tr key={s.id} className={selectedId === s.id ? 'bg-purple-50/60' : 'hover:bg-slate-50/60'}>
                  <td className="px-3 py-2 font-mono font-bold text-slate-900">{s.id}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{s.partnerId}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : s.status === 'CONFIRMED' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{Number(s.totalAr ?? s.arAmount ?? 0).toLocaleString('vi-VN')} đ</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => fetchBalance(s.id)} className="px-2 py-1 text-[11px] font-bold text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50">
                      Thu tiền
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {balance && (
        <div className="border-t border-slate-200 p-4 bg-slate-50/60 space-y-2">
          <p className="text-xs font-extrabold text-slate-900">
            Dư nợ {selectedId}: còn {(balance.remaining ?? 0).toLocaleString('vi-VN')} đ / tổng {(balance.totalAr ?? 0).toLocaleString('vi-VN')} đ
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={1} placeholder="Số tiền thu" className="w-32 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-mono" />
            <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-semibold">
              <option value="CASH">Tiền mặt</option>
              <option value="BANK_TRANSFER">Chuyển khoản</option>
            </select>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Mã tham chiếu" className="w-40 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
            <button disabled={acting || !amount} onClick={submitPayment} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1">
              <Banknote className="w-3.5 h-3.5" /> {acting ? 'Đang thu...' : 'Lập phiếu thu'}
            </button>
          </div>
          <div className="space-y-1">
            {(balance.payments || []).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between text-[11px] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                <span className="font-mono font-bold">{p.id} • {Number(p.amount).toLocaleString('vi-VN')} đ • {p.paymentMethod} • {p.status}</span>
                {p.status === 'VALID' && (currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && (
                  <button onClick={() => voidPayment(p.id)} className="text-rose-600 hover:text-rose-800 flex items-center gap-1 font-bold">
                    <XCircle className="w-3.5 h-3.5" /> Void
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
