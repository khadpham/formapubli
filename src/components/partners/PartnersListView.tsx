'use client';

import React, { useState } from 'react';
import { Users, Building2, Percent, Phone, Mail, Pencil } from 'lucide-react';
import { ConsignmentPanel } from './ConsignmentPanel';
import { QuickSaleReport } from './QuickSaleReport';
import { PartnerDetail, PartnerDetailInfo } from './PartnerDetail';
import { UserRole } from '@/lib/roles';

interface PartnerItem extends PartnerDetailInfo {}

interface PartnersListViewProps {
  partners: PartnerItem[];
  currentRole?: UserRole;
}

const canEditTerms = (role?: UserRole) => role === 'ROLE_OWNER' || role === 'ROLE_MANAGER';

export function PartnersListView({ partners: initialPartners, currentRole = 'ROLE_OWNER' }: PartnersListViewProps) {
  const [list, setList] = useState<PartnerItem[]>(initialPartners);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selected = list.find((p) => p.id === selectedId) || null;

  const startEdit = (p: PartnerItem) => {
    setEditingId(p.id);
    setEditingRate(String(Math.round((p.discountRate || 0) * 100)));
    setSaveError(null);
  };

  const saveRate = async (p: PartnerItem) => {
    const pct = Number(editingRate);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setSaveError('Chiết khấu phải từ 0 đến 100.');
      return;
    }
    try {
      setIsSaving(true);
      setSaveError(null);
      const res = await fetch(`/api/partners/${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-formapubli-role': currentRole },
        body: JSON.stringify({ discountRate: pct / 100 }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không lưu được chiết khấu');
      setList((prev) => prev.map((it) => (it.id === p.id ? { ...it, discountRate: pct / 100 } : it)));
      setEditingId(null);
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="hidden md:flex bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600" />
            Đối Tác & Kênh Phân Phối Sỉ
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý mạng lưới đối tác phát hành, nhà in ấn, NXB liên kết và các đại lý sỉ Đinh Lễ
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            title="Bấm để xem hồ sơ đại lý (tồn quầy, công nợ, kỳ đối soát)"
            className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-purple-300 transition cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-50 text-purple-700 border border-purple-200">
                  {p.code}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                  {p.type}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-slate-900">{p.name}</h3>
              <p className="text-xs text-slate-500 mt-1">
                {p.address || (p.contactInfo ? p.contactInfo.slice(0, 90) : 'Chưa cập nhật thông tin liên hệ')}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">Mức chiết khấu sỉ:</span>
              {editingId === p.id ? (
                <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editingRate}
                    onChange={(e) => setEditingRate(e.target.value)}
                    className="w-16 px-1.5 py-0.5 text-center font-mono font-bold border border-purple-300 rounded-lg text-xs outline-none"
                    aria-label={`Chiết khấu cố định của ${p.name}`}
                  />
                  <span className="text-xs font-bold">%</span>
                  <button
                    type="button"
                    onClick={() => saveRate(p)}
                    disabled={isSaving}
                    className="px-2 py-0.5 bg-purple-600 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
                  >
                    Lưu
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="px-2 py-0.5 text-slate-500 text-[11px]"
                  >
                    Hủy
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm font-black text-purple-700 font-mono">
                  {Math.round((p.discountRate || 0) * 100)}%
                  {canEditTerms(currentRole) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(p);
                      }}
                      title={`Sửa chiết khấu cố định của ${p.name}`}
                      aria-label={`Sửa chiết khấu cố định của ${p.name}`}
                      className="p-1 text-slate-400 hover:text-purple-700 rounded"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </span>
              )}
            </div>
            {saveError && editingId === p.id && (
              <p className="text-[11px] text-rose-600 font-semibold mt-1">{saveError}</p>
            )}
          </div>
        ))}
      </div>

      {selected && (
        <PartnerDetail
          partner={selected}
          currentRole={currentRole}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated: any) =>
            setList((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)))
          }
        />
      )}

      <QuickSaleReport partners={list} currentRole={currentRole} />

      <ConsignmentPanel currentRole={currentRole} />
    </div>
  );
}
