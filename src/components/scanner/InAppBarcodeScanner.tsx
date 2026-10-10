'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createBarcodeDecoder, type BarcodeDecoder } from '@/lib/barcode-decoder';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import {
  Camera,
  X,
  Zap,
  ZapOff,
  ShoppingCart,
  CheckCircle2,
  AlertCircle,
  Volume2,
  ScanLine,
} from 'lucide-react';

interface InAppBarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedCode: string) => void;
  /** Mở thẳng bước thanh toán. Bấm ở đây sẽ tự đóng camera trước. */
  onGoToCheckout?: () => void;
  /** Số cuốn trong giỏ - hiện trên nút xanh để thu ngân biết còn bao nhiêu. */
  cartCount?: number;
}

/**
 * VÙNG QUÉT (ROI) - dùng CHUNG cho khung nhìn và cho bộ giải mã, nên thứ người
 * dùng thấy ĐÚNG là thứ máy quét.
 *
 * VÌ SAO CẦN (30/09, người dùng báo): trước đây khung nhìn là ô `w-64 h-44` nhưng
 * vòng decode vẽ **toàn bộ** khung hình rồi giải mã cả khung ⇒ mã ngoài ô vẫn bị
 * bắt, quét nhầm mã khác. Nay ROI là nguồn sự thật duy nhất.
 *
 * ⚠️ ROI KHÔNG ĐỔI THEO ZOOM (sửa lại 30/09 sau khi người dùng thử thật).
 * Lần trước tôi làm zoom = thu hẹp ROI, người dùng nói đúng: đó là "phóng to/thu
 * nhỏ cái frame quét", KHÔNG phải zoom. Zoom phải phóng HÌNH CAMERA, còn khung quét
 * phải giữ nguyên kích thước trên màn hình ở mọi mức zoom.
 *
 * Vì khung quét phải nhìn như khung ngắm, kích thước tính theo TỈ LỆ KHUNG HÌNH
 * (`ROI_BOX_ASPECT`) chứ không phải hai phần trăm cứng - màn hình cao (dọc, full
 * screen) và màn hàn rộng (ngang) đều ra khung cùng dáng.
 */
export const ROI_BOX_ASPECT = 1.45;
export const ROI_MAX_W = 0.86;
export const ROI_MAX_H = 0.62;

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Khung quét luôn CĂN GIỮA - người dùng chỉ cần đưa mã vào giữa khung.
 * `elW`/`elH` là kích thước ô xem camera; hàm trả về tỉ lệ 0..1.
 */
export function roiRect(elW: number, elH: number): NormalizedRect {
  if (!(elW > 0) || !(elH > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  let w = ROI_MAX_W * elW;
  let h = w / ROI_BOX_ASPECT;
  const maxH = ROI_MAX_H * elH;
  if (h > maxH) {
    h = maxH;
    w = h * ROI_BOX_ASPECT;
  }
  const nw = w / elW;
  const nh = h / elH;
  return { x: (1 - nw) / 2, y: (1 - nh) / 2, w: nw, h: nh };
}

/**
 * Phần khung hình video THẬT SỰ HIỂN THỊ khi dùng `object-cover`.
 *
 * Rất dễ sơ sai: `object-cover` CẮT bớt phần dư của video, nên "100% khung nhìn"
 * KHÔNG phải "100% khung hình". Nếu quy vùng quét theo khung hình mà vẽ khung
 * nhìn theo phần hiển thị thì hai thứ lệch nhau - đúng loại lỗi người dùng đang
 * gặp. Hàm này là nguồn sự thật chung cho cả hai.
 *
 * Trả về tỉ lệ theo KHUNG HÌNH video.
 */
export function visibleVideoRect(
  elW: number,
  elH: number,
  vidW: number,
  vidH: number,
  displayScale = 1
): NormalizedRect {
  if (elW <= 0 || elH <= 0 || vidW <= 0 || vidH <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const elAspect = elW / elH;
  const vidAspect = vidW / vidH;
  let vis: NormalizedRect;
  if (vidAspect > elAspect) {
    // Video rộng hơn khung nhìn ⇒ bị cắt hai bên.
    const w = elAspect / vidAspect;
    vis = { x: (1 - w) / 2, y: 0, w, h: 1 };
  } else {
    // Video cao hơn khung nhìn ⇒ bị cắt trên dưới.
    const h = vidAspect / elAspect;
    vis = { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  // Khi camera KHÔNG zoom được, ta phóng HÌNH bằng CSS `scale` quanh tâm. Lúc đó
  // người dùng chỉ thấy phần giữa, thu nhỏ lại 1/scale. Phải thu vùng hiển thị
  // lại thì khung quét mới tiếp tục trùng đúng vùng trên màn hình.
  if (displayScale > 1) {
    const w = vis.w / displayScale;
    const h = vis.h / displayScale;
    vis = { x: vis.x + (vis.w - w) / 2, y: vis.y + (vis.h - h) / 2, w, h };
  }
  return vis;
}

/**
 * Chuyển vùng quét (đang ở tỉ lệ của phần HIỂN THỊ) sang toạ độ KHUNG HÌNH video
 * để `drawImage` crop đúng chỗ. Đây là bước nối giữ "khung người dùng thấy" và
 * "vùng máy thật sự quét".
 */
export function roiToVideoFrame(
  roi: NormalizedRect,
  elW: number,
  elH: number,
  vidW: number,
  vidH: number,
  displayScale = 1
): NormalizedRect {
  const vis = visibleVideoRect(elW, elH, vidW, vidH, displayScale);
  return {
    x: vis.x + roi.x * vis.w,
    y: vis.y + roi.y * vis.h,
    w: roi.w * vis.w,
    h: roi.h * vis.h,
  };
}

/** Chiều rộng canvas dùng cho giải mã, theo ROI. Bộ giải mã cần đủ pixel. */
export const ROI_DECODE_WIDTH = 960;

export function InAppBarcodeScanner({
  isOpen,
  onClose,
  onScan,
  onGoToCheckout,
  cartCount = 0,
}: InAppBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Máy quét luôn dùng camera sau (đã bỏ nút chuyển trước/sau 30/09), nên không
  // cần setter - giữ cố định cho vòng lặp camera không đổi hướng ngoài ý muốn.
  const [facingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanSuccessAnim, setScanSuccessAnim] = useState<boolean>(false);
  const [scannerStatus, setScannerStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [scannerError, setScannerError] = useState<string | null>(null);

  const lastScannedTimeRef = useRef<number>(0);
  const didPostPermissionRescanRef = useRef<boolean>(false);

  const CAMERA_ID_KEY = 'formapubli.scanner.cameraId';
  const ZOOM_KEY = 'formapubli.scanner.zoom';
  const [availableCameras, setAvailableCameras] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(CAMERA_ID_KEY) || '' : '';
    } catch {
      return '';
    }
  });
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(ZOOM_KEY) === '2' ? 2 : 1;
    } catch {
      return 1;
    }
  });
  const zoomLevelRef = useRef<number>(1);
  zoomLevelRef.current = zoomLevel;

  // Máy nào zoom được bằng ràng buộc camera thì phóng hình thật; máy không đổi
  // được thì phóng bằng CSS. Cả hai đều phóng HÌNH, không đụng khung quét.
  const [cameraZoomWorks, setCameraZoomWorks] = useState<boolean>(false);
  // Hệ số phóng HÌNH ĐANG HIỂN THỊ. Khi camera zoom thật thì = 1 vì khung hình
  // đã bị thu hẹp sẵn; khi phóng bằng CSS thì = 2 để bù lại khi quy đổi toạ độ.
  const displayScale = cameraZoomWorks || zoomLevel === 1 ? 1 : zoomLevel;
  const displayScaleRef = useRef<number>(1);
  displayScaleRef.current = displayScale;

  // Kích thước ô xem camera, đo bằng ResizeObserver. ROI tính từ đây nên khung
  // nhìn và bộ giải mã LUÔN dùng cùng một con số - kể cả khi xoay ngang/dọc.
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const viewSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  viewSizeRef.current = viewSize;
  const roi = useMemo(() => roiRect(viewSize.w, viewSize.h), [viewSize]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setViewSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, [isOpen]);

  const [mounted, setMounted] = useState(false);
  const modalRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, onClose);
  useEffect(() => {
    setMounted(true);
  }, []);

  // MỞ KHOÁ ÂM THANH - phải bắt ở WINDOW, không bắt ở modal.
  //
  // LÝ DO (review 30/09 - lỗi nghiêm trọng, chỉ lộ trên iPhone):
  //   Bản trước gắn listener vào `modalRef.current`. Nhưng modal CHƯA TỒN TẠI cho
  //   tới khi `openScanner()` đã chạy xong ⇒ lúc thu ngân bấm nút "Quét mã" thì
  //   chưa có modal để bắt chạm ⇒ listener không chạy ⇒ `AudioContext` được tạo
  //   ra NGOÀI user gesture ⇒ WebKit giữ nó ở "suspended" và từ chối `resume()`
  //   ⇒ **im lặng cho tới khi thu ngân chạm vào trong modal**. Mà iPhone không
  //   rung ⇒ mất hẳn kênh báo. Đây đúng là triệu chứng mà commit này định sửa.
  //
  //   Cách sửa: bắt ở `window` và đăng ký NGAY khi component mount (component luôn
  //   được render trong POS) - không phụ thuộc `isOpen`, không `once`. Nhờ vậy lần
  //   chạm vào nút "Quét mã" chính là gesture thật và mở khoá được.
  useEffect(() => {
    const unlock = () => {
      ensureAudio();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchstart', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      // Đóng context khi rời khỏi POS (đổi route) để không để lại context sống.
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Ref theo dõi cơ chế hãm phanh Lost-Track & Cooldown (BV-02)
  const lockedCodeRef = useRef<string | null>(null); // Mã đang bị khóa trong khung hình
  const framesWithoutBarcodeRef = useRef<number>(0); // Đếm số frame liên tiếp không thấy mã để reset lock

  // 1. BÍP BÁO ĐÃ NHẬN BARCODE - tổng hợp bằng Web Audio, KHÔNG dùng file âm.
  //
  // VÌ SAO KHÔNG TẠO AudioContext MỚI MỖI LẦN BÍP (lỗi đã có trong bản cũ):
  //   `new AudioContext()` mỗi lần quét là thói quen sai trên mobile. iOS giới
  //   hạn số AudioContext đồng thời, và context sinh ra NGOÀI user gesture thường
  //   rơi vào trạng thái "suspended" ⇒ bíp vài lần là mất tiếng hẳn. Đó là lý do
  //   thu ngân báo "tiếng bé / không nghe thấy" chứ KHÔNG phải vì gain thấp - nên
  //   chỉ tăng `gain` sẽ không sửa được. Nay dùng MỘT context cho cả phiên.
  //
  //   Mở khoá âm thanh bằng chính user gesture: lần chạm đầu tiên vào khung
  //   scanner (hoặc phím) sẽ `resume()` context. Đây là cách duy nhất trình duyệt
  //   di động cho phép phát tiếng mà không cần xin quyền riêng.
  const audioCtxRef = useRef<AudioContext | null>(null);

  const ensureAudio = () => {
    if (typeof window === 'undefined') return null;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextClass();
      }
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume().catch(() => {
          /* chưa có gesture - lần chạm sau sẽ mở khoá */
        });
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  };

  // Một tiếng báo, quét tần số TĂNG DẦN để có cả "thân" lẫn "rõ".
  //
  // VÌ SAO KHÔNG DÙNG MỘT TẦN SỐ:
  //  · Loa điện thoại rất nhỏ, cỡ 12–15 mm. Nó **gần như không tái tạo được
  //    tần số trên ~2–3 kHz** ⇒ tiếng thuần 2.8 kHz trên điện thoại nghe MỎNG và
  //    nhỏ dù máy vẫn "đúng tần số". Đó là lý do dải 2–4 kHz (gợi ý của tôi ở
  //    lượt trước) KHÔNG đủ trên phần cứng này.
  //  · Nhưng tần số quá thấp lại bị tiếng nói 500 Hz–2 kHz bóp chết.
  //  ⇒ Quét từ ~1.1 kHz lên ~2.9 kHz: đầu tiếng có thân (loa phát được), cuối
  //    tiếng có độ rõ (xuyên qua tiếng ồn). Đây là cách loa tản thể thường làm.
  const chirp = (ctx: AudioContext, at: number, fromHz: number, toHz: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(fromHz, at);
    osc.frequency.exponentialRampToValueAtTime(toHz, at + dur);
    // Hình chữ nhạt bằng hàm mũ: bùng gần như tức thì (bắt đầu ngay, không bị
    // bỏ sót khi thu ngân quét nhanh) rồi tắt mềm để không "bụp" gây giật.
    // 0.95 - sát trần trước khi bị cắt/khếch. Nâng cao hơn chỉ làm méo tiếng.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.95, at + 0.006);
    gain.gain.setValueAtTime(0.95, at + dur * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.01);
  };

  const playBeepSound = () => {
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const t = ctx.currentTime + 0.01;
      // MỘT tiếng duy nhất = MỘT cuốn đã quét. Yêu cầu của thu ngân: hai tiếng
      // dễ gây nhầm là quét 2 cuốn. Nên: một tiếng, quét 1.1 → 2.9 kHz, dài 260 ms
      // (dài hơn từng tiếng trước đó là 190 ms) để vẫn nổi bật khi chỉ còn một nhịp.
      chirp(ctx, t, 1100, 2900, 0.26);
    } catch {
      /* im lặng: không được làm hỏng luồng quét vì loa */
    }
  };

  // 1b. Lấy danh sách Camera và lọc thông minh Camera chính (loại trừ Macro / Ultra-wide)
  const enumerateAndSelectBestCamera = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return null;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      
      const formatted = videoInputs.map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${index + 1}`,
      }));
      setAvailableCameras(formatted);

      try {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem(CAMERA_ID_KEY) : null;
        if (saved && videoInputs.some((d) => d.deviceId === saved)) {
          setSelectedCameraId(saved);
          return saved;
        }
      } catch {
        // bỏ qua, chọn tự động
      }
      if (selectedCameraId && videoInputs.some((d) => d.deviceId === selectedCameraId)) {
        return selectedCameraId;
      }

      // Bộ lọc thông minh:
      // Tìm các camera sau (back/environment/rear)
      const backCams = videoInputs.filter((d) => {
        const l = d.label.toLowerCase();
        return l.includes('back') || l.includes('rear') || l.includes('environment') || l.includes('sau');
      });

      const candidateList = backCams.length > 0 ? backCams : videoInputs;

      // ƯU TIÊN 1: Ống kính chính (Main, Standard, 1x, 0)
      // LOẠI TRỪ TUYỆT ĐỐI: Macro, Ultra, Wide, Tele, 0.5x, Depth
      const mainCam = candidateList.find((d) => {
        const l = d.label.toLowerCase();
        const isNotMacro = !l.includes('macro') && !l.includes('close') && !l.includes('ultra') && !l.includes('tele') && !l.includes('depth');
        const isMain = l.includes('main') || l.includes('primary') || l.includes('camera2 0') || l.includes('0, facing back') || l.includes('standard');
        return isNotMacro && isMain;
      });

      if (mainCam) {
        setSelectedCameraId(mainCam.deviceId);
        return mainCam.deviceId;
      }

      // ƯU TIÊN 2: Bất kỳ camera sau nào không phải ống kính phụ.
      // (KHÔNG loại 'wide': Apple gọi ống kính chính của iPhone là "Wide" -
      // loại 'wide' sẽ vứt nhầm cam chính. Chỉ loại ultra/tele/depth/macro.)
      const nonMacroBack = candidateList.find((d) => {
        const l = d.label.toLowerCase();
        return !l.includes('macro') && !l.includes('close-up') && !l.includes('ultra') && !l.includes('tele') && !l.includes('depth') && !l.includes('0.5');
      });

      if (nonMacroBack) {
        setSelectedCameraId(nonMacroBack.deviceId);
        return nonMacroBack.deviceId;
      }

      // Fallback: Lấy camera đầu tiên trong danh sách
      if (candidateList.length > 0) {
        setSelectedCameraId(candidateList[0].deviceId);
        return candidateList[0].deviceId;
      }
    } catch (e) {
      console.warn('Không thể liệt kê danh sách camera:', e);
    }
    return null;
  };

  // 2. Khởi động Camera Stream (Tối ưu riêng cho Safari / iOS WebKit)
  const startCamera = async (targetDeviceId?: string) => {
    setErrorMessage(null);
    stopCamera();
    const request = cameraRequestRef.current;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Trình duyệt của bạn không hỗ trợ truy cập Camera trực tiếp.');
      }

      // Kiểm tra thiết bị iOS / Safari
      const isIOS =
        typeof navigator !== 'undefined' &&
        (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

      // Tìm thiết bị phù hợp nhất nếu chưa có
      const activeDeviceId = targetDeviceId || (await enumerateAndSelectBestCamera());
      if (request !== cameraRequestRef.current) return;

      // Trên iOS Safari: 1080p hoặc 720p mềm mỏng giúp lấy nét cự ly gần tốt hơn 4K
      const videoConstraints: MediaTrackConstraints = isIOS
        ? {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          }
        : {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          };

      if (activeDeviceId) {
        videoConstraints.deviceId = { exact: activeDeviceId };
      } else {
        videoConstraints.facingMode = { ideal: facingMode };
      }

      // Bật autofocus liên tục nếu trình duyệt hỗ trợ (trên Android / Chrome)
      if (!isIOS) {
        (videoConstraints as any).advanced = [{ focusMode: 'continuous' }];
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      if (request !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Bắt buộc cho Safari iOS
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        await videoRef.current.play();
      }
      if (request !== cameraRequestRef.current) return;

      setHasPermission(true);

      // Vá race label rỗng: lần enumerate trước khi cấp quyền thường trả về
      // label "" nên bộ lọc main/macro vô nghĩa. Enumerate lại 1 lần duy nhất
      // sau khi có quyền, nếu tìm được cam chính khác cam đang dùng thì đổi.
      try {
        const needsRescan =
          !didPostPermissionRescanRef.current &&
          (availableCameras.length === 0 ||
            availableCameras.every((c) => !c.label || c.label.startsWith('Camera ')));
        if (needsRescan) {
          didPostPermissionRescanRef.current = true;
          const bestAfterPermission = await enumerateAndSelectBestCamera();
          if (request !== cameraRequestRef.current) return;
          // Nếu best khác hẳn device đang stream và không phải do user chọn tay, restart 1 lần.
          if (
            bestAfterPermission &&
            activeDeviceId &&
            bestAfterPermission !== activeDeviceId &&
            !targetDeviceId
          ) {
            stopCamera();
            await startCamera(bestAfterPermission);
            return;
          }
        }
      } catch {
        // Bỏ qua, giữ stream hiện tại
      }

      // Lưu camera đang dùng để lần sau mở lại đúng ống kính
      try {
        const currentId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || activeDeviceId;
        if (currentId) {
          setSelectedCameraId(currentId);
          window.localStorage.setItem(CAMERA_ID_KEY, currentId);
        }
      } catch {
        // bỏ qua
      }

      // Kiểm tra hỗ trợ Flash / Torch + Zoom + ép nét gần cho quét mã
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as any;
      if (capabilities && capabilities.torch) {
        setHasTorch(true);
      } else {
        setHasTorch(false);
      }
      try {
        // Mở camera ở zoom 1 (đường người dùng đã xác nhận ổn) + focus liên tục.
        // Sau đó áp lại mức zoom đang lưu: máy nhận thì phóng ảnh thật, không
        // nhận thì để CSS phóng (xem `toggleZoom`).
        const caps = capabilities as { zoom?: { min: number; max: number } } | undefined;
        let wanted: number = 1;
        if (caps?.zoom && zoomLevelRef.current > caps.zoom.min) {
          wanted = Math.min(zoomLevelRef.current, caps.zoom.max);
        }
        const applied = await track
          .applyConstraints({ advanced: [{ zoom: wanted, focusMode: 'continuous' } as any] })
          .then(() => true)
          .catch(() => false);
        if (request !== cameraRequestRef.current) return;
        setCameraZoomWorks(applied && wanted === zoomLevelRef.current);
      } catch {
        // máy không hỗ trợ focus/zoom: vẫn quét bình thường
      }
    } catch (err: any) {
      if (request !== cameraRequestRef.current) return;
      console.warn('Lỗi mở Camera:', err);
      // Fallback an toàn 2 tầng:
      // 1) Nếu lỗi do deviceId exact / advanced (Overconstrained) -> thử lại minimal.
      // 2) Nếu đã có targetDeviceId mà vẫn lỗi -> thử facingMode environment.
      const isConstraintError =
        err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError';
      if (isConstraintError || targetDeviceId) {
        console.info('Thử lại với camera mặc định không ràng buộc deviceId/advanced...');
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
          if (request !== cameraRequestRef.current) {
            fallbackStream.getTracks().forEach(track => track.stop());
            return;
          }
          streamRef.current = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            videoRef.current.setAttribute('playsinline', 'true');
            videoRef.current.setAttribute('webkit-playsinline', 'true');
            await videoRef.current.play();
          }
          if (request !== cameraRequestRef.current) return;
          setHasPermission(true);
          try {
            await enumerateAndSelectBestCamera();
          } catch {
            // bỏ qua
          }
          return;
        } catch (fallbackErr) {
          if (request !== cameraRequestRef.current) return;
          // Bỏ qua, báo lỗi bên dưới
        }
      }

      setHasPermission(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Bạn đã từ chối quyền Camera. Vui lòng cho phép quyền trong cài đặt trình duyệt.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage('Không tìm thấy thiết bị Camera trên máy tính/điện thoại này.');
      } else {
        setErrorMessage(err.message || 'Không thể kết nối với Camera.');
      }
    }
  };

  // 3. Tắt Camera Stream
  const stopCamera = () => {
    // Invalidate pending permission/device requests as well as the current stream.
    cameraRequestRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // 4. Bật/Tắt Đèn Flash (Torch)
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({
        advanced: [{ torch: !isTorchOn } as any],
      });
      setIsTorchOn(!isTorchOn);
    } catch (e) {
      console.warn('Không thể điều khiển đèn Flash:', e);
    }
  };

  // 4b. Đổi zoom 1x/2x - PHÓNG HÌNH CAMERA, không đụng khung quét.
  //
  // Người dùng nói rõ (30/09): zoom phải phóng cảnh camera lên. Lần trước tôi làm
  // zoom = thu hẹp vùng đọc, đó là "phóng/thu frame quét" chứ không phải zoom.
  //
  // Thứ tự ưu tiên:
  //  1. Ràng buộc zoom của camera (ảnh thật bị thu, nét nhất) - thử trước.
  //  2. Nếu máy không nhận ràng buộc ⇒ phóng bằng CSS `scale` quanh tâm. Vẫn là
  //     phóng hình, và `displayScale` bù lại khi quy đổi toạ độ crop.
  // Cả hai đều GIỮ NGUYÊN khung quét trên màn hình.
  const toggleZoom = async () => {
    const next = zoomLevel === 2 ? 1 : 2;
    const track = streamRef.current?.getVideoTracks()[0];
    if (track) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: next } as any] });
        setCameraZoomWorks(true);
      } catch {
        // Máy không nhận zoom ⇒ phóng bằng CSS.
        setCameraZoomWorks(false);
      }
    } else {
      setCameraZoomWorks(false);
    }
    setZoomLevel(next);
    zoomLevelRef.current = next;
    try {
      window.localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // bỏ qua
    }
  };

  // 5. Xử lý khi nhận diện được Barcode thành công với cơ chế "Hãm phanh" (BV-02)
  const handleBarcodeFound = (rawCode: string) => {
    const cleanCode = rawCode.trim().replace(/[^0-9X-]/gi, '');
    if (!cleanCode) return;

    const now = Date.now();

    // HÃM PHANH 0: khóa hết hạn theo thời gian (BV-02b). Đổi sách nhanh ở hội
    // chợ hiếm khi tạo đủ frame trống nên khóa kẹt ("lúc quét được lúc không"
    // khi quét nhiều cuốn cùng ISBN). Quá 4s coi như thao tác mới, cho quét
    // lại; giữ nguyên sách cũng chỉ +1 mỗi 4s nên không thể phình giỏ ồ ạt.
    if (lockedCodeRef.current === cleanCode && now - lastScannedTimeRef.current > 4000) {
      lockedCodeRef.current = null;
    }

    // HÃM PHANH 1: Nếu mã này đang bị KHÓA (đang ở nguyên vị trí trong camera) -> Bỏ qua
    if (lockedCodeRef.current === cleanCode) {
      // Đang lia giữ nguyên mã đó trong tầm quét -> Không tăng số lượng vô tội vạ
      framesWithoutBarcodeRef.current = 0;
      return;
    }

    // HÃM PHANH 2: Cooldown cứng 2000ms cho bất kỳ lần quét nào
    if (now - lastScannedTimeRef.current < 2000) {
      return;
    }

    // KHÓA MÃ NÀY LẠI NGAY LẬP TỨC
    lockedCodeRef.current = cleanCode;
    framesWithoutBarcodeRef.current = 0;
    lastScannedTimeRef.current = now;
    setLastScanned(cleanCode);

    // Bíp = ĐÃ NHẬN barcode. Rung mạnh hơn vì ở hội chờ điện thoại thường cầm tay
    // hoặc để trong túi, mắt không nhìn thẳng vào màn hình → rung là kênh báo
    // tin cậy hơn mắt. Nhiều nhịp để phân biệt với tin nhắn/điện thoại khác rung.
    // Lưu ý: iOS KHÔNG hỗ trợ `navigator.vibrate` ⇒ iPhone hoàn toàn dựa vào tiếng.
    playBeepSound();
    // Rung PHẢI bọc riêng: `navigator.vibrate` nằm trên đường chính, nếu nó ném
    // lỗi (một số trình duyệt chặn) thì `onScan()` bên dưới KHÔNG chạy ⇒ sách đã
    // khoá trong `lockedCodeRef` mà không vào giỏ ⇒ thu ngân phải quét lại.
    // Bíp vốn đã bọc try/catch với đúng lý do này; rung trước đây thì không.
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.([45, 55, 45, 55, 140]);
      }
    } catch {
      /* im lặng: rung là kênh phụ, không được chặn việc thêm sách vào giỏ */
    }

    // Hiệu ứng viền xanh nhấp nháy
    setScanSuccessAnim(true);
    setTimeout(() => setScanSuccessAnim(false), 900);

    // Bắn sự kiện lên component cha (POS Terminal)
    onScan(cleanCode);
  };

  // 6. Share the same camera frames between native and software barcode decoders.
  useEffect(() => {
    if (!isOpen) {
      didPostPermissionRescanRef.current = false;
      lockedCodeRef.current = null;
      framesWithoutBarcodeRef.current = 0;
      lastScannedTimeRef.current = 0;
      stopCamera();
      return;
    }

    startCamera();

    let isScanning = true;
    let timer: ReturnType<typeof setTimeout>;
    let barcodeDetector: BarcodeDecoder;
    setScannerStatus('loading');
    setScannerError(null);

    const scan = async () => {
      if (!isScanning) return;
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && canvas && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('Không đọc được hình ảnh từ camera.');

          // CHỈ vẽ VÙNG QUÉT (ROI), rồi phóng lên kích thước giải mã.
          // ROI LẤY TỪ `viewSize` ĐÃ ĐO - đúng bằng cái hộp người dùng thấy.
          // `displayScale` bù lại lúc camera phóng bằng CSS: khi đó người dùng
          // chỉ thấy phần giữa khung hình, nên vùng quét phải thu lại tương ứng.
          // Lưu ý: zoom KHÔNG đổi `roi` - nó chỉ phóng hình, khung quét giữ
          // nguyên kích thước trên màn hình ở mọi mức zoom.
          const vs = viewSizeRef.current;
          const laidOut = vs.w > 0 && vs.h > 0;
          const r = roiToVideoFrame(
            roiRect(vs.w, vs.h),
            laidOut ? vs.w : video.videoWidth,
            laidOut ? vs.h : video.videoHeight,
            video.videoWidth,
            video.videoHeight,
            displayScaleRef.current
          );
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const sx = vw * r.x;
          const sy = vh * r.y;
          const sw = vw * r.w;
          const sh = vh * r.h;
          // Giữ tỉ lệ khung hình để ảnh không bị méo (mã vạch méo là không quét được).
          const outH = Math.round((sh / sw) * ROI_DECODE_WIDTH);
          if (canvas.width !== ROI_DECODE_WIDTH || canvas.height !== outH) {
            canvas.width = ROI_DECODE_WIDTH;
            canvas.height = outH;
          }
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, ROI_DECODE_WIDTH, outH);
          const barcodes = await barcodeDetector.detect(canvas);
          if (!isScanning) return;
          if (barcodes.length > 0) {
            framesWithoutBarcodeRef.current = 0;
            handleBarcodeFound(barcodes[0].rawValue);
          } else {
            // LOST-TRACK LOGIC (BV-02):
            // Không tìm thấy mã vạch nào trong frame này.
            // Nếu liên tiếp 2 frame không còn thấy mã vạch trong khung hình:
            // Tự động MỞ KHÓA (Unlock) để cho phép quét cuốn sách tiếp theo (hoặc quét lại cuốn này nếu lia vào lại)
            framesWithoutBarcodeRef.current += 1;
            if (framesWithoutBarcodeRef.current >= 2) {
              lockedCodeRef.current = null;
            }
          }
        }
      } catch (error) {
        if (!isScanning) return;
        console.warn('Lỗi nhận diện mã vạch:', error);
        setScannerStatus('error');
        setScannerError('Không thể đọc mã vạch. Hãy đóng và mở lại camera; nếu vẫn lỗi, tải lại trang.');
        return;
      }
      // Schedule only after decoding finishes, avoiding overlapping work on slow phones.
      if (isScanning) timer = setTimeout(scan, 180);
    };

    void createBarcodeDecoder().then(decoder => {
      if (!isScanning) return;
      barcodeDetector = decoder;
      setScannerStatus('ready');
      void scan();
    }).catch(error => {
      if (!isScanning) return;
      console.warn('Lỗi khởi tạo bộ đọc mã vạch:', error);
      setScannerStatus('error');
      setScannerError('Không tải được bộ đọc mã vạch. Kiểm tra kết nối rồi tải lại trang.');
    });

    return () => {
      isScanning = false;
      clearTimeout(timer);
      stopCamera();
    };
  }, [isOpen, facingMode]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-scanner-title"
      className="fixed inset-0 z-[70] bg-black flex flex-col animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          stopCamera();
          onClose();
        }
      }}
    >
      <div className="bg-black text-white w-full flex-1 min-h-0 flex flex-col">
        {/* Header bar */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ScanLine className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 id="barcode-scanner-title" className="font-extrabold text-sm text-white">
                Quét Mã Vạch Camera
              </h3>
              <p className="text-[11px] text-slate-400">
                {scannerStatus === 'loading' || !hasPermission
                  ? 'Đang chuẩn bị camera và bộ đọc mã vạch…'
                  : 'Lia camera vào mã ISBN-13 sau bìa sách để tự động thêm giỏ'}
              </p>
            </div>
          </div>
           <button
             type="button"
             aria-label="Đóng máy quét mã vạch"
             onClick={() => {
               stopCamera();
               onClose();
             }}
             className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Video Area - CHIẾM TOÀN BỘ MÀN HÌNH (30/09: người dùng
            muốn xem hết màn hình điện thoại khi mở camera). */}
        <div ref={viewRef} className="relative flex-1 min-h-0 bg-black overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            style={
              !cameraZoomWorks && zoomLevel > 1
                ? { transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }
                : undefined
            }
            playsInline
            muted
            autoPlay
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Laser Targeting Overlay */}
          {/* Khung quét: kích thước LẤY TỪ CHÍNH `roi` mà bộ giải mã dùng, nên
              khung này luôn đúng bằng vùng thật sự quét. `roi` tính từ kích thước
              ô xem đã đo, nên xoay ngang/dọc vẫn khớp. */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              style={{ width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }}
              className={`relative rounded-2xl ${
                scanSuccessAnim
                  ? 'border-4 border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.8)]'
                  : 'border-2 border-indigo-400/70 shadow-[0_0_15px_rgba(99,102,241,0.3)]'
              }`}
            >
              {/* Corner Accents */}
              <div className="absolute -top-1.5 -left-1.5 w-6 h-6 border-t-4 border-l-4 border-indigo-400 rounded-tl-lg" />
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 border-t-4 border-r-4 border-indigo-400 rounded-tr-lg" />
              <div className="absolute -bottom-1.5 -left-1.5 w-6 h-6 border-b-4 border-l-4 border-indigo-400 rounded-bl-lg" />
              <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 border-b-4 border-r-4 border-indigo-400 rounded-br-lg" />

              {/* Laser Scanning Red/Green Beam Animation */}
              <div
                className={`absolute left-0 right-0 h-0.5 shadow-lg transition-colors ${
                  scanSuccessAnim
                    ? 'bg-emerald-400 shadow-emerald-400/80'
                    : 'bg-rose-500 shadow-rose-500/80 animate-scan-beam'
                }`}
              />

            </div>
          </div>

          {/* Error Message Alert */}
          {errorMessage && (
            <div className="absolute inset-x-4 top-4 bg-rose-950/90 border border-rose-500/50 p-3 rounded-xl text-xs text-rose-200 flex items-start gap-2 shadow-lg">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <p className="font-bold">Lỗi truy cập Camera</p>
                <p className="text-[11px] text-rose-300 mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {!errorMessage && scannerError && (
            <div role="alert" className="absolute inset-x-4 top-4 rounded-xl bg-slate-950/90 px-3 py-2 text-xs text-slate-200">
              {scannerError}
            </div>
          )}

          {/* Last Scanned Toast Overlay */}
          {lastScanned && (
            <div className="absolute bottom-3 inset-x-4 bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 px-3 py-2 rounded-xl text-xs flex items-center justify-between gap-2 shadow-lg animate-slide-up">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-mono font-bold text-white truncate">
                  {lastScanned}
                </span>
                <span className="text-[11px] text-emerald-300">Đã nhận diện!</span>
              </div>
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          )}
        </div>

        {/* Controls Bar */}
        {/* Thanh nút: hàng 1 là nút phụ, hàng 2 là nút CHÍNH (xanh) - thu ngân
            nhìn là thấy ngay bước thanh toán. Nút chuyển ống trước/sau đã bỏ
            (30/09): máy quét luôn dùng camera sau, nút đó chỉ chiếm chỗ. */}
        <div
          className="p-3 bg-slate-900/95 border-t border-slate-800 flex flex-col gap-2.5"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              stopCamera();
              onClose();
            }
          }}
        >
          <div
            className="flex flex-wrap items-center justify-center gap-2.5"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                stopCamera();
                onClose();
              }
            }}
          >
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Đóng máy quét mã vạch"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-500/50 border border-transparent transition-all"
          >
            <X className="w-4 h-4" />
            <span>Đóng</span>
          </button>

          {hasTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={isTorchOn ? 'Tắt đèn flash' : 'Bật đèn flash'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                isTorchOn
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {isTorchOn ? <ZapOff className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
              {isTorchOn ? 'Tắt Đèn' : 'Bật Flash'}
            </button>
          )}

          <button
            type="button"
            onClick={toggleZoom}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              zoomLevel === 2
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Zoom 2x: phóng to cảnh camera, khung quét giữ nguyên"
            aria-label={zoomLevel === 2 ? 'Tắt zoom, về 1x' : 'Phóng cảnh camera 2 lần'}
          >
            <Camera className="w-4 h-4" />
            {zoomLevel === 2 ? 'Zoom 2x' : 'Zoom 1x'}
          </button>

          {/* Chọn ống kính khi điện thoại có nhiều camera (quan trọng cho zoom:
              iPhone có ống tele, chọn đúng ống là nét nhất). */}
          {availableCameras.length > 1 && (
            <select
              value={selectedCameraId}
              onChange={(e) => {
                const newId = e.target.value;
                setSelectedCameraId(newId);
                try {
                  window.localStorage.setItem(CAMERA_ID_KEY, newId);
                } catch {
                  // bỏ qua
                }
                startCamera(newId);
              }}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[160px] truncate"
              title="Chọn ống kính Camera"
            >
              {availableCameras.map((cam, idx) => (
                <option key={cam.deviceId || idx} value={cam.deviceId}>
                  📷 {cam.label || `Ống kính ${idx + 1}`}
                </option>
              ))}
            </select>
          )}
          </div>

          {/* NÚT CHÍNH: Xem Giỏ & Thanh Toán. Màu xanh GIỐNG HỆT nút cùng ý nghĩa
              ở màn POS, để thu ngân không phải nhìn chỗ khác mới biết bấm đâu. */}
          <button
            type="button"
            id="btn-scanner-go-checkout"
            onClick={() => {
              stopCamera();
              onGoToCheckout?.();
            }}
            disabled={!onGoToCheckout || cartCount === 0}
            aria-label={
              cartCount === 0
                ? 'Giỏ hàng đang trống, chưa thanh toán được'
                : `Xem giỏ và thanh toán, ${cartCount} cuốn trong giỏ`
            }
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-sm font-extrabold shadow-md shadow-emerald-950/30 flex items-center justify-center gap-2 min-h-[50px] active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100 cursor-pointer disabled:cursor-not-allowed"
          >
            <ShoppingCart className="w-5 h-5" />
            {cartCount === 0 ? 'Giỏ Hàng Trống' : `Xem Giỏ & Thanh Toán (${cartCount} cuốn)`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
