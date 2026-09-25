'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Landmark, Plus, Pencil, Trash2, Power, PowerOff } from 'lucide-react';

type BankAccount = { id: string; label: string; bankBin: string; accountNo: string; accountName?: string | null };
type Warehouse = { id: string; code: string; name: string; address?: string | null; isActive?: boolean; isSellableOnPos?: boolean; warehouseType?: string; stockQuantity?: number; qrTransferTemplate?: string | null; defaultBankAccountId?: string | null };

export function WarehouseBankManager({ onClose }: { onClose: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newBank, setNewBank] = useState({ label: '', bankBin: '', accountNo: '', accountName: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editTemplate, setEditTemplate] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  /** #6: sửa tên/địa chỉ kho, bật/tắt bán trên POS. */
  const patchWarehouse = async (id: string, body: Record<string, unknown>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setSavingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/warehouses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || 'Cập nhật kho thất bại.');
      setNotice(j.message || 'Đã cập nhật kho.');
      setEditingId(null);
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  /** #6: xóa kho rỗng. Kho còn tồn/đơn sẽ bị server chặn kèm lý do cụ thể. */
  const deleteWarehouse = async (w: Warehouse) => {
    if (!window.confirm(`Xóa kho [${w.code}]?\nChỉ xóa được kho RỖNG và chưa có đơn. Kho đang có tồn sẽ được nhắc dùng "Ngưng hoạt động".`)) return;
    setSavingId(w.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/warehouses/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || 'Xóa kho thất bại.');
      setNotice(j.message || 'Đã xóa kho.');
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const addBank = async (e: React.FormEvent) => {    e.preventDefault();
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

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900">Quản Lý Kho & TK Nhận Tiền</h3>
              <p className="text-[11px] text-slate-400">Sửa tên/kho · Ngưng hoạt động · Xóa kho rỗng · Gán TK nhận tiền</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        {error && <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">{error}</div>}
        {notice && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold">{notice}</div>}

        <div className="space-y-2">
          {warehouses.map((w) => (
            <div key={w.id} className="p-2 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              {editingId === w.id ? (
                <div className="space-y-1.5">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Tên kho"
                    className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <input
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    placeholder="Địa chỉ (không bắt buộc)"
                    className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div>
                    <input
                      value={editTemplate}
                      onChange={(e) => setEditTemplate(e.target.value)}
                      placeholder="Mẫu nội dung chuyển khoản (bỏ trống = dùng mã đơn)"
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      Mẫu riêng cho kho này. Biến dùng được: <b>{'{SL}'}</b> số lượng · <b>{'{MA}'}</b> mã đơn ·{' '}
                      <b>{'{KHO}'}</b> tên kho · <b>{'{KH}'}</b> mã kho. Ví dụ: <code className="bg-slate-100 px-1 rounded">{`DH{SL} {KHO}`}</code>
                    </p>
                    {editTemplate && (
                      <p className="text-[10px] text-emerald-700 mt-1">
                        Xem trước (đơn 3 sản phẩm, mã DH00123):{' '}
                        <b>{editTemplate.replace(/\{SL\}/g, '3').replace(/\{MA\}/g, 'DH00123').replace(/\{KHO\}/g, w.name).replace(/\{KH\}/g, w.code)}</b>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => patchWarehouse(w.id, { name: editName, address: editAddress, qrTransferTemplate: editTemplate })}
                      disabled={savingId === w.id}
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-[11px] disabled:opacity-50"
                    >
                      Lưu
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg text-[11px]"
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">
                      {w.name}
                      {w.isActive === false && <span className="ml-1.5 text-[10px] font-bold text-amber-700">(đã ngưng)</span>}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 truncate">
                      {w.code}{w.address ? ` • ${w.address}` : ''}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                        w.warehouseType === 'FAIR_EVENT' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {w.warehouseType === 'FAIR_EVENT' ? 'Hội chợ' : 'Cố định'}
                      </span>
                      <span className={`text-[10px] font-bold ${(w.stockQuantity || 0) > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                        Tồn: {(w.stockQuantity || 0).toLocaleString('vi-VN')} cuốn
                      </span>
                    </div>
                  </div>
                  <button
                    title="Sửa tên / địa chỉ kho"
                    onClick={() => { setEditingId(w.id); setEditName(w.name); setEditAddress(w.address || ''); setEditTemplate(w.qrTransferTemplate || ''); }}
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    title={w.isActive === false ? 'Kích hoạt lại kho' : 'Ngưng hoạt động kho (giữ dữ liệu, không bán trên POS)'}
                    disabled={savingId === w.id}
                    onClick={() => patchWarehouse(w.id, { isActive: w.isActive === false }, `Ngưng hoạt động kho [${w.code}]?`)}
                    className={`p-1.5 rounded-lg disabled:opacity-50 ${w.isActive === false ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700' : 'bg-amber-100 hover:bg-amber-200 text-amber-700'}`}
                  >
                    {w.isActive === false ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    title="Xóa kho (chỉ khi kho rỗng và chưa có đơn)"
                    disabled={savingId === w.id}
                    onClick={() => deleteWarehouse(w)}
                    className="p-1.5 bg-rose-100 hover:bg-rose-200 rounded-lg text-rose-700 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 font-bold shrink-0">TK nhận tiền:</span>
                <select
                  value={w.defaultBankAccountId || ''}
                  disabled={savingId === w.id}
                  onChange={(e) => setDefault(w.id, e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none"
                >
                  <option value="">— Mặc định chung —</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.label} — {b.accountNo}</option>)}
                </select>
              </div>
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
    </div>,
    document.body
  );
}
