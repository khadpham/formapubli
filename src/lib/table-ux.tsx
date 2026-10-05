'use client';

import React from 'react';

export type SortDir = 'asc' | 'desc';
export type SortVal = string | number | null | undefined;

/**
 * Sort mảng theo 1 khóa, ổn định (bằng nhau giữ thứ tự gốc), null về cuối
 * mọi chiều. So số khi cả hai hữu hạn, ngày ISO khi parse được, còn lại
 * chuỗi tiếng Việt.
 */
export function sortRows<T>(
  rows: T[],
  key: string,
  dir: SortDir,
  get: (r: T, key: string) => SortVal
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const va = get(a.r, key);
      const vb = get(b.r, key);
      const na = va == null || va === '' ? null : va;
      const nb = vb == null || vb === '' ? null : vb;
      if (na == null && nb == null) return a.i - b.i;
      if (na == null) return 1;
      if (nb == null) return -1;
      const fa = typeof na === 'number' ? na : Number(na);
      const fb = typeof nb === 'number' ? nb : Number(nb);
      if (Number.isFinite(fa) && Number.isFinite(fb) && String(na).trim() !== '' && String(nb).trim() !== '') {
        if (fa !== fb) return (fa - fb) * sign;
        return a.i - b.i;
      }
      const ta = Date.parse(String(na));
      const tb = Date.parse(String(nb));
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return (ta - tb) * sign;
      const cmp = String(na).localeCompare(String(nb), 'vi');
      if (cmp !== 0) return cmp * sign;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

export function useSortable<T>(
  rows: T[],
  defKey: string,
  defDir: SortDir,
  get: (r: T, key: string) => SortVal
): {
  sorted: T[];
  sortKey: string;
  sortDir: SortDir;
  toggleSort: (key: string, defDirForKey?: SortDir) => void;
} {
  const [sortKey, setSortKey] = React.useState(defKey);
  const [sortDir, setSortDir] = React.useState<SortDir>(defDir);
  const toggleSort = React.useCallback(
    (key: string, defDirForKey?: SortDir) => {
      setSortKey((prevKey) => {
        if (prevKey !== key) {
          setSortDir(defDirForKey || 'desc');
          return key;
        }
        setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      });
    },
    []
  );
  const sorted = React.useMemo(
    () => (sortKey ? sortRows(rows, sortKey, sortDir, get) : [...rows]),
    [rows, sortKey, sortDir, get]
  );
  return { sorted, sortKey, sortDir, toggleSort };
}

/**
 * `<th>` bấm được để sắp xếp: hiện ▲▼ + `aria-sort` cho screen reader.
 */
export function SortableTh({
  label,
  sortKey,
  activeKey,
  activeDir,
  onToggle,
  align = 'left',
  title,
  className = 'p-3.5',
}: {
  label: string;
  sortKey: string;
  activeKey: string;
  activeDir: SortDir;
  onToggle: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  title?: string;
  className?: string;
}) {
  const active = activeKey === sortKey;
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      aria-sort={active ? (activeDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${className} ${alignCls}`}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        title={title || `Sắp xếp theo ${label}`}
        aria-label={`Sắp xếp theo ${label}${active ? (activeDir === 'asc' ? ' (đang tăng dần)' : ' (đang giảm dần)') : ''}`}
        className="inline-flex items-center gap-1 font-semibold hover:text-slate-800 transition-colors cursor-pointer"
      >
        <span>{label}</span>
        <span aria-hidden="true" className={`font-mono text-[10px] ${active ? 'text-indigo-600 font-black' : 'text-slate-300'}`}>
          {active ? (activeDir === 'asc' ? '▲' : '▼') : '△'}
        </span>
      </button>
    </th>
  );
}
