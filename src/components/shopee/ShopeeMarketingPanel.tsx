'use client';

import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, Tag, Percent, Package, Zap, Gift } from 'lucide-react';

type MktType = 'VOUCHER' | 'DISCOUNT' | 'BUNDLE' | 'ADDON' | 'FLASH_SALE';

interface MktItem {
  id: string;
  type: MktType;
  name: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  shopeeId: string | null;
  startAt: string | null;
  endAt: string | null;
  config: Record<string, unknown>;
  createdAt: string;
}

const TABS: Array<{ key: MktType; label: string; icon: React.ReactNode }> = [
  { key: 'VOUCHER', label: 'Voucher', icon: <Tag size={15} /> },
  { key: 'DISCOUNT', label: 'Giảm giá', icon: <Percent size={15} /> },
  { key: 'BUNDLE', label: 'Combo KM', icon: <Package size={15} /> },
  { key: 'ADDON', label: 'Mua kèm', icon: <Gift size={15} /> },
  { key: 'FLASH_SALE', label: 'Flash Sale', icon: <Zap size={15} /> },
];

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  ONGOING: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-gray-100 text-gray-400',
  CANCELLED: 'bg-red-100 text-red-600',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function inputCls() {
  return 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none';
}

export function ShopeeMarketingPanel({ onToast }: { onToast: (m: string) => void }) {
  const [tab, setTab] = useState<MktType>('VOUCHER');
  const [items, setItems] = useState<MktItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [fName, setFName] = useState('');
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  // Voucher
  const [fCode, setFCode] = useState('');
  const [fRewardType, setFRewardType] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [fValue, setFValue] = useState('');
  const [fMinBasket, setFMinBasket] = useState('');
  const [fQty, setFQty] = useState('100');
  // Discount / Bundle / Addon
  const [fDiscountType, setFDiscountType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [fTier1Qty, setFTier1Qty] = useState('2');
  const [fTier1Off, setFTier1Off] = useState('10');
  const [fMaxPerBuyer, setFMaxPerBuyer] = useState('5');
  const [saving, setSaving] = useState(false);

  const load = async (t: MktType) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/shopee/marketing?type=${t}`).then((x) => x.json());
      if (r?.success) setItems(r.data || []);
      else setError(r?.error || 'Tải thất bại.');
    } catch {
      setError('Tải thất bại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(tab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  const resetForm = () => {
    setFName(''); setFStart(''); setFEnd('');
    setFCode(''); setFRewardType('AMOUNT'); setFValue(''); setFMinBasket(''); setFQty('100');
    setFDiscountType('PERCENT'); setFTier1Qty('2'); setFTier1Off('10'); setFMaxPerBuyer('5');
    setError(null);
  };

  const save = async () => {
    setError(null);
    if (!fName.trim()) { setError('Nhập tên chương trình.'); return; }
    if (tab === 'VOUCHER') {
      if (!fCode.trim() || fCode.trim().length > 5) { setError('Mã voucher 1-5 ký tự (A-Z, 0-9).'); return; }
      if (!fValue || Number(fValue) <= 0) { setError('Nhập giá trị giảm hợp lệ.'); return; }
    }
    setSaving(true);
    try {
      const config: Record<string, unknown> =
        tab === 'VOUCHER'
          ? { code: fCode.trim().toUpperCase(), rewardType: fRewardType, value: Number(fValue), minBasket: Number(fMinBasket) || 0, quantity: Number(fQty) || 0 }
          : tab === 'BUNDLE'
            ? { discountType: fDiscountType, tiers: [{ qty: Number(fTier1Qty) || 2, off: Number(fTier1Off) || 10 }], maxPerBuyer: Number(fMaxPerBuyer) || 0 }
            : { discountType: fDiscountType, value: Number(fValue) || 0, maxPerBuyer: Number(fMaxPerBuyer) || 0 };
      const r = await fetch('/api/shopee/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: tab, name: fName.trim(), config, startAt: fStart || undefined, endAt: fEnd || undefined }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast('Đã lưu nháp chương trình.');
        setShowForm(false);
        resetForm();
        load(tab);
      } else setError(r?.error || 'Lưu thất bại.');
    } catch {
      setError('Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const renderForm = () => (
    <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 mb-4">
      <div className="text-sm font-semibold mb-3">Tạo {TABS.find((t) => t.key === tab)?.label} mới</div>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Tên chương trình (nội bộ, khách không thấy)">
          <input className={inputCls()} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="VD: Sale cuối tuần" maxLength={100} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bắt đầu">
            <input type="datetime-local" className={inputCls()} value={fStart} onChange={(e) => setFStart(e.target.value)} />
          </Field>
          <Field label="Kết thúc">
            <input type="datetime-local" className={inputCls()} value={fEnd} onChange={(e) => setFEnd(e.target.value)} />
          </Field>
        </div>

        {tab === 'VOUCHER' && (
          <>
            <Field label="Mã voucher (tối đa 5 ký tự)">
              <input className={inputCls()} value={fCode} onChange={(e) => setFCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} placeholder="VD: SACH10" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Loại giảm">
                <select className={inputCls()} value={fRewardType} onChange={(e) => setFRewardType(e.target.value as 'AMOUNT' | 'PERCENT')}>
                  <option value="AMOUNT">Giảm số tiền (₫)</option>
                  <option value="PERCENT">Giảm theo %</option>
                </select>
              </Field>
              <Field label={fRewardType === 'AMOUNT' ? 'Số tiền giảm (₫)' : 'Phần trăm giảm (%)'}>
                <input type="number" min="1" className={inputCls()} value={fValue} onChange={(e) => setFValue(e.target.value)} />
              </Field>
            </div>
            <Field label="Đơn tối thiểu (₫, 0 = không giới hạn)">
              <input type="number" min="0" className={inputCls()} value={fMinBasket} onChange={(e) => setFMinBasket(e.target.value)} />
            </Field>
            <Field label="Số lượng phát hành">
              <input type="number" min="1" className={inputCls()} value={fQty} onChange={(e) => setFQty(e.target.value)} />
            </Field>
          </>
        )}

        {(tab === 'DISCOUNT' || tab === 'BUNDLE' || tab === 'ADDON' || tab === 'FLASH_SALE') && (
          <>
            {tab === 'BUNDLE' ? (
              <>
                <Field label="Số lượng mua tối thiểu (tầng 1)">
                  <input type="number" min="2" className={inputCls()} value={fTier1Qty} onChange={(e) => setFTier1Qty(e.target.value)} />
                </Field>
                <Field label="Giảm (%) khi đạt tầng 1">
                  <input type="number" min="1" max="90" className={inputCls()} value={fTier1Off} onChange={(e) => setFTier1Off(e.target.value)} />
                </Field>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Loại giảm">
                  <select className={inputCls()} value={fDiscountType} onChange={(e) => setFDiscountType(e.target.value as 'PERCENT' | 'AMOUNT')}>
                    <option value="PERCENT">Giảm theo %</option>
                    <option value="AMOUNT">Giảm số tiền (₫)</option>
                  </select>
                </Field>
                <Field label="Giá trị giảm">
                  <input type="number" min="1" className={inputCls()} value={fValue} onChange={(e) => setFValue(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label="Giới hạn mua/khách (0 = không giới hạn)">
              <input type="number" min="0" className={inputCls()} value={fMaxPerBuyer} onChange={(e) => setFMaxPerBuyer(e.target.value)} />
            </Field>
            <div className="text-xs text-gray-500 md:col-span-2">
              {tab === 'BUNDLE' && 'VD: mua 2 giảm 10% - rất phù hợp với sách. Chọn sản phẩm áp dụng ở bước tiếp theo (sau khi đẩy lên Shopee).'}
              {tab === 'FLASH_SALE' && 'Giá sale phải là giá thấp nhất trong 7 ngày qua (quy định Shopee).'}
              {tab === 'ADDON' && 'Khách mua sản phẩm chính sẽ thấy gợi ý mua kèm giá sốc.'}
              {tab === 'DISCOUNT' && 'Giảm giá trực tiếp trên giá niêm yết của sản phẩm.'}
            </div>
          </>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {saving ? 'Đang lưu...' : 'Lưu nháp'}
        </button>
        <button
          onClick={() => { setShowForm(false); resetForm(); }}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Hủy
        </button>
      </div>
      <div className="mt-2 text-[11px] text-gray-400">
        Lưu ý: hiện lưu nháp trong ERP. Đẩy lên Shopee qua API (VoucherManager/DiscountManager/...) sẽ làm ở bước tiếp theo khi research xong.
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setShowForm(false); }}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                tab === t.key ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load(tab)}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            aria-label="Tải lại"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setShowForm(!showForm); resetForm(); }}
            className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
          >
            <Plus size={15} />
            Tạo mới
          </button>
        </div>
      </div>

      {showForm && renderForm()}

      {error && !showForm && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">Đang tải...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <div className="text-sm text-gray-400">Chưa có chương trình {TABS.find((t) => t.key === tab)?.label.toLowerCase()} nào.</div>
          <div className="mt-1 text-xs text-gray-300">Bấm "Tạo mới" để bắt đầu.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">Tên chương trình</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Thời gian</th>
                <th className="px-3 py-2 font-medium">Shopee</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{it.name}</div>
                    <div className="text-[11px] text-gray-400">{describeConfig(it.type, it.config)}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[it.status] || STATUS_COLOR.DRAFT}`}>
                      {it.statusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">
                    {it.startAt ? fmtDate(it.startAt) : '-'} → {it.endAt ? fmtDate(it.endAt) : '-'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400">
                    {it.shopeeId ? `#${it.shopeeId}` : 'Chưa đẩy'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
        Ngân sách đã chi và hiệu quả chiến dịch (ROAS) là dữ liệu tài chính, chỉ hiển thị ở tab Chủ.
      </div>
    </div>
  );
}

function describeConfig(type: MktType, cfg: Record<string, unknown>): string {
  try {
    if (type === 'VOUCHER') {
      const v = Number(cfg.value || 0);
      const unit = cfg.rewardType === 'PERCENT' ? '%' : '₫';
      return `Mã ${cfg.code || ''} · Giảm ${v.toLocaleString('vi-VN')}${unit} · Tối thiểu ${(Number(cfg.minBasket || 0)).toLocaleString('vi-VN')}₫ · SL ${cfg.quantity || 0}`;
    }
    if (type === 'BUNDLE') {
      const tiers = (cfg.tiers as Array<{ qty: number; off: number }>) || [];
      return tiers.map((t) => `Mua ${t.qty} giảm ${t.off}%`).join(', ') || 'Combo';
    }
    const v = Number(cfg.value || cfg.off || 0);
    return v ? `Giảm ${v.toLocaleString('vi-VN')}${cfg.discountType === 'PERCENT' ? '%' : '₫'}` : '';
  } catch {
    return '';
  }
}

function fmtDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return s;
  }
}
