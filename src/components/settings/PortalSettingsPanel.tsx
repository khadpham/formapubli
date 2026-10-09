'use client';

import { useEffect, useState } from 'react';

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

export function PortalSettingsPanel() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [current, setCurrent] = useState<string>('');
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [whRes, cfgRes] = await Promise.all([
          fetch('/api/warehouses'),
          fetch('/api/portal-settings'),
        ]);
        const whData = await whRes.json();
        const cfgData = await cfgRes.json();
        if (whData.success) setWarehouses(whData.data || []);
        if (cfgData.success) {
          const wid = cfgData.data.PORTAL_WAREHOUSE_ID || '';
          setCurrent(wid);
          setSelected(wid);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/portal-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ PORTAL_WAREHOUSE_ID: selected }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrent(selected);
        setMessage('✅ Đã lưu. Đơn portal mới sẽ dùng kho này.');
      } else {
        setMessage('❌ Lỗi: ' + (data.error || 'Không lưu được'));
      }
    } catch (e) {
      setMessage('❌ Lỗi kết nối');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-slate-500">Đang tải...</div>;

  const currentWh = warehouses.find((w) => w.id === current);

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <div>
        <h3 className="text-lg font-extrabold text-slate-900">Cổng đặt hàng Online (Portal)</h3>
        <p className="text-xs text-slate-500 mt-1">
          Chọn kho mặc định để trừ tồn khi khách đặt đơn trên portal datmua.formaform.vn
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 block mb-2">
          Kho hiện tại: <span className="font-bold text-blue-700">{currentWh?.name || current || '(chưa cấu hình)'}</span>
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">-- Chọn kho --</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={save}
        disabled={saving || !selected || selected === current}
        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm transition"
      >
        {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
      </button>

      {message && <div className="text-sm">{message}</div>}

      <div className="text-xs text-slate-400 border-t pt-3">
        💡 Đổi kho có hiệu lực ngay cho đơn mới, không cần redeploy. Đơn cũ giữ nguyên kho đã tạo.
      </div>
    </div>
  );
}
