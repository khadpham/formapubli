'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createBarcodeDecoder, type BarcodeDecoder } from '@/lib/barcode-decoder';
import {
  Camera,
  X,
  Zap,
  ZapOff,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Volume2,
  ScanLine,
} from 'lucide-react';

interface InAppBarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedCode: string) => void;
}

export function InAppBarcodeScanner({
  isOpen,
  onClose,
  onScan,
}: InAppBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
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
  const [hasOpticalZoom, setHasOpticalZoom] = useState<boolean>(false);
  const zoomLevelRef = useRef<number>(1);
  zoomLevelRef.current = zoomLevel;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
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

  // 1. Web Audio API Beep Synthesizer (Chuẩn âm thanh quầy thu ngân siêu thị)
  const playBeepSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Double chirp (880Hz -> 1760Hz) cực kỳ trong trẻo và dễ chịu
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      // Audio not permitted or error
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

      // ƯU TIÊN 2: Bất kỳ camera sau nào không có chữ 'macro'
      const nonMacroBack = candidateList.find((d) => {
        const l = d.label.toLowerCase();
        return !l.includes('macro') && !l.includes('close-up');
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
      setHasOpticalZoom(Boolean(capabilities?.zoom));
      try {
        // ponytail: zoom quang + continuous focus là đủ nhanh, focusDistance thủ công dễ kẹt nét xa nên bỏ qua
        const wanted = zoomLevelRef.current === 2 ? 2 : 1;
        if (capabilities?.zoom) {
          const z = capabilities.zoom;
          const target = Math.min(Math.max(wanted, z.min ?? 1), z.max ?? wanted);
          await track.applyConstraints({ advanced: [{ zoom: target, focusMode: 'continuous' } as any] });
        } else {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
        }
      } catch {
        // máy không hỗ trợ zoom/focus: vẫn quét bằng crop 2x ở vòng decode bên dưới
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

  // 4b. Đổi zoom 1x/2x: ưu tiên zoom quang, không có thì crop trung tâm ở vòng decode
  const toggleZoom = async () => {
    const next = zoomLevel === 2 ? 1 : 2;
    setZoomLevel(next);
    zoomLevelRef.current = next;
    try {
      window.localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // bỏ qua
    }
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as any;
      if (track && caps?.zoom) {
        const target = Math.min(Math.max(next, caps.zoom.min ?? 1), caps.zoom.max ?? next);
        await track.applyConstraints({ advanced: [{ zoom: target, focusMode: 'continuous' } as any] });
      }
    } catch {
      // crop số ở dưới vẫn cho hiệu quả 2x cho bộ giải mã
    }
  };

  // 5. Xử lý khi nhận diện được Barcode thành công với cơ chế "Hãm phanh" (BV-02)
  const handleBarcodeFound = (rawCode: string) => {
    const cleanCode = rawCode.trim().replace(/[^0-9X-]/gi, '');
    if (!cleanCode) return;

    const now = Date.now();

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

    // Kêu bíp & rung haptic rõ rệt báo hiệu đã chốt đơn
    playBeepSound();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.([80, 50, 80]);
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
          const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
          const targetW = Math.round(video.videoWidth * scale);
          const targetH = Math.round(video.videoHeight * scale);
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
          if (zoomLevelRef.current === 2) {
            // Crop 50% trung tâm rồi phóng to = zoom số 2x cho bộ giải mã (đúng ý: không cần dí sát)
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            ctx.drawImage(video, vw * 0.25, vh * 0.25, vw * 0.5, vh * 0.5, 0, 0, targetW, targetH);
          } else {
            ctx.drawImage(video, 0, 0, targetW, targetH);
          }
          const barcodes = await barcodeDetector.detect(canvas);
          if (!isScanning) return;
          if (barcodes.length > 0) {
            framesWithoutBarcodeRef.current = 0;
            handleBarcodeFound(barcodes[0].rawValue);
          } else {
            // LOST-TRACK LOGIC (BV-02):
            // Không tìm thấy mã vạch nào trong frame này.
            // Nếu liên tiếp 4 frame (~800ms) không còn thấy mã vạch trong khung hình:
            // Tự động MỞ KHÓA (Unlock) để cho phép quét cuốn sách tiếp theo (hoặc quét lại cuốn này nếu lia vào lại)
            framesWithoutBarcodeRef.current += 1;
            if (framesWithoutBarcodeRef.current >= 4) {
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
      className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          stopCamera();
          onClose();
        }
      }}
    >
      <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
        {/* Header bar */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ScanLine className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-white">
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
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Video Area */}
        <div className="relative aspect-[4/3] sm:aspect-video bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            style={zoomLevel === 2 && !hasOpticalZoom ? { transform: 'scale(2)' } : undefined}
            playsInline
            muted
            autoPlay
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Laser Targeting Overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
            <div
              className={`relative w-64 sm:w-72 h-44 sm:h-48 rounded-2xl transition-all duration-300 ${
                scanSuccessAnim
                  ? 'border-4 border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.8)] scale-105'
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
        <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-center gap-2.5">
          {hasTorch && (
            <button
              onClick={toggleTorch}
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
            onClick={toggleZoom}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              zoomLevel === 2
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={hasOpticalZoom ? 'Zoom quang 2x: mã to gấp đôi, không cần dí sát' : 'Zoom số 2x: crop trung tâm cho bộ giải mã'}
          >
            <Camera className="w-4 h-4" />
            {zoomLevel === 2 ? 'Zoom 2x: Bật' : 'Zoom 1x'}
          </button>

          <button
            onClick={() => {
              const nextMode = facingMode === 'environment' ? 'user' : 'environment';
              setFacingMode(nextMode);
              setSelectedCameraId('');
              try {
                window.localStorage.removeItem(CAMERA_ID_KEY);
              } catch {
                // bỏ qua
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors"
          >
            <RotateCw className="w-4 h-4" />
            {facingMode === 'environment' ? 'Camera Sau' : 'Camera Trước'}
          </button>

          {/* Camera Lens Selector khi điện thoại có nhiều camera */}
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
      </div>
    </div>,
    document.body
  );
}
