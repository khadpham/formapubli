'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { generateVietQRPayload } from '@/lib/vietqr';

type BankAccount = { id: string; label: string; bankBin: string; accountNo: string; accountName?: string | null };

export function VietQrPay({
  warehouseId,
  amount,
  initialContent,
  onQr,
}: {
  warehouseId: string;
  amount: number;
  initialContent: string;
  onQr?: (snapshot: { dataUrl: string; payload: string; accountNo: string; content: string } | null) => void;
}) {
  const [list, setList] = useState<BankAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState(initialContent);
  const [qrUrl, setQrUrl] = useState('');
  const [payload, setPayload] = useState('');
  const reqRef = useRef(0);

  useEffect(() => { setContent(initialContent); }, [initialContent]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/bank-accounts?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const l: BankAccount[] = j?.data?.list || [];
        setList(l);
        setSelectedId(j?.data?.default?.id || l[0]?.id || '');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [warehouseId]);

  useEffect(() => {
    const req = ++reqRef.current;
    const acc = list.find((b) => b.id === selectedId);
    if (!acc || amount <= 0) {
      setQrUrl(''); setPayload('');
      onQr?.(null);
      return;
    }
    const p = generateVietQRPayload({ bankBin: acc.bankBin, accountNo: acc.accountNo, amount, content });
    setPayload(p);
    QRCode.toDataURL(p, { width: 280, margin: 1 })
      .then((url) => {
        if (req !== reqRef.current) return;
        setQrUrl(url);
        onQr?.({ dataUrl: url, payload: p, accountNo: acc.accountNo, content });
      })
      .catch(() => { if (req !== reqRef.current) return; setQrUrl(''); onQr?.(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, selectedId, amount, content]);

  if (amount <= 0) return null;
  const acc = list.find((b) => b.id === selectedId);
  return (
    <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
      <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none">
        {list.map((b) => <option key={b.id} value={b.id}>{b.label} — {b.accountNo}</option>)}
      </select>
      <input
        type="text"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Nội dung chuyển khoản (tự sửa)"
        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none"
      />
      {qrUrl ? (
        <div className="flex flex-col items-center gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="VietQR thanh toán" className="w-[200px] h-[200px] rounded-xl border border-slate-200 bg-white" />
          <div className="text-xs font-mono font-bold text-slate-800">{amount.toLocaleString('vi-VN')} đ{acc ? ` → ${acc.accountNo}` : ''}</div>
          <div className="text-[10px] text-slate-400 break-all px-2 text-center">{payload}</div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">{list.length ? 'Đang sinh QR offline…' : 'Chưa có tài khoản nhận — thêm ở bảng bank_accounts.'}</div>
      )}
    </div>
  );
}
