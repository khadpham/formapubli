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
  Truck,
  Maximize2,
  Minimize2,
  Trash2,
  CheckCircle2,
  Shield,
  Clock,
  Mic,
  Square,
} from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { matchActionShortcut } from '@/lib/keyboard';

export interface CopilotMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  toolUsed?: string | null;
  toolData?: any;
  /** Model nào viết câu trả lời (server báo): 'gemini:X', 'openai:Y' hoặc 'nội bộ'. */
  engine?: string | null;
  timestamp: string;
  isError?: boolean;
}

/**
 * Lấy draft chuyển kho từ message - hỗ trợ cả single-tool
 * (`toolUsed === 'prepare_transfer_draft'`) và multi-tool
 * (`toolUsed === 'a + prepare_transfer_draft'`, data nằm ở
 * `toolData['prepare_transfer_draft']` - mirror formatFallbackAnswer).
 */
export function getTransferDraftData(toolUsed: string | null | undefined, toolData: any): any | null {
  if (!toolUsed || !toolData) return null;
  if (toolUsed === 'prepare_transfer_draft') return toolData;
  if (toolUsed.includes('prepare_transfer_draft')) {
    const chunk = (toolData as Record<string, any>)['prepare_transfer_draft'];
    return chunk ?? null;
  }
  return null;
}

interface CopilotDrawerProps {
  currentRole: UserRole;
  /** Tên người dùng thật từ session (hiện thay cho mã vai trò). */
  displayName?: string;
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
    query: 'Báo cáo doanh số và đơn trong 30 ngày qua (cả 2 sổ)?',
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

/** Tên gọi mặc định khi chưa có tên người dùng - thống nhất một chỗ. */
const DEFAULT_LEADER_NAME = 'Lãnh đạo';

/** Các giai đoạn loading hiển thị luân phiên khi chờ Copilot trả lời. */
const LOADING_STAGES = [
  'Đang phân tích câu hỏi…',
  'Đang tra cứu dữ liệu thực…',
  'Đang tổng hợp câu trả lời…',
];

/** Chips gợi ý theo ngữ cảnh giờ/ngày - sáng sớm và cuối tháng có chip riêng. */
function getContextualChips(): Array<{ label: string; query: string }> {
  const now = new Date();
  const chips = [...QUICK_PROMPT_CHIPS];
  if (now.getHours() < 12) {
    chips.unshift(
      { label: '📊 Doanh số hôm qua', query: 'Doanh số hôm qua thế nào?' },
      { label: '⚠️ Tồn kho cạn', query: 'Những đầu sách nào sắp cạn kho cần tái bản?' },
    );
  }
  // Minor 18: hằng có tên cho ngưỡng ngày hiện chip công nợ (cuối tháng).
  const DEBT_CHIP_DAY_THRESHOLD = 25;
  if (now.getDate() >= DEBT_CHIP_DAY_THRESHOLD) {
    chips.unshift({ label: '💰 Công nợ đại lý', query: 'Công nợ các đại lý hiện tại ra sao?' });
  }
  return chips;
}


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

/** Danh sách LLM cho lãnh đạo chọn tay. `hint` là ghi chú ngắn về độ ổn định
 *  đo thật 06/10/2026 - giúp chọn mà không phải đoán. */
/** Danh sách LLM cho lãnh đạo chọn tay - CHỈ model đã đo thật gọi được:
 *  - Gemini 3.8 / 3.5 / 3.5-lite: server gọi qua fallback (3.8 hay 503, lite ổn định nhất)
 *  - Nemotron 120B (CF): HTTP 3/3 + JSON 3/3 - mặc định free
 *  - GPT-OSS 120B (CF): HTTP 3/3, JSON 1/3 - giữ để so sánh
 *  - GLM-4.7 Flash (CF): chủ yêu cầu giữ, chậm 25–45s, HTTP 1/3
 *  - Groq 120B/20B: rất nhanh, JSON chuẩn
 *  LOẠI có lý do: llama-3.3-70b (trả văn bản tự do, không JSON), glm-5.2/5.3
 *  (HTTP 403), qwen Groq (bịa mã sách), OpenAI (chưa có key trên Worker). */
const MODEL_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'auto', label: '⚡ Tự động', hint: 'Server tự chọn chuỗi dự phòng' },
  { value: 'gemini-3.8-flash', label: '✨ Gemini 3.8', hint: 'Hay nhất, hay 503' },
  { value: 'gemini-3.5-flash', label: '✨ Gemini 3.5', hint: 'Bản giữa' },
  { value: 'gemini-3.5-flash-lite', label: '✨ Gemini 3.5 Lite', hint: 'Ổn định nhất' },
  { value: 'cf/nemotron-3-120b-a12b', label: '🆓 Nemotron 120B (CF)', hint: 'Free, JSON 3/3' },
  { value: 'cf/gpt-oss-120b', label: '🆓 GPT-OSS 120B (CF)', hint: 'Free, JSON 1/3' },
  { value: 'cf/glm-4.7-flash', label: '🆓 GLM-4.7 Flash (CF)', hint: 'Free, chậm 25–45s' },
  { value: 'groq/gpt-oss-120b', label: '🧠 Groq 120B', hint: 'Rất nhanh' },
  { value: 'groq/gpt-oss-20b', label: '🧠 Groq 20B', hint: 'Nhanh, nhẹ' },
  { value: 'local', label: '📏 Luật nội bộ', hint: 'Không gọi LLM' },
];

const MODEL_LABEL: Record<string, string> = Object.fromEntries(
  MODEL_OPTIONS.map((m) => [m.value, m.label])
);

export function CopilotDrawer({ currentRole, displayName, isOpen, onClose, mode = 'full', onMinimize, onExpand, onApplyDraft }: CopilotDrawerProps) {
  const isAuthorized = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const isMini = mode === 'mini';

  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  /** Giai đoạn loading đang hiển thị (luân phiên mỗi 2.5s khi chờ). */
  const [loadingStage, setLoadingStage] = useState(0);
  /** GĐ2: tên tool đang chạy thật từ SSE - ưu tiên hơn loadingStage chung chung. */
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) {
      setLoadingStage(0);
      return;
    }
    setLoadingStage(0);
    const t = setInterval(() => setLoadingStage((s) => (s + 1) % LOADING_STAGES.length), 2500);
    return () => clearInterval(t);
  }, [loading]);
  /** Model đang chọn: auto (server quyết) | gemini-* | cf/* | groq/* | local. */
  const [copilotModel, setCopilotModel] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('formapubli.copilot.model') || 'auto';
      return MODEL_OPTIONS.some((m) => m.value === saved) ? saved : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content: `Chào sếp. Em tra cứu giúp tồn kho, doanh số, két tiền, danh mục và nhịp bán - sếp cứ hỏi, em đi lấy số thật.`,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [rateLimitTimer, setRateLimitTimer] = useState<number | null>(null);
  const [appliedDraftIds, setAppliedDraftIds] = useState<Set<string>>(new Set());
  /** Phiếu chuyển kho đã bấm "Xác nhận tạo phiếu" (chống double-click) + kết quả. */
  const [confirmedTransferIds, setConfirmedTransferIds] = useState<Set<string>>(new Set());
  const [transferResults, setTransferResults] = useState<Record<string, string>>({});

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
      if (matchActionShortcut(e, 'KeyV') || matchActionShortcut(e, 'KeyV', { shift: true })) {
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
    setLiveStatus(null);

    try {
      // Gửi kèm lịch sử để server nối được câu này với câu trước (đại từ
      // "nó/cuốn đó" không có dữ liệu nếu không mang theo hội thoại).
      const priorTurns = messages
        .filter((m) => !m.isError)
        .map((m) => ({ role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content }));
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          model: copilotModel === 'auto' ? undefined : copilotModel,
          history: priorTurns.slice(-8),
        }),
      });

      if (!res.ok) {
        // Lỗi HTTP (403/429/...) vẫn trả JSON như cũ.
        const json = await res.json().catch(() => ({}));
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
              content: `🚫 **Từ chối truy cập**: Bạn cần quyền **Chủ Quản Lý** hoặc **Quản Lý Vận Hành** để sử dụng tính năng này. (${json.message})`,
              timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
              isError: true,
            },
          ]);
          return;
        }

        throw new Error(json.message || `Lỗi máy chủ (${res.status})`);
      }

      // GĐ2: đọc SSE stream - hiện tên tool đang chạy trực tiếp.
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Không đọc được luồng phản hồi.');
      const decoder = new TextDecoder();
      let buffer = '';
      let finalData: any = null;
      const handleSseEvent = (event: string, data: any) => {
        if (event === 'tool_start') {
          // "Chuẩn bị" cho tool ghi nháp - "tra cứu" chỉ đúng với tool đọc.
          const verb = data.toolName === 'prepare_transfer_draft' ? 'Đang chuẩn bị' : 'Đang tra cứu';
          setLiveStatus(`${verb}: ${data.label || data.toolName}...`);
        } else if (event === 'synthesizing') {
          setLiveStatus('Đang tổng hợp câu trả lời...');
        } else if (event === 'done') {
          finalData = data;
        } else if (event === 'error') {
          throw new Error(data.message || 'Lỗi xử lý Copilot.');
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const m = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]*)$/);
            if (m) {
              const eventName = m[1].trim();
              let eventData: any = null;
              try {
                eventData = JSON.parse(m[2]);
              } catch {
                continue; // chunk hỏng - bỏ qua
              }
              // event error phải văng ra ngoài để hiện lỗi, không được nuốt
              handleSseEvent(eventName, eventData);
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }

      if (finalData) {
        setMessages((prev) => [
          ...prev,
          {
            id: 'resp_' + Date.now(),
            sender: 'assistant',
            content: finalData.answer || 'Không có nội dung phản hồi.',
            toolUsed: finalData.toolUsed,
            toolData: finalData.toolData,
            engine: finalData.engine || null,
            timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      } else {
        throw new Error('Định dạng dữ liệu không hợp lệ');
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
      setLiveStatus(null);
    }
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: 'welcome_' + Date.now(),
        sender: 'assistant',
        content: `Đã xoá hội thoại cũ. Sếp hỏi đi, em bắt đầu từ đây.`,
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
        setVoiceError(json?.message || 'STT lỗi - hãy nhập tay.');
        return;
      }
      const transcript: string = json.data?.transcript || '';
      if (transcript) {
        setInputQuery((prev) => (prev.trim() ? prev.trim() + ' ' + transcript : transcript));
        inputRef.current?.focus();
      } else {
        setVoiceError('Không nghe rõ - nói lại gần mic hơn hoặc nhập tay.');
      }
    } catch {
      setVoiceError('Mất kết nối STT - hãy nhập tay.');
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleMicClick = () => {
    if (voiceLive.isSupported) {
      // Engine mac dinh: Web Speech API - interim live, noi den dau chu hien den day.
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
        setVoiceError('Thiết bị/trình duyệt không hỗ trợ micro - hãy nhập tay.');
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
      setVoiceError('Không mở được micro - kiểm tra quyền trình duyệt.');
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
      query_product_flow: { label: 'Nhịp bán', icon: Clock, color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
      query_sales_lines: { label: 'Món bán', icon: Receipt, color: 'bg-sky-50 text-sky-700 border-sky-200' },
      query_shift_split: { label: 'Sáng/Chiều', icon: Clock, color: 'bg-orange-50 text-orange-700 border-orange-200' },
      query_period_compare: { label: 'So kỳ', icon: Scale, color: 'bg-teal-50 text-teal-700 border-teal-200' },
      query_transfer_history: { label: 'Luân chuyển', icon: Boxes, color: 'bg-lime-50 text-lime-700 border-lime-200' },
      query_gift_return: { label: 'Quà/Trả hàng', icon: ShoppingCart, color: 'bg-pink-50 text-pink-700 border-pink-200' },
      query_order_lookup: { label: 'Tra đơn', icon: Receipt, color: 'bg-violet-50 text-violet-700 border-violet-200' },
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
      {/* Backdrop - chi o che do full */}
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
            : 'fixed top-0 bottom-0 right-0 z-[70] flex flex-col bg-white shadow-2xl border-l border-slate-200 transition-all duration-300 ease-in-out w-full sm:w-[480px]'
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
                {displayName || DEFAULT_LEADER_NAME} · <span className="text-emerald-400 font-semibold">{USER_ROLES[currentRole].label}</span>
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
              title="Đóng"
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
              <strong>Chủ Quản Lý</strong> hoặc <strong>Quản Lý Vận Hành</strong> mới có thẩm quyền tra cứu số liệu điều hành.
            </p>
            <span className="text-[11px] font-mono text-slate-500 bg-white px-2.5 py-1 rounded border border-rose-200">
              Vai trò hiện tại của bạn: {USER_ROLES[currentRole].label}
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
                  <span className="font-semibold">{isUser ? (displayName || DEFAULT_LEADER_NAME) : 'Executive Copilot'}</span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                  {getToolBadge(msg.toolUsed)}
                  {!isUser && msg.engine && (
                    <span
                      title={`Câu trả lời do ${msg.engine} viết (nội bộ = luật cứng, không LLM)`}
                      className={`px-1.5 py-px rounded-full font-mono font-bold border ${
                        msg.engine === 'nội bộ'
                          ? 'bg-slate-100 text-slate-500 border-slate-200'
                          : 'bg-violet-50 text-violet-700 border-violet-200'
                      }`}
                    >
                      {msg.engine === 'nội bộ' ? 'luật nội bộ' : msg.engine}
                    </span>
                  )}
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

                  {/* Nut Ap don nhap vao gio POS - user van tu bam Thanh toan */}
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
                      {appliedDraftIds.has(msg.id) ? 'Đã áp vào POS - qua quầy để thanh toán' : `Áp vào POS (${msg.toolData.items.length} dòng) - qua quầy để thanh toán`}
                    </button>
                  )}

                  {/* Dialog xac nhan phieu chuyen kho - user bam moi goi API dispatch that.
                      Dung getTransferDraftData de ho tro ca multi-tool ("a + prepare_transfer_draft"). */}
                  {(() => {
                    const draftData = getTransferDraftData(msg.toolUsed, msg.toolData);
                    if (!draftData || !Array.isArray(draftData.items) || draftData.items.length === 0) return null;
                    return (
                    <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <div className="text-xs font-bold text-amber-800 mb-1.5 flex items-center gap-1.5">
                        <Truck className="w-4 h-4" />
                        Xác nhận phiếu chuyển kho
                      </div>
                      <div className="text-xs text-slate-700 mb-1.5">
                        Từ: <strong>{draftData.fromWarehouseName || '?'}</strong>
                        {' → '}
                        Đến: <strong>{draftData.toWarehouseName || '?'}</strong>
                      </div>
                      <ul className="text-xs text-slate-700 space-y-0.5 mb-2">
                        {(draftData.items as any[]).slice(0, 10).map((it: any, i: number) => (
                          <li key={i}>• <strong>{it.code}</strong> × {it.quantity} <span className="text-slate-500">(tồn kho gửi: {draftData.fromWarehouseId ? Number(it.availableStock || 0).toLocaleString('vi-VN') : 'chưa rõ'})</span></li>
                        ))}
                      </ul>
                      {transferResults[msg.id] && (
                        <div className="text-xs mb-2 text-slate-700">{transferResults[msg.id]}</div>
                      )}
                      <button
                        disabled={confirmedTransferIds.has(msg.id) || !draftData.fromWarehouseId || !draftData.toWarehouseId}
                        onClick={async () => {
                          setConfirmedTransferIds((prev) => new Set(prev).add(msg.id));
                          try {
                            const items = (draftData.items as any[])
                              .filter((it: any) => it && typeof it.editionId === 'string' && it.editionId.trim())
                              .map((it: any) => ({
                                editionId: it.editionId.trim(),
                                quantity: Math.min(999, Math.max(1, Math.floor(Number(it.quantity) || 1))),
                              }));
                            const res = await fetch('/api/transfers', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'idempotency-key': `copilot-${msg.id}`,
                              },
                              body: JSON.stringify({
                                action: 'dispatch',
                                fromWarehouseId: draftData.fromWarehouseId,
                                toWarehouseId: draftData.toWarehouseId,
                                notes: '[Copilot] tạo từ AI Copilot',
                                items,
                              }),
                            });
                            const json = await res.json();
                            if (json.success) {
                              setTransferResults((prev) => ({ ...prev, [msg.id]: `✅ Đã tạo phiếu ${json.data?.shipmentId || json.data?.id || ''} - theo dõi trong Luân chuyển kho.` }));
                            } else {
                              setTransferResults((prev) => ({ ...prev, [msg.id]: `❌ Không tạo được phiếu: ${json.error || 'lỗi không rõ'}` }));
                              // Cho phep bam lai khi loi
                              setConfirmedTransferIds((prev) => { const n = new Set(prev); n.delete(msg.id); return n; });
                            }
                          } catch (e: any) {
                            setTransferResults((prev) => ({ ...prev, [msg.id]: `❌ Lỗi kết nối: ${e?.message || e}` }));
                            setConfirmedTransferIds((prev) => { const n = new Set(prev); n.delete(msg.id); return n; });
                          }
                        }}
                        className="w-full py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                      >
                        <Truck className="w-4 h-4" />
                        {confirmedTransferIds.has(msg.id) && !transferResults[msg.id] ? 'Đang tạo phiếu...' : 'Xác nhận tạo phiếu'}
                      </button>
                      {(!draftData.fromWarehouseId || !draftData.toWarehouseId) && (
                        <div className="text-[11px] text-amber-700 mt-1">Thiếu thông tin kho - bổ sung rồi hỏi lại để tôi chuẩn bị lại nháp.</div>
                      )}
                    </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex items-center gap-2 text-slate-500 text-xs pl-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>{liveStatus || LOADING_STAGES[loadingStage]}</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Quick Prompt Chips */}
        {isAuthorized && (
          <div className="p-2.5 bg-white border-t border-slate-100 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
            {getContextualChips().map((chip) => (
              <button
                key={chip.query}
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
                    ? 'Nói để nhập câu hỏi - chữ hiện trực tiếp khi nói (nhận diện trên trình duyệt)'
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
                    : 'Hỏi em đi sếp...'
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
                ? 'Đang nghe trực tiếp...'
                : isRecording
                ? 'Đang ghi âm...'
                : voiceError || voiceLive.error
                ? voiceError || voiceLive.error
                : ''}
            </span>
            <span>Esc để đóng</span>
          </div>

          {/* Dropdown chọn LLM thu gọn trong <details>: gọn 1 dòng, bấm mới mở
              danh sách, không che nội dung chat. */}
          <details className="mt-3 rounded-xl border border-slate-700 bg-slate-800/60 px-2.5 py-2">
            <summary className="cursor-pointer text-[11px] font-extrabold uppercase tracking-wide text-slate-300 list-none">
              ⚙️ Cài đặt bộ não{' '}
              <span className="normal-case font-medium text-slate-500">
                ({MODEL_LABEL[copilotModel] || copilotModel})
              </span>
            </summary>
            <div className="pt-2">
              <label
                htmlFor="copilot-model"
                className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-300"
              >
                Chọn bộ não
              </label>
              <select
                id="copilot-model"
                value={copilotModel}
                onChange={(e) => {
                  setCopilotModel(e.target.value);
                  try {
                    localStorage.setItem('formapubli.copilot.model', e.target.value);
                  } catch {
                    /* bỏ qua */
                  }
                }}
                aria-label="Chọn mô hình AI"
                className="w-full bg-slate-900 text-slate-100 text-[13px] font-bold rounded-lg px-3 py-2.5 outline-none cursor-pointer border border-slate-600 focus:border-indigo-400"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label} - {m.hint}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[10px] text-slate-500">
                Đang dùng: {MODEL_LABEL[copilotModel] || copilotModel}
              </p>
            </div>
          </details>
        </div>
      </aside>
    </>,
    document.body
  );
}
