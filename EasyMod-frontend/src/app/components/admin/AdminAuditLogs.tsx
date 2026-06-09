import { useEffect, useState } from 'react';
import { adminApi } from '@/api/domains/admin';

export default function AdminAuditLogs() {
  const [rows, setRows] = useState<any[]>([]);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  useEffect(() => {
    adminApi.getAuditLogs({ action: action || undefined, page, limit }).then((r) => {
      setRows(r.items);
      setTotal(r.total);
    });
  }, [action, page]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Audit Logs</h1>
        <input
          value={action}
          onChange={(e) => { setPage(1); setAction(e.target.value); }}
          placeholder="Filter action (e.g. admin:suspend_shop)"
          className="w-80 rounded border px-3 py-1.5 text-sm"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">Shop</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-gray-500">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">{r.admin?.email || r.admin?.id || 'system'}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2">{r.resourceType}</td>
                <td className="px-3 py-2 text-gray-500">{r.shopId || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No entries</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} entries</span>
        <div className="space-x-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
          <span>Page {page}</span>
          <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
