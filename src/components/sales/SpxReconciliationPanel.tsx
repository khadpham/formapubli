'use client';

import React, { useState } from 'react';
import { Truck, Upload, Check, X } from 'lucide-react';
import { UserRole } from '@/lib/roles';

interface SpxMatchInfo {
  codKhop: boolean;
  phiBatThuong: boolean;
  matchType: string;
  note: string | null;
  orderCode: string | null;
  orderCod: number | null;
  orderFee: number | null;
}

interface SpxItem {
  id: string;
  maVanDon: string;
  trangThai: string | null;
  tienThuHo: number;
  tongPhi: number;
  soTienDieuChinh: number;
  lyDoDieuChinh: string | null;
  tongTienVe: number;
  status: 'CLEAN' | 'REVIEW' | 'UNPROCESSED';
  match: SpxMatchInfo | null;
}

const STATUS_STYLE: Record<string, string> = {
  CLEAN: 'bg-emerald-100 text-emerald-800',
  REVIEW: 'bg-amber-100 text-amber-800',
  UNPROCESSED: 'bg-slate-100 text-slate-600',
};

const STATUS_LABEL: Record<string, string> = {
  CLEAN: 'Sạch',
  REVIEW: 'Chờ review',
  UNPROCESSED: 'Chưa xử lý',
};

const fmt = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/** Panel doi soat SPX (tab Tai chinh, chi Chu/Quan ly). */
export function SpxReconciliationPanel({ currentRole }: { currentRole: UserRole }) {
  const [items, setItems] = useState<SpxItem[]>([]);
  const [counts, setCounts] = useState({ CLEAN: 0, REVIEW: 0, UNPROCESSED: 0 });
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (currentRole !== 'ROLE_OWNER' && currentRole !== 'ROLE_MANAGER') return null;

  const load = async (f = filter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/spx-settlements?status=${f}&limit=100`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setItems(json.data.items || []);
      setCounts(json.data.counts || { CLEAN: 0, REVIEW: 0, UNPROCESSED: 0 });
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doImport = async (file: File) => {
    setLoading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/finance/spx-settlements/import', { method: 'POST', body: form });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const d = json.data;
      setMessage(`Nhập ${d.imported} vận đơn (bỏ ${d.skipped}): sạch ${d.clean}, chờ duyệt ${d.needReview}, chưa thấy đơn ${d.unmatched}.`);
      setOpen(true);
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  };

  const act = async (id: string, action: 'confirm' | 'skip') => {
    try {
      const res = await fetch(`/api/finance/spx-settlements/${id}/${action}`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await load();
    } catch (e: any) {
      setMessage(e.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Truck className="w-4 h-4 text-sky-600" />
          Đối soát SPX
          <span className="text-[11px] font-bold text-slate-500">
            {counts.CLEAN} sạch / {counts.REVIEW} chờ duyệt / {counts.UNPROCESSED} chưa xử lý
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Nhập báo cáo</span>
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
          </label>
          <button type="button" onClick={() => { setOpen(!open); if (!open) load(); }} className="px-3 py-2 min-h-[44px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">
            {open ? 'Thu gọn' : 'Mở sổ'}
          </button>
        </div>
      </div>
      {message && <p className="text-xs text-slate-600 mt-2">{message}</p>}
      {open && (
        <div className="mt-3">
          <div className="flex gap-1.5 mb-2">
            {['ALL', 'REVIEW', 'CLEAN', 'UNPROCESSED'].map((f) => (
              <button key={f} type="button" onClick={() => { setFilter(f); load(f); }}
                className={`px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold ${filter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {f === 'ALL' ? 'Tất cả' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="p-2">Vận đơn</th>
                  <th className="p-2">Trạng thái GH</th>
                  <th className="p-2 text-right">COD thu hộ</th>
                  <th className="p-2 text-right">Phí</th>
                  <th className="p-2 text-right">Điều chỉnh</th>
                  <th className="p-2">Trạng thái</th>
                  <th className="p-2">Đơn / Ghi chú</th>
                  <th className="p-2">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((st) => (
                  <tr key={st.id} className="border-t border-slate-100">
                    <td className="p-2 font-mono whitespace-nowrap">{st.maVanDon}</td>
                    <td className="p-2">{st.trangThai}</td>
                    <td className="p-2 text-right font-bold text-emerald-700">{fmt(st.tienThuHo)}</td>
                    <td className="p-2 text-right">{fmt(st.tongPhi)}</td>
                    <td className="p-2 text-right text-amber-700">{st.soTienDieuChinh ? fmt(st.soTienDieuChinh) : ''}</td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[st.status]}`}>{STATUS_LABEL[st.status]}</span></td>
                    <td className="p-2 text-[11px]">
                      {st.match?.orderCode || ''}
                      {st.match?.note && <div className="text-slate-500">{st.match.note}</div>}
                      {st.soTienDieuChinh ? <div className="text-amber-700">ĐC: {st.lyDoDieuChinh || 'chưa rõ lý do'}</div> : null}
                    </td>
                    <td className="p-2">
                      {st.status === 'REVIEW' && (
                        <div className="flex flex-wrap gap-1">
                          <button type="button" onClick={() => act(st.id, 'confirm')} aria-label="Duyệt dòng SPX"
                            className="flex items-center gap-1 px-2 py-2 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold">
                            <Check className="w-3.5 h-3.5" /> Duyệt
                          </button>
                          <button type="button" onClick={() => act(st.id, 'skip')} aria-label="Bỏ qua dòng SPX"
                            className="flex items-center gap-1 px-2 py-2 min-h-[44px] bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-bold">
                            <X className="w-3.5 h-3.5" /> Bỏ
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && !loading && <p className="text-xs text-slate-500 p-3">Chưa có dòng nào. Nhập báo cáo SPX để bắt đầu.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
