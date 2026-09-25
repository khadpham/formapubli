'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { generateVietQRPayload } from '@/lib/vietqr';
import { readBankAccountsCache, writeBankAccountsCache } from '@/lib/bank-account-cache';

type BankAccount = { id: string; label: string; bankBin: string; accountNo: string; accountName?: string | null };
export type BankAccountSource = 'NETWORK' | 'CACHE' | 'NONE';

export function VietQrPay({
  warehouseId,
  amount,
  initialContent,
  onQr,
  onSource,
  onCachedAt,
}: {
  warehouseId: string;
  amount: number;
  initialContent: string;
  onQr?: (snapshot: { dataUrl: string; payload: string; accountNo: string; content: string } | null) => void;
  /** Nguồn dữ liệu tài khoản: mạng, cache 24h, hoặc không có (chặn QR). */
  onSource?: (source: BankAccountSource) => void;
  /** Mốc thời gian cache khi source === 'CACHE' (null với NETWORK/NONE). */
  onCachedAt?: (cachedAt: number | null) => void;
}) {
  const [list, setList] = useState<BankAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState(initialContent);
  const [qrUrl, setQrUrl] = useState('');
  const [payload, setPayload] = useState('');
  const [source, setSource] = useState<BankAccountSource>('NONE');
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const reqRef = useRef(0);
  const onQrRef = useRef(onQr);
  const onSourceRef = useRef(onSource);
  const onCachedAtRef = useRef(onCachedAt);
  useEffect(() => { onQrRef.current = onQr; }, [onQr]);
  useEffect(() => { onSourceRef.current = onSource; }, [onSource]);
  useEffect(() => { onCachedAtRef.current = onCachedAt; }, [onCachedAt]);

  useEffect(() => { setContent(initialContent); }, [initialContent]);

  // Ưu tiên mạng; chỉ fallback sang cache 24h khi fetch hỏng. Không có nguồn nào
  // → source NONE + onQr(null) để cha không bao giờ hiện QR cũ.
  useEffect(() => {
    let alive = true;
    const applySource = (next: BankAccountSource, cached: number | null) => {
      if (!alive) return;
      setSource(next);
      setCachedAt(cached);
      onSourceRef.current?.(next);
      onCachedAtRef.current?.(cached);
    };
    fetch(`/api/bank-accounts?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const l: BankAccount[] = Array.isArray(j?.data?.list) ? j.data.list : [];
        if (l.length === 0) {
          const cached = readBankAccountsCache(warehouseId);
          if (cached && cached.accounts.length > 0) {
            setList(cached.accounts);
            setSelectedId(cached.defaultId || cached.accounts[0]?.id || '');
            applySource('CACHE', cached.cachedAt);
            return;
          }
          setList([]);
          setSelectedId('');
          applySource('NONE', null);
          return;
        }
        const defaultId = j?.data?.default?.id || l[0]?.id || '';
        writeBankAccountsCache({ warehouseId, cachedAt: Date.now(), defaultId, accounts: l });
        setList(l);
        setSelectedId(defaultId);
        applySource('NETWORK', null);
      })
      .catch(() => {
        if (!alive) return;
        const cached = readBankAccountsCache(warehouseId);
        if (cached && cached.accounts.length > 0) {
          setList(cached.accounts);
          setSelectedId(cached.defaultId || cached.accounts[0]?.id || '');
          applySource('CACHE', cached.cachedAt);
          return;
        }
        setList([]);
        setSelectedId('');
        applySource('NONE', null);
      });
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
      {source === 'CACHE' && cachedAt ? (
        <p className="text-[10px] text-amber-600 font-medium">Dữ liệu cache {new Date(cachedAt).toLocaleString('vi-VN')}</p>
      ) : null}
      {qrUrl ? (
        <div className="flex flex-col items-center gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="VietQR thanh toán" className="w-[200px] h-[200px] rounded-xl border border-slate-200 bg-white" />
          <div className="text-xs font-mono font-bold text-slate-800">{amount.toLocaleString('vi-VN')} đ{acc ? ` → ${acc.accountNo}` : ''}</div>
          <div className="text-[10px] text-slate-400 break-all px-2 text-center">{payload}</div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">
          {list.length
            ? 'Đang sinh QR offline…'
            : source === 'CACHE'
              ? 'Cache tài khoản đã hết hạn — cần mạng để tải lại, hãy dùng tiền mặt.'
              : 'Chưa có tài khoản nhận — thêm ở bảng bank_accounts.'}
        </div>
      )}
    </div>
  );
}
