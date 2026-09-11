'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseVoiceSearchResult {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  clearError: () => void;
}

export function useVoiceSearch(onResult?: (text: string) => void): UseVoiceSearchResult {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const onResultRef = useRef(onResult);

  // Luôn cập nhật ref callback mới nhất mà KHÔNG kích hoạt re-init recognition
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Kiểm tra hỗ trợ Web Speech API trên trình duyệt
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition ||
      (window as any).mozSpeechRecognition ||
      (window as any).msSpeechRecognition;

    setIsSupported(Boolean(SpeechRecognitionClass));
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        try {
          recognitionRef.current.abort();
        } catch {
          // Bỏ qua nếu đã dừng
        }
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition ||
      (window as any).mozSpeechRecognition ||
      (window as any).msSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setError(
        'Trình duyệt hiện tại chưa hỗ trợ Web Speech API trực tiếp. Khuyến nghị sử dụng Google Chrome, Microsoft Edge, Cốc Cốc hoặc Safari để nhận diện giọng nói.'
      );
      return;
    }

    // Nếu đang chạy thì dừng trước khi tạo mới
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Bỏ qua
      }
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = false; // Thu 1 câu hoàn chỉnh rồi dừng
      recognition.interimResults = true; // Trả kết quả tạm thời theo thời gian thực
      recognition.lang = 'vi-VN'; // Ngôn ngữ Tiếng Việt chuẩn
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onaudiostart = () => {
        setIsListening(true);
      };

      recognition.onspeechstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += trans;
          } else {
            interimTranscript += trans;
          }
        }

        const currentText = (finalTranscript || interimTranscript).trim();
        if (currentText) {
          setTranscript(currentText);
          if (onResultRef.current) {
            onResultRef.current(currentText);
          }
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        const errType = event.error;

        if (errType === 'not-allowed' || errType === 'service-not-allowed') {
          setError(
            'Quyền truy cập Micro bị từ chối! Vui lòng bấm vào biểu tượng Khóa 🔒 hoặc Micro 🎙️ trên thanh địa chỉ trình duyệt và chọn "Cho phép" (Allow).'
          );
        } else if (errType === 'no-speech') {
          setError('Không nhận được âm thanh. Vui lòng nói to và rõ hơn.');
        } else if (errType === 'audio-capture') {
          setError('Không tìm thấy thiết bị Microphone trên máy tính hoặc điện thoại.');
        } else if (errType === 'network') {
          setError('Lỗi kết nối mạng khi gửi dữ liệu giọng nói lên dịch vụ nhận diện.');
        } else if (errType !== 'aborted') {
          setError(`Lỗi nhận diện giọng nói: ${errType}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      setTranscript('');
      setError(null);
      setIsListening(true); // Cập nhật ngay tức thì để icon đổi màu đỏ lập tức

      recognition.start();
    } catch (err: any) {
      setIsListening(false);
      setError('Không thể khởi động Micro: ' + (err.message || 'Lỗi không xác định'));
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Cleanup khi unmount component
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Bỏ qua
        }
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    transcript,
    error,
    startListening,
    stopListening,
    toggleListening,
    clearError,
  };
}