'use client';

import { useEffect, useState } from 'react';
import { X, Landmark, Plus } from 'lucide-react';

type BankAccount = { id: string; label: string; bankBin: string; accountNo: string; accountName?: string | null };
type Warehouse = { id: string; code: string; name: string; defaultBankAccountId?: string | null };

export function WarehouseBankManager({ onClose }: { onClose: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newBank, setNewBank] = useState({ label: '', bankBin: '', accountNo: '', accountName: '' });
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const [w, b] = await Promise.all([
      fetch('/api/warehouses?all=true').then((r) => r.json()),
      fetch('/api/bank-accounts').then((r) => r.json()),
    ]);
    if (w?.success && Array.isArray(w.data)) setWarehouses(w.data);
    if (b?.success && Array.isArray(b.data?.list)) setBanks(b.data.list);
    else throw new Error('Không tải được danh sách TK nhận tiền.');
  };

  useEffect(() => { reload().catch(() => {}); }, []);

  const setDefault = async (warehouseId: string, bankAccountId: string) => {
    setSavingId(warehouseId);
    setError(null);
    try {
      const res = await fetch('/api/bank-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, bankAccountId: bankAccountId || null }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || 'Lưu thất bại.');
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const addBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBank),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || 'Thêm TK thất bại.');
      setNewBank({ label: '', bankBin: '', accountNo: '', accountName: '' });
      await reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900">TK Nhận Tiền per-Kho</h3>
              <p className="text-[11px] text-slate-400">1 TK dùng nhiều kho • 1 kho đổi TK bất kỳ</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        {error && <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">{error}</div>}

        <div className="space-y-2">
          {warehouses.map((w) => (
            <div key={w.id} className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-800 truncate">{w.name}</div>
                <div className="text-[10px] font-mono text-slate-400">{w.code}</div>
              </div>
              <select
                value={w.defaultBankAccountId || ''}
                disabled={savingId === w.id}
                onChange={(e) => setDefault(w.id, e.target.value)}
                className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none max-w-[220px]"
              >
                <option value="">— Mặc định chung —</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.label} — {b.accountNo}</option>)}
              </select>
            </div>
          ))}
        </div>

        <form onSubmit={addBank} className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-2xl space-y-2">
          <div className="text-xs font-bold text-indigo-900 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Thêm tài khoản nhận tiền</div>
          <div className="grid grid-cols-2 gap-2">
            <input value={newBank.label} onChange={(e) => setNewBank({ ...newBank, label: e.target.value })} placeholder="Tên gợi nhớ (VD: TK Vietcombank hội chợ)" className="col-span-2 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none" />
            <input value={newBank.bankBin} onChange={(e) => setNewBank({ ...newBank, bankBin: e.target.value })} placeholder="BIN 6 số (VD: 970405)" inputMode="numeric" className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono outline-none" />
            <input value={newBank.accountNo} onChange={(e) => setNewBank({ ...newBank, accountNo: e.target.value })} placeholder="Số tài khoản" inputMode="numeric" className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono outline-none" />
            <input value={newBank.accountName} onChange={(e) => setNewBank({ ...newBank, accountName: e.target.value })} placeholder="Chủ TK (tùy chọn)" className="col-span-2 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none" />
          </div>
          <button type="submit" className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs">Thêm TK</button>
        </form>
      </div>
    </div>
  );
}
