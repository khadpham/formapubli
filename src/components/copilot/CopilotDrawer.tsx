'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  X,
  Send,
  Loader2,
  AlertTriangle,
  Boxes,
  BookOpen,
  Receipt,
  Scale,
  DollarSign,
  ShoppingCart,
  Maximize2,
  Minimize2,
  Trash2,
  CheckCircle2,
  Shield,
  Clock,
  Mic,
  Square,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';

export interface CopilotMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  toolUsed?: string | null;
  toolData?: any;
  timestamp: string;
  isError?: boolean;
}

interface CopilotDrawerProps {
  currentRole: UserRole;
  isOpen: boolean;
  onClose: () => void;
  /** mini: cua so chat nho goc phai duoi, luon hien huu moi trang; full: drawer phai nhu cu. */
  mode?: 'mini' | 'full';
  onMinimize?: () => void;
  onExpand?: () => void;
  /** Nhan don nhap tu tool prepare_sale_draft de op vao gio POS. */
  onApplyDraft?: (draft: { items: Array<{ editionId: string; quantity: number }>; customerName?: string; phone?: string; address?: string; note?: string }) => void;
}

const QUICK_PROMPT_CHIPS = [
  {
    label: '📦 Tồn kho toàn hệ thống',
    query: 'Báo cáo tồn kho khả dụng trên toàn hệ thống?',
  },
  {
    label: '📊 Doanh số 30 ngày',
    query: 'Báo cáo doanh số và đơn hàng trong 30 ngày qua (cả 2 sổ)?',
  },
  {
    label: '⚠️ Sách cạn kho',
    query: 'Những đầu sách nào đang cạn kho mức Đỏ (≤30 ngày) cần tái bản?',
  },
  {
    label: '💵 Đối soát két ca quầy',
    query: 'Đối soát két tiền ca làm việc hiện tại ở quầy bán hàng?',
  },
];


const HEADER_PREFIX_REGEX = /^#+\s*/;
const INLINE_FORMAT_REGEX = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function formatInline(text: string): React.ReactNode {
  const parts: (string | React.ReactNode)[] = [];
  const regex = new RegExp(INLINE_FORMAT_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-bold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={match.index} className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] text-indigo-700 font-semibold border border-slate-200">
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function CopilotDrawer({ currentRole, isOpen, onClose, mode = 'full', onMinimize, onExpand, onApplyDraft }: CopilotDrawerProps) {
  const isAuthorized = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const isMini = mode === 'mini';

  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content: `Xin chào Quý Lãnh đạo! Tôi là **Executive Copilot** (read-only v1) của Formapubli.
Tôi có thể tra cứu nhanh dữ liệu thời gian thực:
- **Tồn kho khả dụng** (3 địa điểm, chống âm kho)
- **Doanh số 2 sổ** (Sổ Thuế VAT & Sổ Quản trị nội bộ)
- **Cảnh báo cạn kho & Đề xuất in** (Chính sách đệm an toàn 105 ngày)
- **Đối soát két ca quầy** (Đầu ca, tiền mặt, số lệch ghi nhận)
- **Danh mục**: sách của 1 tác giả, tựa bắt đầu bằng chữ nào, tác giả được yêu thích
- **Lên đơn nháp**: nói "lấy 2 cuốn H01..." rồi bấm **Áp vào POS**, qua quầy kiểm tra và tự thanh toán`,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [rateLimitTimer, setRateLimitTimer] = useState<number | null>(null);
  const [appliedDraftIds, setAppliedDraftIds] = useState<Set<string>>(new Set());

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
  // Voice-to-text: MAC DINH dung Web Speech API cua trinh duyet (nhanh, co interim live
  // noi den dau chu hien den day, da kiem chung o POS/kho). Fallback Groq Whisper khi
  // trinh duyet khong ho tro (qua /api/ai/parse-voice-order).
  const voiceLive = useVoiceSearch();
  const voiceLiveRef = useRef(voiceLive);
  voiceLiveRef.current = voiceLive;
  // Giu cau noi cu: moi lan bam mic chi NOI TIEP vao sau, khong thay the.
  const voiceBaseRef = useRef<string>('');

  // Dong bo transcript live (interim) vao o nhap: noi den dau chu hien den day.
  useEffect(() => {
    if (!voiceLive.transcript) return;
    const base = voiceBaseRef.current.trim();
    const live = voiceLive.transcript.trim();
    setInputQuery(base ? (live ? base + ' ' + live : base) : live);
  }, [voiceLive.transcript]);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Dong drawer / unmount giua chung ghi am Whisper → dung + nha mic keo den mic treo.
  useEffect(() => {
    if (!isOpen && (isRecording || streamRef.current)) {
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {
        // Bo qua
      }
      setIsRecording(false);
      stopTracks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {
        // Bo qua
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
  }, [inputQuery]);

  // Tự động cuộn xuống cuối khi có tin nhắn mới
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Focus ô nhập liệu khi mở drawer
  useEffect(() => {
    if (isOpen && isAuthorized) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 200);
    }
  }, [isOpen, isAuthorized]);

  // Đếm ngược Rate Limit nếu bị 429
  useEffect(() => {
    if (rateLimitTimer === null || rateLimitTimer <= 0) return;
    const interval = setInterval(() => {
      setRateLimitTimer((prev) => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLimitTimer]);

  // Uu tien mic Copilot: khi drawer dang mo, Alt+V goi mic Copilot thay vi mic
  // cua trang POS/kho (capture + stopPropagation de chan handler bubble cua trang).
  // Esc dong drawer (khop hint UI). Dong/mount → dung Whisper + nha mic.
  const micHandlerRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isOpen || !isAuthorized) return;
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'V' || e.key === 'v' || e.code === 'KeyV')) {
        e.preventDefault();
        e.stopPropagation();
        micHandlerRef.current();
      }
    };
    const onKeyEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        try {
          voiceLiveRef.current?.stopListening();
        } catch {
          // Bo qua
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKeyEsc, true);
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKeyEsc, true);
    };
  }, [isOpen, isAuthorized, onClose]);

  const handleSend = async (queryToSend?: string) => {
    const text = (queryToSend || inputQuery).trim();
    if (!text || loading || !isAuthorized) return;
    // Dung nghe live khi gui de cau hoi chot, tranh transcript tiep tuc doi chu.
    try {
      voiceLive.stopListening();
    } catch {
      // Bo qua
    }

    const userMsg: CopilotMessage = {
      id: 'msg_' + Date.now(),
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    voiceBaseRef.current = '';
    setLoading(true);

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const waitSec = Math.ceil((json.resetAfterMs || 60000) / 1000);
          setRateLimitTimer(waitSec);
          setMessages((prev) => [
            ...prev,
            {
              id: 'err_' + Date.now(),
              sender: 'assistant',
              content: `⚠️ **Vượt quá tần suất truy vấn**: ${json.message || '15 req/phút'}. Vui lòng đợi ${waitSec} giây.`,
              timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
              isError: true,
            },
          ]);
          return;
        }

        if (res.status === 401 || res.status === 403) {
          setMessages((prev) => [
            ...prev,
            {
              id: 'err_' + Date.now(),
              sender: 'assistant',
              content: `🚫 **Từ chối truy cập**: Bạn cần quyền **ROLE_OWNER** hoặc **ROLE_MANAGER** để sử dụng tính năng này. (${json.message})`,
              timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
              isError: true,
            },
          ]);
          return;
        }

        throw new Error(json.message || `Lỗi máy chủ (${res.status})`);
      }

      if (json.success && json.data) {
        setMessages((prev) => [
          ...prev,
          {
            id: 'resp_' + Date.now(),
            sender: 'assistant',
            content: json.data.answer || 'Không có nội dung phản hồi.',
            toolUsed: json.data.toolUsed,
            toolData: json.data.toolData,
            timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      } else {
        throw new Error(json.message || 'Định dạng dữ liệu không hợp lệ');
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'err_' + Date.now(),
          sender: 'assistant',
          content: `❌ **Lỗi kết nối Copilot**: ${err?.message || 'Không thể liên lạc với máy chủ.'}`,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: 'welcome_' + Date.now(),
        sender: 'assistant',
        content: `Đã làm mới phiên hội thoại. Quý Lãnh đạo có thể chọn câu hỏi gợi ý bên dưới hoặc nhập câu hỏi mới.`,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // Voice-to-text cho Copilot: ghi am -> Groq Whisper STT -> do transcript vao o nhap lieu.
  // Chi dung khi trinh duyet KHONG ho tro Web Speech API (fallback).
  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const sendVoiceToStt = async (blob: Blob) => {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      const form = new FormData();
      form.append('audio', blob, 'copilot-voice.webm');
      const res = await fetch('/api/ai/parse-voice-order', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setVoiceError('Không có quyền dùng giọng nói. Hãy nhập tay.');
        return;
      }
      if (!res.ok || !json?.success) {
        setVoiceError(json?.message || 'STT lỗi — hãy nhập tay.');
        return;
      }
      const transcript: string = json.data?.transcript || '';
      if (transcript) {
        setInputQuery((prev) => (prev.trim() ? prev.trim() + ' ' + transcript : transcript));
        inputRef.current?.focus();
      } else {
        setVoiceError('Không nghe rõ — nói lại gần mic hơn hoặc nhập tay.');
      }
    } catch {
      setVoiceError('Mất kết nối STT — hãy nhập tay.');
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleMicClick = () => {
    if (voiceLive.isSupported) {
      // Engine mac dinh: Web Speech API — interim live, noi den dau chu hien den day.
      if (voiceLive.isListening) {
        voiceLive.stopListening();
      } else {
        setVoiceError(null);
        // Chot cau cu lam nen truoc khi noi tiep.
        voiceBaseRef.current = inputQuery;
        inputRef.current?.focus();
        voiceLive.startListening();
      }
      return;
    }
    // Fallback: thu am gui Whisper.
    toggleVoiceRecording();
  };

  const micActive = voiceLive.isListening || isRecording;
  const micBusy = voiceBusy;

  // Dang ky handler mic moi nhat cho phim tat Alt+V (capture).
  useEffect(() => {
    micHandlerRef.current = handleMicClick;
  });

  const toggleVoiceRecording = async () => {
    if (voiceBusy || loading) return;
    if (isRecording && recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    setVoiceError(null);
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setVoiceError('Thiết bị/trình duyệt không hỗ trợ micro — hãy nhập tay.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        setIsRecording(false);
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size > 0) await sendVoiceToStt(blob);
      };
      rec.start();
      setIsRecording(true);
    } catch {
      setVoiceError('Không mở được micro — kiểm tra quyền trình duyệt.');
    }
  };

  // Render Markdown cơ bản an toàn (bullet, bold, code block, line breaks)
  const renderMarkdownContent = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed">
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={idx} className="h-1.5" />;
          }

          // Bullet item
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const content = trimmed.substring(2);
            return (
              <div key={idx} className="flex items-start gap-2 pl-2">
                <span className="text-indigo-500 font-bold mt-0.5">•</span>
                <span className="flex-1">{formatInline(content)}</span>
              </div>
            );
          }

          // Header 3/4 (### hoặc ##)
          if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
            const hText = trimmed.replace(HEADER_PREFIX_REGEX, '');
            return (
              <p key={idx} className="font-extrabold text-slate-900 mt-2 mb-1">
                {formatInline(hText)}
              </p>
            );
          }

          // Alert / Disclaimer Block
          if (trimmed.startsWith('> ') || trimmed.startsWith('⚠️') || trimmed.startsWith('💵') || trimmed.startsWith('📦') || trimmed.startsWith('📊')) {
            return (
              <p key={idx} className="font-medium text-slate-800">
                {formatInline(trimmed)}
              </p>
            );
          }

          return (
            <p key={idx} className="text-slate-800">
              {formatInline(trimmed)}
            </p>
          );
        })}
      </div>
    );
  };



  const getToolBadge = (toolName?: string | null) => {
    if (!toolName) return null;
    const map: Record<string, { label: string; icon: any; color: string }> = {
      query_stock_level: { label: 'Tồn kho Ledger', icon: Boxes, color: 'bg-amber-50 text-amber-700 border-amber-200' },
      query_sales_summary: { label: 'Doanh số 2 sổ', icon: Receipt, color: 'bg-sky-50 text-sky-700 border-sky-200' },
      query_reprint_forecast: { label: 'Dự báo in 105 ngày', icon: Scale, color: 'bg-purple-50 text-purple-700 border-purple-200' },
      query_cashbox_reconciliation: { label: 'Đối soát két ca', icon: DollarSign, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      query_catalog: { label: 'Danh mục sách', icon: BookOpen, color: 'bg-rose-50 text-rose-700 border-rose-200' },
      prepare_sale_draft: { label: 'Đơn nháp POS', icon: ShoppingCart, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    };
    const info = map[toolName] || { label: toolName, icon: Sparkles, color: 'bg-slate-50 text-slate-700 border-slate-200' };
    const Icon = info.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${info.color}`}>
        <Icon className="w-3 h-3" />
        {info.label}
      </span>
    );
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <>
      {/* Backdrop — chi o che do full */}
      {!isMini && (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-xs transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer Panel */}
      <aside
        className={
          isMini
            ? 'fixed bottom-4 right-4 z-[70] flex flex-col bg-white shadow-2xl border border-slate-200 rounded-2xl overflow-hidden transition-all duration-300 ease-in-out w-[380px] max-w-[calc(100vw-2rem)] h-[540px] max-h-[calc(100vh-6rem)]'
            : 'fixed top-0 bottom-0 right-0 z-[70] flex flex-col bg-white shadow-2xl border-l border-slate-200 transition-all duration-300 ease-in-out w-[calc(100%_-_1rem)] md:w-[480px]'
        }
        role="dialog"
        aria-modal={!isMini}
        aria-label="Executive AI Copilot"
      >
        {/* Header */}
        <div className="h-16 px-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-extrabold text-sm tracking-tight">Executive Copilot</h2>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  v1.0 Read-only
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Thẩm quyền: <span className="text-emerald-400 font-semibold">{currentRole}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!isMini && onMinimize && (
              <button
                onClick={onMinimize}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                title="Thu nhỏ thành bong bóng chat góc phải"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            {isMini && onExpand && (
              <button
                onClick={onExpand}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                title="Mở rộng toàn màn hình phải"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleClearHistory}
              className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
              title="Làm mới hội thoại"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Đóng (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Warning Banner: Thẩm quyền / Quyền hạn */}
        {!isAuthorized ? (
          <div className="p-6 bg-rose-50 border-b border-rose-200 text-rose-900 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base">Từ chối truy cập Copilot</h3>
            <p className="text-xs text-rose-700 leading-relaxed max-w-sm">
              Executive Copilot được bảo vệ bởi rào chắn RBAC nghiêm ngặt. Chỉ tài khoản với vai trò{' '}
              <strong>ROLE_OWNER</strong> hoặc <strong>ROLE_MANAGER</strong> mới có thẩm quyền tra cứu số liệu điều hành.
            </p>
            <span className="text-[11px] font-mono text-slate-500 bg-white px-2.5 py-1 rounded border border-rose-200">
              Vai trò hiện tại của bạn: {currentRole}
            </span>
          </div>
        ) : (
          <div className="px-4 py-2 bg-indigo-50/60 border-b border-indigo-100/80 flex items-center justify-between text-[11px] text-indigo-900">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              Chế độ An Toàn 100% Read-only: AI không có quyền sửa kho, đơn hay quỹ.
            </span>
            <span className="text-slate-400 font-mono text-[10px] hidden sm:inline">Phím tắt: Alt+C</span>
          </div>
        )}

        {/* Chat Message Scroll Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const isReconciliation = msg.toolUsed === 'query_cashbox_reconciliation';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-slate-400">
                  <span className="font-semibold">{isUser ? 'Quý Lãnh đạo' : 'Executive Copilot'}</span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                  {getToolBadge(msg.toolUsed)}
                </div>

                <div
                  className={`rounded-2xl p-3.5 max-w-[92%] shadow-sm ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-tr-xs'
                      : msg.isError
                      ? 'bg-rose-50 border border-rose-200 text-rose-900 rounded-tl-xs'
                      : 'bg-white border border-slate-200 text-slate-900 rounded-tl-xs'
                  }`}
                >
                  {isUser ? (
                    <p className="text-xs sm:text-sm font-medium whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    renderMarkdownContent(msg.content)
                  )}

                  {/* Disclaimer đặc thù khi gọi Tool Đối soát két tiền ca quầy */}
                  {isReconciliation && (
                    <div className="mt-3 pt-2.5 border-t border-amber-200/80 bg-amber-50/80 -mx-3.5 -mb-3.5 p-3 rounded-b-2xl flex items-start gap-2 text-[11px] text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold">Lưu ý Điều hành:</strong> Đây là số liệu đối soát kỹ thuật
                        giữa hệ thống ghi nhận và két quầy. Tuyệt đối không suy diễn thành hành vi gian lận khi
                        chưa có biên bản kiểm quỹ thực tế.
                      </div>
                    </div>
                  )}

                  {/* Nut Ap don nhap vao gio POS — user van tu bam Thanh toan */}
                  {msg.toolUsed === 'prepare_sale_draft' && Array.isArray(msg.toolData?.items) && msg.toolData.items.length > 0 && onApplyDraft && (
                    <button
                      disabled={appliedDraftIds.has(msg.id)}
                      onClick={() => {
                        // Validate + chuan hoa truoc khi op: editionId chuoi, qty 1..999.
                        const items = msg.toolData.items
                          .filter((it: any) => it && typeof it.editionId === 'string' && it.editionId.trim())
                          .map((it: any) => ({
                            editionId: it.editionId.trim(),
                            quantity: Math.min(999, Math.max(1, Math.floor(Number(it.quantity) || 1))),
                          }));
                        if (items.length === 0) return;
                        setAppliedDraftIds((prev) => new Set(prev).add(msg.id));
                        onApplyDraft({
                          items,
                          customerName: typeof msg.toolData.customerName === 'string' ? msg.toolData.customerName : undefined,
                          phone: typeof msg.toolData.phone === 'string' ? msg.toolData.phone : undefined,
                          address: typeof msg.toolData.address === 'string' ? msg.toolData.address : undefined,
                          note: typeof msg.toolData.note === 'string' ? msg.toolData.note : undefined,
                        });
                      }}
                      className="mt-2.5 w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      {appliedDraftIds.has(msg.id) ? 'Đã áp vào POS — qua quầy để thanh toán' : `Áp vào POS (${msg.toolData.items.length} dòng) — qua quầy để thanh toán`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex items-center gap-2 text-slate-500 text-xs pl-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>Copilot đang phân tích câu hỏi & tra cứu dữ liệu thực...</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Quick Prompt Chips */}
        {isAuthorized && (
          <div className="p-2.5 bg-white border-t border-slate-100 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
            {QUICK_PROMPT_CHIPS.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(chip.query)}
                disabled={loading || rateLimitTimer !== null}
                className="whitespace-nowrap px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 border border-slate-200 text-slate-700 transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <div className="p-3 bg-white border-t border-slate-200 shrink-0">
          {rateLimitTimer !== null && rateLimitTimer > 0 ? (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <Clock className="w-4 h-4 text-amber-600" />
                Giới hạn 15 req/phút: Vui lòng đợi {rateLimitTimer}s trước khi hỏi tiếp.
              </span>
              <span className="font-mono font-bold text-amber-700">{rateLimitTimer}s</span>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-end gap-2"
            >
              <button
                type="button"
                onClick={handleMicClick}
                disabled={!isAuthorized || loading || micBusy}
                title={
                  micActive
                    ? 'Dừng nghe'
                    : voiceLive.isSupported
                    ? 'Nói để nhập câu hỏi — chữ hiện trực tiếp khi nói (nhận diện trên trình duyệt)'
                    : 'Nói để nhập câu hỏi (ghi âm gửi Whisper)'
                }
                className={`h-10 w-10 rounded-xl border flex items-center justify-center transition-all shrink-0 disabled:opacity-50 cursor-pointer ${
                  micActive
                    ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                    : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-300'
                }`}
              >
                {micBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : micActive ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                disabled={!isAuthorized || loading}
                value={inputQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onChange={(e) => {
                  // Nguoi dung go tay khi dang nghe: dung voice, giu cau da co, nguoi tiep quan.
                  if (voiceLive.isListening) {
                    try {
                      voiceLive.stopListening();
                    } catch {
                      // Bo qua
                    }
                    voiceBaseRef.current = e.target.value;
                  }
                  setInputQuery(e.target.value);
                }}
                placeholder={
                  !isAuthorized
                    ? 'Bạn không có quyền truy vấn Copilot...'
                    : 'Hỏi về tồn kho, 2 sổ doanh thu, dự báo in 105 ngày, két quầy... hoặc bấm mic để nói'
                }
                className="flex-1 min-h-10 max-h-36 resize-none overflow-y-auto bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!isAuthorized || loading || !inputQuery.trim()}
                className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50 active:scale-95 shrink-0 cursor-pointer"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span className="hidden sm:inline">Gửi</span>
              </button>
            </form>
          )}

          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-1">
            <span>
              {voiceLive.isListening
                ? 'Đang nghe trực tiếp... nói đến đâu chữ hiện đến đấy, bấm nút vuông để dừng.'
                : isRecording
                ? 'Đang ghi âm... bấm nút vuông để dừng và chuyển thành văn bản.'
                : voiceError || voiceLive.error
                ? voiceError || voiceLive.error
                : 'Executive Copilot • Dữ liệu nội bộ bảo mật Formapubli'}
            </span>
            <span>Esc để đóng • Alt+C để bật/tắt</span>
          </div>
        </div>
      </aside>
    </>,
    document.body
  );
}
