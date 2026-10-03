'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { generateVietQRPayload, normalizeVietqrContent } from '@/lib/vietqr';
import { readBankAccountsCache, writeBankAccountsCache } from '@/lib/bank-account-cache';
import { resolveTransferContent, hasTransferTemplate, DEFAULT_TRANSFER_TEMPLATE } from '@/lib/transfer-content';

type BankAccount = { id: string; label: string; bankBin: string; accountNo: string; accountName?: string | null };
export type BankAccountSource = 'NETWORK' | 'CACHE' | 'NONE';

export interface BankAccountDecision {
  source: BankAccountSource;
  accounts: BankAccount[];
  defaultId: string;
  cachedAt: number | null;
  /**
   * Server ĐÃ trả lời và nói không còn tài khoản nào dùng được. Khác hẳn với
   * "không tải được" (mất mạng / HTTP lỗi) — thu ngân phải được báo khác.
   */
  serverSaysEmpty: boolean;
}

/**
 * NGUỒN TÀI KHOẢN NGÂN HÀNG — quyết định thuần, không I/O, để test được.
 *
 * VÌ SAO phải tách "hỏng" với "thành công và rỗng": `listBankAccounts` chỉ lấy
 * `isActive === true`, nên danh sách rỗng đúng lúc MỌI tài khoản nhận đã bị
 * ngưng (ngân hàng đóng tài khoản). Trước đây nhánh này cũng rơi về cache 24h
 * ⇒ POS mã hoá tài khoản ĐÃ ĐÓNG vào mã QR và khách chuyển tiền vào tài khoản
 * chết. Cache chỉ được ghi ở nhánh có dữ liệu, nên cache còn đó là tài khoản
 * TỪNG hoạt động — dùng lại nó sau khi server nói "không còn" là sai.
 */
export function decideBankAccounts(input: {
  /** false = mất mạng / HTTP lỗi / body hỏng. */
  fetchOk: boolean;
  networkAccounts: BankAccount[] | null;
  networkDefaultId?: string | null;
  cachedAccounts: BankAccount[] | null;
  cachedDefaultId?: string | null;
  cachedAt?: number | null;
}): BankAccountDecision {
  const cached = input.cachedAccounts && input.cachedAccounts.length > 0 ? input.cachedAccounts : null;
  if (!input.fetchOk) {
    return cached
      ? {
          source: 'CACHE',
          accounts: cached,
          defaultId: input.cachedDefaultId || cached[0].id,
          cachedAt: input.cachedAt ?? null,
          serverSaysEmpty: false,
        }
      : { source: 'NONE', accounts: [], defaultId: '', cachedAt: null, serverSaysEmpty: false };
  }
  const list = input.networkAccounts ?? [];
  if (list.length === 0) {
    return { source: 'NONE', accounts: [], defaultId: '', cachedAt: null, serverSaysEmpty: true };
  }
  return {
    source: 'NETWORK',
    accounts: list,
    defaultId: input.networkDefaultId || list[0].id,
    cachedAt: null,
    serverSaysEmpty: false,
  };
}

export function VietQrPay({
  warehouseId,
  amount,
  initialContent,
  itemCount = 0,
  warehouseName = '',
  warehouseCode = '',
  locked = false,
  onQr,
  onSource,
  onCachedAt,
}: {
  warehouseId: string;
  amount: number;
  initialContent: string;
  itemCount?: number;
  warehouseName?: string;
  warehouseCode?: string;
  /**
   * Đơn PENDING đã tạo ⇒ mọi thứ về tài khoản/nội dung là của CHÍNH đơn đó.
   * Khoá ô tài khoản và ô nội dung, và ép `manualContent` về null để QR luôn
   * dựng lại từ mẫu của kho với `itemCount` (số lượng thật của đơn).
   */
  locked?: boolean;
  onQr?: (snapshot: { dataUrl: string; payload: string; accountNo: string; content: string } | null) => void;
  /** Nguồn dữ liệu tài khoản: mạng, cache 24h, hoặc không có (chặn QR). */
  onSource?: (source: BankAccountSource) => void;
  /** Mốc thời gian cache khi source === 'CACHE' (null với NETWORK/NONE). */
  onCachedAt?: (cachedAt: number | null) => void;
}) {
  const [list, setList] = useState<BankAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState(initialContent);
  // Mẫu nội dung chuyển khoản RIÊNG THEO KHO (quản lý sửa ở Quản Lý Kho).
  // Biến hỗ trợ: {SL} tổng số lượng, {MA} mã đơn, {KHO} tên kho, {KH} mã kho.
  const [template, setTemplate] = useState<string | null>(null);
  // Chỉ hiện nhắc "chưa có mẫu" SAU khi đã hỏi xong server, tránh nháy nhắc
  // giả trong lúc fetch — thu ngân không bị dọn dẹp bằng cảnh báo giả.
  const [templateLoaded, setTemplateLoaded] = useState(false);
  // Người dùng đã tự sửa nội dung → giữ bản của họ, không đè lại bằng template.
  const [manualContent, setManualContent] = useState<string | null>(null);
  // Gõ tay chỉ áp cho ĐƠN HIỆN TẠI. Đổi mã đơn là phải quay về mẫu, nếu không
  // đơn sau sẽ mang nội dung của đơn cũ và lệch đối soát ngân hàng.
  const lastOrderRef = useRef(initialContent);
  if (lastOrderRef.current !== initialContent) {
    lastOrderRef.current = initialContent;
    if (manualContent !== null) setManualContent(null);
  }
  // Đã có đơn thì nội dung gõ tay không còn ý nghĩa: khách đã đọc nội dung
  // trên QR cũ. Ép về null để mọi lần dựng lại đều ra đúng một giá trị.
  const effectiveManual = locked ? null : manualContent;

  useEffect(() => {
    let alive = true;
    if (!warehouseId) { setTemplate(null); setTemplateLoaded(true); return; }
    // KHÔNG dùng `?all=true` (là cờ quyền ưu tiên, kèm tồn thật) và cũng KHÔNG
    // dựa vào `/api/warehouses` không tham số: danh sách đó là listSellable(),
    // còn kho POS có thể là kho được GÁN mà không bán được ⇒ .find() trượt ⇒
    // mất mẫu ⇒ QR ra mã đơn dài. Gọi đúng hợp đồng hẹp `?qrTemplate=<id>`:
    // server chỉ trả `qrTransferTemplate` của đúng kho này, không tồn, không
    // tên/địa chỉ, và không cần quyền quản lý.
    fetch(`/api/warehouses?qrTemplate=${encodeURIComponent(warehouseId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const w = (j?.data || []).find((x: any) => x.id === warehouseId);
        setTemplate(w?.qrTransferTemplate || null);
        if (alive) setTemplateLoaded(true);
      })
      .catch(() => { if (alive) { setTemplate(null); setTemplateLoaded(true); } });
    return () => { alive = false; };
  }, [warehouseId]);

  // Nguồn DUY NHẤT ghi nội dung chuyển khoản. Trước đây có thêm effect
  // `setContent(initialContent)` chạy kèm theo — nó đè ngược mẫu tuỳ biến mỗi
  // khi mã đơn đổi, nên QR ra mã đơn dài thay vì nội dung đã cấu hình.
  // KHÔNG return sớm khi manualContent: `resolveTransferContent` đã tự quyết
  // định "gõ tay thì giữ bản của họ" — một nơi quyết luật, không hai.
  useEffect(() => {
    setContent(
      resolveTransferContent({
        template,
        orderCode: initialContent,
        itemCount,
        warehouseName,
        warehouseCode,
        manualContent: effectiveManual,
      })
    );
  }, [template, initialContent, itemCount, warehouseName, warehouseCode, effectiveManual, locked]);

  const [qrUrl, setQrUrl] = useState('');
  const [source, setSource] = useState<BankAccountSource>('NONE');
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [serverSaysEmpty, setServerSaysEmpty] = useState(false);
  const reqRef = useRef(0);
  const onQrRef = useRef(onQr);
  const onSourceRef = useRef(onSource);
  const onCachedAtRef = useRef(onCachedAt);
  useEffect(() => { onQrRef.current = onQr; }, [onQr]);
  useEffect(() => { onSourceRef.current = onSource; }, [onSource]);
  useEffect(() => { onCachedAtRef.current = onCachedAt; }, [onCachedAt]);

  // Ưu tiên mạng; CHỈ fallback sang cache 24h khi thật sự không tải được. Server
  // trả lời rồi mà danh sách rỗng là quyết định thật, không phải sự cố — quyết
  // định đó nằm trong `decideBankAccounts`. Không có nguồn nào → source NONE +
  // onQr(null) để cha không bao giờ hiện QR cũ.
  useEffect(() => {
    let alive = true;
    const apply = (d: BankAccountDecision) => {
      if (!alive) return;
      setList(d.accounts);
      setSelectedId(d.defaultId);
      setServerSaysEmpty(d.serverSaysEmpty);
      setSource(d.source);
      setCachedAt(d.cachedAt);
      onSourceRef.current?.(d.source);
      onCachedAtRef.current?.(d.cachedAt);
    };
    const readCached = () => {
      const cached = readBankAccountsCache(warehouseId);
      return {
        cachedAccounts: cached?.accounts ?? null,
        cachedDefaultId: cached?.defaultId ?? null,
        cachedAt: cached?.cachedAt ?? null,
      };
    };
    fetch(`/api/bank-accounts?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!alive) return;
        const networkAccounts: BankAccount[] = Array.isArray(j?.data?.list) ? j.data.list : [];
        // Chỉ ghi cache khi CÓ tài khoản: cache rỗng sẽ làm "chưa từng có tài
        // khoản" trùng với "đã bị ngưng hết", hợp đồng ở `decideBankAccounts`
        // mất hết ý nghĩa.
        if (networkAccounts.length > 0) {
          writeBankAccountsCache({
            warehouseId,
            cachedAt: Date.now(),
            defaultId: j?.data?.default?.id || networkAccounts[0].id,
            accounts: networkAccounts,
          });
        }
        apply(
          decideBankAccounts({
            fetchOk: true,
            networkAccounts,
            networkDefaultId: j?.data?.default?.id ?? null,
            ...readCached(),
          })
        );
      })
      .catch(() => {
        if (!alive) return;
        apply(decideBankAccounts({ fetchOk: false, networkAccounts: null, ...readCached() }));
      });
    return () => { alive = false; };
  }, [warehouseId]);

  useEffect(() => {
    const req = ++reqRef.current;
    const acc = list.find((b) => b.id === selectedId);
    if (!acc || amount <= 0) {
      setQrUrl('');
      onQrRef.current?.(null);
      return;
    }
    // ĐÓNG BĂNG đúng chuỗi đã mã hoá. `generateVietQRPayload` tự chuẩn hoá
    // (bỏ dấu, bỏ ký tự lạ, cắt còn 23) nhưng `content` có thể là bản gõ tay
    // dài hơn 23. Đóng băng bản thô ⇒ đơn mang nội dung mà ngân hàng không
    // bao giờ ghi, mọi đơn gõ tay dài đều lệch đối soát. Chuẩn hoá idempotent
    // nên chuỗi này đưa vào payload không đổi một byte nào.
    const qrContent = normalizeVietqrContent(content);
    const p = generateVietQRPayload({ bankBin: acc.bankBin, accountNo: acc.accountNo, amount, content: qrContent });
    QRCode.toDataURL(p, { width: 280, margin: 1 })
      .then((url) => {
        if (req !== reqRef.current) return;
        setQrUrl(url);
        onQrRef.current?.({ dataUrl: url, payload: p, accountNo: acc.accountNo, content: qrContent });
      })
      .catch(() => { if (req !== reqRef.current) return; setQrUrl(''); onQrRef.current?.(null); });
    // `locked` nằm trong deps: lúc đơn vừa tạo, mã đơn và số lượng có thể KHÔNG
    // đổi ⇒ không có dep nào khác đổi ⇒ không có lần phát snapshot nào cho cha,
    // và modal sẽ mãi hiện "chưa có tài khoản nhận".
  }, [list, selectedId, amount, content, locked]);

  if (amount <= 0) return null;
  const acc = list.find((b) => b.id === selectedId);
  return (
    <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
      <select aria-label="Tài khoản nhận tiền" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={locked} className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none disabled:opacity-70 disabled:bg-slate-100">
        {list.map((b) => <option key={b.id} value={b.id}>{b.label} — {b.accountNo}</option>)}
      </select>
      <input
        aria-label="Nội dung chuyển khoản"
        type="text"
        value={content}
        onChange={(e) => { setManualContent(e.target.value); setContent(e.target.value); }}
        disabled={locked}
        placeholder="Nội dung chuyển khoản (tự sửa)"
        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none disabled:opacity-70 disabled:bg-slate-100"
      />
      {locked ? (
        <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
          Đã khoá theo đơn — muốn đổi tài khoản hoặc nội dung thì huỷ đơn và tạo lại.
        </p>
      ) : null}
      {templateLoaded && !hasTransferTemplate(template) ? (
        // KHÔNG chặn bán: đơn vẫn hợp lệ, QR vẫn quét được, và nhờ mẫu mặc định
        // thì SỐ LƯỢNG vẫn lên QR (mã đơn bị rút gọn). Chỉ còn thiếu phần tuỳ
        // biến của kho ⇒ nhắc, không cảnh báo.
        <p className="text-[10px] text-amber-600 font-medium leading-relaxed">
          Kho chưa có mẫu riêng — đang dùng mẫu mặc định: {DEFAULT_TRANSFER_TEMPLATE.replace('{SL}', 'SL').replace('{MA}', 'mã đơn')}. Sửa ở Quản Lý Kho.
        </p>
      ) : null}
      {source === 'CACHE' && cachedAt ? (
        <p className="text-[10px] text-amber-600 font-medium">Dữ liệu cache {new Date(cachedAt).toLocaleString('vi-VN')}</p>
      ) : null}
      {qrUrl ? (
        <div className="flex flex-col items-center gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="VietQR thanh toán" className="w-[200px] h-[200px] rounded-xl border border-slate-200 bg-white" />
          <div className="text-xs font-mono font-bold text-slate-800">{amount.toLocaleString('vi-VN')} đ{acc ? ` → ${acc.accountNo}` : ''}</div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">
          {list.length
            ? 'Đang sinh QR offline…'
            : serverSaysEmpty
              ? 'Kho không còn tài khoản nhận nào đang hoạt động — bật lại ở Quản Lý Kho, hoặc thu tiền mặt.'
              : source === 'CACHE'
                ? 'Cache tài khoản đã hết hạn — cần mạng để tải lại, hãy dùng tiền mặt.'
                : 'Chưa có tài khoản nhận — thêm ở bảng bank_accounts.'}
        </div>
      )}
    </div>
  );
}
