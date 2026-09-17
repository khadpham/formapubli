'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Send,
  Loader2,
  AlertTriangle,
  Boxes,
  Receipt,
  Scale,
  DollarSign,
  Maximize2,
  Minimize2,
  Trash2,
  CheckCircle2,
  Shield,
  Clock,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';

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
}

const QUICK_PROMPT_CHIPS = [
  {
    label: '📦 Tồn kho toàn hệ thống',
    query: 'Báo cáo tồn kho khả dụng trên toàn hệ thống?',
  },
  {
    label: '📊 Doanh số 30 ngày (2 sổ)',
    query: 'Báo cáo doanh số và đơn hàng trong 30 ngày qua (cả 2 sổ)?',
  },
  {
    label: '⚠️ Sách cạn kho (Đề xuất in 105 ngày)',
    query: 'Những đầu sách nào đang cạn kho mức Đỏ (≤30 ngày) cần tái bản?',
  },
  {
    label: '💵 Đối soát két ca quầy',
    query: 'Đối soát két tiền ca làm việc hiện tại ở quầy bán hàng?',
  },
];

export function CopilotDrawer({ currentRole, isOpen, onClose }: CopilotDrawerProps) {
  const isAuthorized = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

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
- **Đối soát két ca quầy** (Đầu ca, tiền mặt, số lệch ghi nhận)`,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [rateLimitTimer, setRateLimitTimer] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleSend = async (queryToSend?: string) => {
    const text = (queryToSend || inputQuery).trim();
    if (!text || loading || !isAuthorized) return;

    const userMsg: CopilotMessage = {
      id: 'msg_' + Date.now(),
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
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
            const hText = trimmed.replace(/^#+\s*/, '');
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

  // Xử lý Bold **...** và Code `...` inline
  const formatInline = (text: string) => {
    const parts: (string | React.ReactNode)[] = [];
    const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
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
  };

  const getToolBadge = (toolName?: string | null) => {
    if (!toolName) return null;
    const map: Record<string, { label: string; icon: any; color: string }> = {
      query_stock_level: { label: 'Tồn kho Ledger', icon: Boxes, color: 'bg-amber-50 text-amber-700 border-amber-200' },
      query_sales_summary: { label: 'Doanh số 2 sổ', icon: Receipt, color: 'bg-sky-50 text-sky-700 border-sky-200' },
      query_reprint_forecast: { label: 'Dự báo in 105 ngày', icon: Scale, color: 'bg-purple-50 text-purple-700 border-purple-200' },
      query_cashbox_reconciliation: { label: 'Đối soát két ca', icon: DollarSign, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
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

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <aside
        className={`fixed top-0 bottom-0 right-0 z-50 flex flex-col bg-white shadow-2xl border-l border-slate-200 transition-all duration-300 ease-in-out ${
          isExpanded ? 'w-full md:w-[720px]' : 'w-full md:w-[480px]'
        }`}
        role="dialog"
        aria-modal="true"
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
                Thẩm quyền: <span className="text-emerald-400 font-semibold">{currentRole}</span> (CEO Vận hành)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors hidden md:flex"
              title={isExpanded ? 'Thu hẹp' : 'Mở rộng'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
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
              className="flex items-center gap-2"
            >
              <input
                ref={inputRef}
                type="text"
                disabled={!isAuthorized || loading}
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                placeholder={
                  !isAuthorized
                    ? 'Bạn không có quyền truy vấn Copilot...'
                    : 'Hỏi về tồn kho, 2 sổ doanh thu, dự báo in 105 ngày, két quầy...'
                }
                className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all disabled:opacity-50"
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
            <span>Executive Copilot • Dữ liệu nội bộ bảo mật Formapubli</span>
            <span>Esc để đóng • Alt+C để bật/tắt</span>
          </div>
        </div>
      </aside>
    </>
  );
}
