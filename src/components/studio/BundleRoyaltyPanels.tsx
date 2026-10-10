'use client';

import React, { useState, useEffect } from 'react';
import { Package, Scale } from 'lucide-react';
import { UserRole } from '@/lib/roles';

export function BundleRoyaltyPanels({ currentRole }: { currentRole: UserRole }) {
  const [bundles, setBundles] = useState<any[]>([]);
  const [royalties, setRoyalties] = useState<any[]>([]);
  // Phân biệt "bị chặn quyền" với "tải lỗi" và "chưa có dữ liệu". Trước đây mọi
  // lỗi (403, 500, mất mạng) đều rơi vào `catch` và hiện "bị chặn 403" - một
  // chẩn đoán sai khiến người dùng đi tìm vấn đề quyền trong khi server đã chết.
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [royaltyError, setRoyaltyError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/bundles')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setBundles(d.data || []);
        else setBundleError(d.error || 'Không tải được danh sách combo.');
      })
      .catch(() => setBundleError('Không kết nối được máy chủ - kiểm tra mạng rồi tải lại trang.'));
    fetch('/api/royalties?lifecycle=ACTIVE', { headers: { 'x-formapubli-role': currentRole } })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setRoyalties(d.data || []);
        else setRoyaltyError(d.error || 'Không tải được danh sách hợp đồng bản quyền.');
      })
      .catch(() => setRoyaltyError('Không kết nối được máy chủ - kiểm tra mạng rồi tải lại trang.'));
  }, [currentRole]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <Package className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-extrabold text-slate-900">Combo / Boxset đang bán</h3>
          <span className="ml-auto text-[10px] text-slate-400">read-only • bottleneck ở POS sprint sau</span>
        </div>
        {bundleError ? (
          <p className="p-4 text-xs text-rose-700">Không tải được combo - {bundleError}</p>
        ) : bundles.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">Chưa định nghĩa combo nào (tạo qua POST /api/bundles).</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {bundles.slice(0, 10).map((b: any) => (
              <div key={b.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-slate-900">{b.code}</p>
                  <p className="text-[11px] text-slate-500 truncate">{b.seasonName} • {b.releaseDate || ''}</p>
                </div>
                <span className="font-mono text-xs font-bold text-indigo-700 shrink-0">
                  {Number(b.comboPrice || 0).toLocaleString('vi-VN')} đ
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-extrabold text-slate-900">Bản quyền & Nhuận bút</h3>
          <span className="ml-auto text-[10px] text-slate-400">Owner/Manager</span>
        </div>
        {royaltyError ? (
          <p className="p-4 text-xs text-rose-700">Không tải được hợp đồng bản quyền - {royaltyError}</p>
        ) : royalties.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">Chưa có hợp đồng ACTIVE nào.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {royalties.slice(0, 10).map((c: any) => (
              <div key={c.id} className="px-4 py-2.5">
                <p className="font-mono text-xs font-bold text-slate-900">{c.contractNumber || c.id}</p>
                <p className="text-[11px] text-slate-500">
                  {c.licensorName || ''} • rate {Math.round(Number(c.royaltyRate || 0) * 100)}% • quota {c.printQuota ?? '-'}
                </p>
                {/* Cơ sở tính tiền: mặc định NET_SOLD (tiền thực thu sau chiết khấu).
                    Hiện rõ để khi đối chiếu bảng kê với tác giả không phải đoán. */}
                <p className="text-[11px] text-amber-700">
                  Cơ sở: {c.royaltyBasis === 'COVER_PRICE' ? 'Giá bìa' : 'Tiền thực thu (sau chiết khấu)'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
