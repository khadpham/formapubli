'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  Barcode,
} from 'lucide-react';

interface InAppBarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedCode: string) => void;
  sampleBooks?: Array<{ code: string; title: string; isbn?: string | null }>;
}

export function InAppBarcodeScanner({
  isOpen,
  onClose,
  onScan,
  sampleBooks = [],
}: InAppBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanSuccessAnim, setScanSuccessAnim] = useState<boolean>(false);
  const [detectorSupported, setDetectorSupported] = useState<boolean>(true);

  const lastScannedTimeRef = useRef<number>(0);
  const didPostPermissionRescanRef = useRef<boolean>(false);

  const [availableCameras, setAvailableCameras] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

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

  // 2. Khởi động Camera Stream
  const startCamera = async (targetDeviceId?: string) => {
    setErrorMessage(null);
    stopCamera();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Trình duyệt của bạn không hỗ trợ truy cập Camera trực tiếp.');
      }

      // Tìm thiết bị phù hợp nhất nếu chưa có
      const activeDeviceId = targetDeviceId || (await enumerateAndSelectBestCamera());

      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
      };

      if (activeDeviceId) {
        videoConstraints.deviceId = { exact: activeDeviceId };
      } else {
        videoConstraints.facingMode = { ideal: facingMode };
      }

      // Bật autofocus liên tục nếu trình duyệt hỗ trợ.
      // Lưu ý: không ép zoom 1.0 ở lần đầu vì một số Android ném OverconstrainedError.
      // Chỉ thử focusMode, nếu lỗi sẽ fallback về constraints tối thiểu bên dưới.
      (videoConstraints as any).advanced = [{ focusMode: 'continuous' }];

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

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
          const currentTrackId = stream.getVideoTracks()[0]?.getSettings?.() as any;
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
          void currentTrackId;
        }
      } catch {
        // Bỏ qua, giữ stream hiện tại — không chặn quét.
      }

      // Kiểm tra hỗ trợ Flash / Torch
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as any;
      if (capabilities && capabilities.torch) {
        setHasTorch(true);
      } else {
        setHasTorch(false);
      }
    } catch (err: any) {
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
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
          });
          streamRef.current = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await videoRef.current.play();
          }
          setHasPermission(true);
          // Vẫn enumerate lại để lấp dropdown chọn ống kính cho lần sau.
          try {
            await enumerateAndSelectBestCamera();
          } catch {
            // bỏ qua
          }
          return;
        } catch (fallbackErr) {
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

  // 5. Xử lý khi nhận diện được Barcode thành công
  const handleBarcodeFound = (rawCode: string) => {
    const cleanCode = rawCode.trim().replace(/[^0-9X-]/gi, '');
    const now = Date.now();

    // Khóa chống quét lặp lại cùng 1 mã trong vòng 1.5 giây
    if (cleanCode === lastScanned && now - lastScannedTimeRef.current < 1500) {
      return;
    }

    lastScannedTimeRef.current = now;
    setLastScanned(cleanCode);

    // Kêu bíp & rung haptic
    playBeepSound();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.([60, 40, 60]);
    }

    // Hiệu ứng viền xanh nhấp nháy
    setScanSuccessAnim(true);
    setTimeout(() => setScanSuccessAnim(false), 800);

    // Bắn sự kiện lên component cha (POS Terminal)
    onScan(cleanCode);
  };

  // 6. Quét Barcode liên tục qua BarcodeDetector API native
  useEffect(() => {
    if (!isOpen) {
      didPostPermissionRescanRef.current = false;
      stopCamera();
      return;
    }

    startCamera();

    let isScanning = true;
    let barcodeDetector: any = null;

    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        barcodeDetector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'qr_code', 'upc_a', 'upc_e'],
        });
        setDetectorSupported(true);
      } catch (e) {
        setDetectorSupported(false);
      }
    } else {
      setDetectorSupported(false);
    }

    const intervalId = setInterval(async () => {
      if (!isScanning || !videoRef.current || videoRef.current.readyState < 2) return;

      if (barcodeDetector) {
        try {
          const barcodes = await barcodeDetector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            handleBarcodeFound(barcodes[0].rawValue);
          }
        } catch (err) {
          // Bỏ qua lỗi frame đơn lẻ
        }
      }
    }, 150);

    return () => {
      isScanning = false;
      clearInterval(intervalId);
      stopCamera();
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
        {/* Header bar */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ScanLine className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-white">
                Súng Quét Mã Vạch Camera 0 Đồng
              </h3>
              <p className="text-[11px] text-slate-400">
                Lia camera vào mã ISBN-13 sau bìa sách để tự động thêm giỏ
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

              {/* Center crosshair */}
              <div className="absolute inset-0 flex items-center justify-center text-white/30 text-xs font-mono">
                [ CĂN MÃ VẠCH VÀO KHUNG ]
              </div>
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
            onClick={() => {
              const nextMode = facingMode === 'environment' ? 'user' : 'environment';
              setFacingMode(nextMode);
              setSelectedCameraId('');
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

        {/* Simulated Barcode Strip for Instant Testing */}
        <div className="p-3 bg-slate-950/70 overflow-y-auto max-h-44 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
            <span className="font-bold flex items-center gap-1">
              <Barcode className="w-3.5 h-3.5 text-indigo-400" />
              Mã Vạch Test Nhanh (Click để quét thử trực tiếp):
            </span>
            <span className="text-[10px] text-slate-500">Mô phỏng súng quét</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {(sampleBooks.length > 0
              ? sampleBooks.slice(0, 6)
              : [
                  { code: 'H01', title: 'Bệnh tưởng', isbn: '9786043687507' },
                  { code: 'H02', title: 'Người biển lận', isbn: '9786043687491' },
                  { code: 'H03', title: 'Trưởng giả học làm sang', isbn: '9786043687484' },
                  { code: 'H21', title: 'Le Spleen de Paris', isbn: '9786044737690' },
                  { code: 'H48', title: 'Dưỡng đường đồng hồ cát', isbn: '9786044737706' },
                  { code: 'H81', title: 'Nhà tiên tri', isbn: '9786044737713' },
                ]
            ).map((book) => {
              const isbnClean = book.isbn ? book.isbn.replace(/[^0-9]/g, '') : '';
              return (
                <button
                  key={book.code}
                  onClick={() => isbnClean && handleBarcodeFound(isbnClean)}
                  className="flex flex-col text-left p-2 rounded-xl bg-slate-800/80 hover:bg-indigo-600/30 hover:border-indigo-500/50 border border-slate-700/60 transition-all active:scale-95 group"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono text-[10px] font-bold text-indigo-400 group-hover:text-indigo-300">
                      [{book.code}]
                    </span>
                    <span className="font-mono text-[9px] text-slate-400">
                      {isbnClean.slice(-4)}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-200 truncate w-full mt-0.5">
                    {book.title}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 group-hover:text-indigo-300 truncate">
                    {isbnClean || 'Chưa có ISBN'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
