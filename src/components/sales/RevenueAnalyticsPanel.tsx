'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3, Download, RefreshCw, Wallet, Store, Truck, Globe, Gift } from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { appendExportWatermark } from '@/lib/export-hash';

interface RevenueAnalyticsPanelProps {
  currentRole: UserRole;
}

const CHANNEL_LABELS: Record<string, string> = {
  FAIR_EVENT: 'Bán lẻ — Hội chợ',
  RETAIL_OFFICE: 'Bán lẻ — Văn phòng / Quầy',
  WHOLESALE_PARTNER: 'Bán đại lý (bán đứt)',
  ONLINE: 'Online (tổng hợp cũ)',
  RETAIL_ONLINE_WEB: 'Online — Web',
  RETAIL_ONLINE_SOCIAL: 'Online — Mạng xã hội / Chat',
  SPONSORSHIP: 'Tặng / Tài trợ (0đ)',
};

const SOURCE_GROUPS: { id: string; label: string; channels: string[]; icon: any }[] = [
  { id: 'retail', label: 'Bán lẻ', channels: ['FAIR_EVENT', 'RETAIL_OFFICE'], icon: Store },
  { id: 'wholesale', label: 'Bán đại lý', channels: ['WHOLESALE_PARTNER'], icon: Truck },
  { id: 'online', label: 'Bán online', channels: ['ONLINE', 'RETAIL_ONLINE_WEB', 'RETAIL_ONLINE_SOCIAL'], icon: Globe },
  { id: 'gift', label: 'Tặng / Tài trợ', channels: ['SPONSORSHIP'], icon: Gift },
];

export function RevenueAnalyticsPanel({ currentRole }: RevenueAnalyticsPanelProps) {
  const canView = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [cashflow, setCashflow] = useState<any>(null);
  const [consignment, setConsignment] = useState<any[]>([]);

  const fetchAll = async () => {
    if (!canView) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [cRes, fRes, sRes] = await Promise.all([
        fetch('/api/analytics?view=channels').then((r) => r.json()).catch(() => null),
        fetch('/api/analytics?view=cashflow').then((r) => r.json()).catch(() => null),
        fetch('/api/analytics?view=consignment').then((r) => r.json()).catch(() => null),
      ]);
      const failed: string[] = [];
      if (cRes?.success) setChannels(cRes.data || []);
      else failed.push('kênh');
      if (fRes?.success) setCashflow(fRes.data || null);
      else failed.push('dòng tiền');
      if (sRes?.success) setConsignment(sRes.data || []);
      else failed.push('ký gửi');
      if (failed.length > 0) {
        setLoadError(`Không tải được số liệu ${failed.join(', ')} — kiểm tra mạng rồi bấm Tải lại.`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  if (!canView) return null;

  const totalRevenue = channels.reduce((s, c) => s + Number(c.revenue || 0), 0);
  const groups = SOURCE_GROUPS.map((g) => {
    const rows = channels.filter((c) => g.channels.includes(c.channel));
    const revenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const orders = rows.reduce((s, r) => s + Number(r.orders || 0), 0);
    return { ...g, rows, revenue, orders, share: totalRevenue > 0 ? revenue / totalRevenue : 0 };
  }).sort((a, b) => b.revenue - a.revenue);

  const exportSourceCsv = () => {
    if (channels.length === 0) {
      alert('Chưa có dữ liệu nguồn doanh thu để xuất.');
      return;
    }
    const headers = ['Nhom nguon', 'Kenh', 'So don', 'Doanh thu (VND)', 'Ty trong (%)'];
    // Chan Excel formula injection o ten nhom/kenh.
    const cell = (v: string | number) => {
      const s = `${v ?? ''}`;
      return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`;
    };
    const rawObjects = channels.map((c) => ({
      channel: c.channel,
      orders: Number(c.orders || 0),
      revenue: Number(c.revenue || 0),
      share: Number(c.share || 0),
    }));
    const rows = channels.map((c) => {
      const g = SOURCE_GROUPS.find((x) => x.channels.includes(c.channel));
      return [
        cell(g?.label || ''),
        cell(CHANNEL_LABELS[c.channel] || c.channel),
        Number(c.orders || 0),
        Number(c.revenue || 0),
        (Number(c.share || 0) * 100).toFixed(2),
      ];
    });
    const baseCsv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const watermarked = appendExportWatermark(baseCsv, rawObjects, {
      actorId: 'revenue-analytics',
      actorRole: currentRole,
      reportName: 'BAO CAO NGUON DOANH THU & DONG TIEN (BAN LE / DAI LY / ONLINE / TANG)',
      fiscalScope: 'ALL',
    });
    const blob = new Blob(['\uFEFF' + watermarked], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Nguon_Doanh_Thu_FormaPubli_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            Phân Tích Nguồn Doanh Thu & Dòng Tiền
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Bán lẻ • Đại lý • Online • Tặng/đối tác — kèm tỷ trọng %, COD và ký gửi. Chỉ Chủ sở hữu / Quản lý.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
          <button
            onClick={exportSourceCsv}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất Excel/CSV (hash)
          </button>
        </div>
      </div>

      {/* Bao loi tai — phan biet "tai loi" voi "khong co du lieu" */}
      {loadError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-2">
          <span className="font-medium">{loadError}</span>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition disabled:opacity-50 shrink-0"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Tổng quan dòng tiền */}
      {cashflow && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <p className="text-[11px] font-bold text-emerald-700 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Doanh thu bán hàng</p>
            <p className="text-lg font-black text-emerald-900 font-mono mt-1">{Number(cashflow.salesRevenue || 0).toLocaleString('vi-VN')} đ</p>
            <p className="text-[11px] text-emerald-700">Đã trừ tặng/tài trợ 0đ</p>
          </div>
          <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200">
            <p className="text-[11px] font-bold text-indigo-700">Doanh thu thuần (trừ hoàn)</p>
            <p className="text-lg font-black text-indigo-900 font-mono mt-1">{Number(cashflow.netRevenue || 0).toLocaleString('vi-VN')} đ</p>
            <p className="text-[11px] text-indigo-700">Hoàn đã duyệt đã trừ</p>
          </div>
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-[11px] font-bold text-amber-700">COD chờ về</p>
            <p className="text-lg font-black text-amber-900 font-mono mt-1">{Number(cashflow.codPending || 0).toLocaleString('vi-VN')} đ</p>
            <p className="text-[11px] text-amber-700">Đã về: {Number(cashflow.codReceived || 0).toLocaleString('vi-VN')} đ</p>
          </div>
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
            <p className="text-[11px] font-bold text-rose-700">Sách tặng / tài trợ đã rút</p>
            <p className="text-lg font-black text-rose-900 font-mono mt-1">{Number(cashflow.sponsorshipDrawnQty || 0).toLocaleString('vi-VN')} cuốn</p>
            <p className="text-[11px] text-rose-700">Trị giá bìa: {Number(cashflow.sponsorshipDrawnValue || 0).toLocaleString('vi-VN')} đ</p>
          </div>
        </div>
      )}

      {/* Bảng theo nhóm nguồn */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
            <tr>
              <th className="p-3">Nhóm nguồn</th>
              <th className="p-3">Số đơn</th>
              <th className="p-3">Doanh thu</th>
              <th className="p-3">Tỷ trọng</th>
              <th className="p-3">Chi tiết kênh</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.map((g) => {
              const Icon = g.icon;
              return (
                <tr key={g.id} className="hover:bg-slate-50/70">
                  <td className="p-3 font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Icon className="w-4 h-4 text-indigo-600" />
                    {g.label}
                  </td>
                  <td className="p-3 font-mono font-bold">{g.orders.toLocaleString('vi-VN')}</td>
                  <td className="p-3 font-mono font-bold text-emerald-700">{g.revenue.toLocaleString('vi-VN')} đ</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(g.share * 100)}%` }} />
                      </div>
                      <span className="font-mono font-bold text-slate-800">{(g.share * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-slate-600">
                    {g.rows.length === 0 ? (
                      <span className="text-slate-400">Chưa phát sinh</span>
                    ) : (
                      g.rows.map((r: any) => (
                        <div key={r.channel} className="flex justify-between gap-3 py-0.5">
                          <span>{CHANNEL_LABELS[r.channel] || r.channel} ({Number(r.orders || 0)} đơn)</span>
                          <span className="font-mono font-semibold">{Number(r.revenue || 0).toLocaleString('vi-VN')} đ • {(Number(r.share || 0) * 100).toFixed(1)}%</span>
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ký gửi đại lý */}
      {consignment.length > 0 && (
        <div className="overflow-x-auto">
          <h4 className="text-xs font-extrabold text-slate-900 mb-2">Hàng ký gửi tại đại lý (wh-consign-*)</h4>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
              <tr>
                <th className="p-3">Kho ký gửi</th>
                <th className="p-3">Đang giữ (cuốn)</th>
                <th className="p-3">Giá trị bìa ước tính</th>
                <th className="p-3">Đã bán kỳ này</th>
                <th className="p-3">Số SKU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {consignment.map((c: any) => (
                <tr key={c.warehouseId} className="hover:bg-slate-50/70">
                  <td className="p-3 font-bold text-slate-900">{c.warehouseName || c.warehouseId}</td>
                  <td className="p-3 font-mono">{Number(c.heldQty || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 font-mono">{Number(c.heldValue || 0).toLocaleString('vi-VN')} đ</td>
                  <td className="p-3 font-mono font-bold text-emerald-700">{Number(c.soldQty || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 font-mono">{Number(c.skuCount || 0).toLocaleString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Nguồn số liệu: đơn COMPLETED (trừ SPONSORSHIP khỏi doanh thu bán), COD theo trạng thái, tặng theo quỹ tài trợ rút. File xuất kèm hash kiểm toàn vẹn.
      </p>
    </div>
  );
}
