'use client';

import { useState, useCallback } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import { UserRole } from '@/lib/roles';
import PublishingProjectsView from '@/components/projects/PublishingProjectsView';
import { ContractsTab } from '@/components/contracts/ContractsTab';

interface DuAnHopDongTabProps {
  currentRole?: UserRole;
}

type SubView = 'projects' | 'contracts';

/**
 * Tab gộp "Dự án & Hợp đồng": dự án xuất bản làm khung chứa (mỗi dự án 5 giai
 * đoạn, mỗi giai đoạn gắn được hợp đồng), kèm chế độ xem toàn bộ hợp đồng.
 * Thay thế 2 tab cũ "Dự án xuất bản" và "Hợp đồng" trên thanh điều hướng.
 */
export function DuAnHopDongTab({ currentRole = 'ROLE_OWNER' }: DuAnHopDongTabProps) {
  const [subView, setSubView] = useState<SubView>('projects');
  const [contractsPreset, setContractsPreset] = useState<string>('');

  const canLinkContract = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

  /** Từ giai đoạn dự án nhảy sang xem hợp đồng đã gắn. */
  const handleViewContract = useCallback(async (contractId: string) => {
    try {
      const res = await fetch('/api/contracts/documents');
      const json = await res.json();
      const docs = json.success ? json.data || [] : [];
      const found = docs.find((d: any) => d.id === contractId);
      setContractsPreset(found ? found.contractNumber || '' : '');
    } catch {
      setContractsPreset('');
    }
    setSubView('contracts');
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSubView('projects')}
          aria-label="Xem dự án xuất bản"
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 min-h-[44px] ${
            subView === 'projects'
              ? 'bg-cyan-700 text-white'
              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <BookOpen className="w-4 h-4" />Dự án xuất bản
        </button>
        <button
          type="button"
          onClick={() => setSubView('contracts')}
          aria-label="Xem hợp đồng"
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 min-h-[44px] ${
            subView === 'contracts'
              ? 'bg-teal-700 text-white'
              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <FileText className="w-4 h-4" />Hợp đồng
        </button>
      </div>

      {subView === 'projects' ? (
        <PublishingProjectsView
          onViewContract={handleViewContract}
          canLinkContract={canLinkContract}
        />
      ) : (
        <ContractsTab currentRole={currentRole} presetSearch={contractsPreset} />
      )}
    </div>
  );
}
