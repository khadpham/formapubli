'use client';

import { Construction } from 'lucide-react';

interface ModulePlaceholderProps {
  title: string;
  description: string;
  features: string[];
}

/**
 * Placeholder cho các module mới theo blueprint.
 * Hiển thị mô tả và danh sách tính năng dự kiến để user hình dung.
 */
export default function ModulePlaceholder({ title, description, features }: ModulePlaceholderProps) {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-6">
          <Construction className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 mb-3">{title}</h2>
        <p className="text-slate-600 mb-8 leading-relaxed">{description}</p>
        <div className="text-left bg-slate-50 rounded-xl p-6 border border-slate-200">
          <div className="text-xs font-black uppercase text-slate-400 mb-4">Tính năng dự kiến</div>
          <ul className="space-y-3">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="w-6 h-6 shrink-0 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-black flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{f}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-400 mt-6 italic">
          Module này đang được phát triển theo bản Blueprint ERP v1.0
        </p>
      </div>
    </div>
  );
}
