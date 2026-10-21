'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Users, ChevronDown } from 'lucide-react';
import ModulePlaceholder from '@/components/ui/ModulePlaceholder';

const TYPE_LABELS: Record<string, string> = {
  thiet_ke_bia: 'Thiết kế bìa',
  dich_gia: 'Dịch giả',
  bien_tap: 'Biên tập',
  doc_morat: 'Đọc morat',
  hanh_chinh: 'Hành chính',
  dai_dien_ben_a: 'Đại diện bên A',
  ben_b: 'Bên B',
  khac: 'Khác',
};

interface Collaborator {
  id: string;
  fullName: string;
  penName: string | null;
  roleTitle: string | null;
  collabType: string;
  dob: string | null;
  idNumber: string | null;
  idIssuedDate: string | null;
  idIssuedPlace: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankAccount: string | null;
  bankName: string | null;
  bankOwner: string | null;
  notes: string | null;
  isActive: boolean;
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 text-slate-400">{label}:</span>
      <span className="text-slate-700 break-words">{value}</span>
    </div>
  );
}

function formatVnd(n: number | null | undefined): string {
  return `${(n || 0).toLocaleString('vi-VN')}đ`;
}

interface ContractStats {
  collaborator: { id: string; fullName: string };
  stats: {
    contractCount: number;
    totalAmount: number;
    byCategory: { category: string; label: string; count: number; amount: number }[];
  };
  contracts: {
    id: string;
    contractNumber: string;
    title: string;
    categoryLabel: string;
    totalAmount: number;
    signedDate: string | null;
    statusLabel: string;
  }[];
}

function ContractSummary({ id }: { id: string }) {
  const [data, setData] = useState<ContractStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/collaborators/${id}/contracts`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setData(j.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-xs text-slate-400 py-2">Đang tải tổng hợp...</div>;
  if (!data) return null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="bg-white rounded-xl border border-slate-200 px-3 py-2">
          <div className="text-xs text-slate-400">Số hợp đồng</div>
          <div className="text-lg font-black text-slate-900">{data.stats.contractCount}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-3 py-2">
          <div className="text-xs text-slate-400">Tổng giá trị</div>
          <div className="text-lg font-black text-indigo-700">{formatVnd(data.stats.totalAmount)}</div>
        </div>
      </div>
      {data.stats.byCategory.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {data.stats.byCategory.map((c) => (
            <span key={c.category} className="text-xs px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700">
              {c.label}: {c.count} - {formatVnd(c.amount)}
            </span>
          ))}
        </div>
      )}
      {data.contracts.length > 0 ? (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-left">
                <th className="px-2 py-1.5 font-semibold">Số HĐ</th>
                <th className="px-2 py-1.5 font-semibold">Loại</th>
                <th className="px-2 py-1.5 font-semibold text-right">Giá trị</th>
                <th className="px-2 py-1.5 font-semibold">Ngày ký</th>
                <th className="px-2 py-1.5 font-semibold">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.contracts.map((d) => (
                <tr key={d.id}>
                  <td className="px-2 py-1.5 font-bold text-slate-800">{d.contractNumber}</td>
                  <td className="px-2 py-1.5 text-slate-600">{d.categoryLabel}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-800">{formatVnd(d.totalAmount)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{d.signedDate || '-'}</td>
                  <td className="px-2 py-1.5 text-slate-600">{d.statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-slate-400 py-1">Chưa có hợp đồng nào gắn với người này.</div>
      )}
    </div>
  );
}

export default function HrView() {
  const [rows, setRows] = useState<Collaborator[]>([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (type) params.set('type', type);
    const t = setTimeout(() => {
      fetch(`/api/collaborators?${params.toString()}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.success) {
            setRows(j.data);
            setError('');
          } else {
            setError(j.message || 'Không tải được danh sách.');
          }
        })
        .catch(() => setError('Không tải được danh sách.'));
    }, 250);
    return () => clearTimeout(t);
  }, [q, type]);

  const types = useMemo(() => Object.keys(TYPE_LABELS), []);

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900">Cộng tác viên</h2>
            <p className="text-sm text-slate-500">
              {rows.length} người - thông tin định danh làm cơ sở điền hợp đồng và tra cứu
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-4 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo tên, bút danh, vai trò..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Lọc theo loại cộng tác"
          >
            <option value="">Tất cả loại</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {rows.map((c) => {
            const open = openId === c.id;
            return (
              <div key={c.id} className="bg-white">
                <button
                  onClick={() => setOpenId(open ? null : c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900 text-sm truncate">
                      {c.fullName}
                      {c.penName && <span className="font-normal text-slate-500"> ({c.penName})</span>}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {[c.roleTitle, TYPE_LABELS[c.collabType] || c.collabType].filter(Boolean).join(' - ')}
                    </div>
                  </div>
                  {!c.isActive && (
                    <span className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-500 shrink-0">
                      Ngừng hợp tác
                    </span>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1 space-y-1.5 bg-slate-50/60">
                    <DetailRow label="Ngày sinh" value={c.dob} />
                    <DetailRow label="CCCD/CMND" value={c.idNumber} />
                    <DetailRow label="Ngày cấp" value={c.idIssuedDate} />
                    <DetailRow label="Nơi cấp" value={c.idIssuedPlace} />
                    <DetailRow label="MST cá nhân" value={c.taxId} />
                    <DetailRow label="Địa chỉ" value={c.address} />
                    <DetailRow label="Điện thoại" value={c.phone} />
                    <DetailRow label="Email" value={c.email} />
                    <DetailRow label="Số tài khoản" value={c.bankAccount} />
                    <DetailRow label="Ngân hàng" value={c.bankName} />
                    <DetailRow label="Chủ tài khoản" value={c.bankOwner} />
                    <DetailRow label="Ghi chú" value={c.notes} />
                    <div className="pt-2 mt-1 border-t border-slate-200">
                      <div className="text-sm font-bold text-slate-900 mb-2">Tổng hợp hợp đồng</div>
                      <ContractSummary id={c.id} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && !error && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">Không tìm thấy cộng tác viên.</div>
          )}
        </div>
      </div>

      <ModulePlaceholder
        title="Nhân sự"
        description="Quản lý hồ sơ, chấm công và lương cho đội ngũ dưới 10 người. Hỗ trợ cả lương tháng (full-time) và lương giờ (thu ngân part-time)."
        features={[
          'Hồ sơ nhân sự: mọi người xem được hồ sơ cá nhân của mình',
          'Chấm công: check-in/out, chống gian lận (đúng địa điểm, không chấm hộ)',
          'Lương tháng cho full-time, lương giờ (wage) cho thu ngân part-time',
          'Bảng lương duyệt → tự tạo phiếu chi trong Tài chính',
          'Phân ca làm việc theo tuần cho quầy và kho',
        ]}
      />
    </div>
  );
}
