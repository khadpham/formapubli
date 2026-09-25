'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { generateVietQRPayload } from '@/lib/vietqr';

type BankAccount = { id: string; label: string; bankBin: string; accountNo: string; accountName?: string | null };

export function VietQrPay({
  warehouseId,
  amount,
  initialContent,
  itemCount = 0,
  warehouseName = '',
  warehouseCode = '',
  onQr,
}: {
  warehouseId: string;
  amount: number;
  initialContent: string;
  itemCount?: number;
  warehouseName?: string;
  warehouseCode?: string;
  onQr?: (snapshot: { dataUrl: string; payload: string; accountNo: string; content: string } | null) => void;
}) {
  const [list, setList] = useState<BankAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState(initialContent);
  // Mẫu nội dung chuyển khoản RIÊNG THEO KHO (quản lý sửa ở Quản Lý Kho).
  // Biến hỗ trợ: {SL} tổng số lượng, {MA} mã đơn, {KHO} tên kho, {KH} mã kho.
  const [template, setTemplate] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!warehouseId) { setTemplate(null); return; }
    fetch(`/api/warehouses?all=true`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const w = (j?.data || []).find((x: any) => x.id === warehouseId);
        setTemplate(w?.qrTransferTemplate || null);
      })
      .catch(() => { if (alive) setTemplate(null); });
    return () => { alive = false; };
  }, [warehouseId]);

  useEffect(() => {
    if (!template) { setContent(initialContent); return; }
    setContent(
      template
        .replace(/\{SL\}/g, String(itemCount || 0))
        .replace(/\{MA\}/g, initialContent || '')
        .replace(/\{KHO\}/g, warehouseName || '')
        .replace(/\{KH\}/g, warehouseCode || '')
    );
  }, [template, initialContent, itemCount, warehouseName, warehouseCode]);  const [qrUrl, setQrUrl] = useState('');
  const [payload, setPayload] = useState('');
  const reqRef = useRef(0);
  const onQrRef = useRef(onQr);
  useEffect(() => { onQrRef.current = onQr; }, [onQr]);

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
      onQrRef.current?.(null);
      return;
    }
    const p = generateVietQRPayload({ bankBin: acc.bankBin, accountNo: acc.accountNo, amount, content });
    setPayload(p);
    QRCode.toDataURL(p, { width: 280, margin: 1 })
      .then((url) => {
        if (req !== reqRef.current) return;
        setQrUrl(url);
        onQrRef.current?.({ dataUrl: url, payload: p, accountNo: acc.accountNo, content });
      })
      .catch(() => { if (req !== reqRef.current) return; setQrUrl(''); onQrRef.current?.(null); });
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
