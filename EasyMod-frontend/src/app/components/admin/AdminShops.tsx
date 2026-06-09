import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type AdminShopRow } from '@/api/domains/admin';

export default function AdminShops() {
  const [rows, setRows] = useState<AdminShopRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    adminApi.listShops({ search, page, limit }).then((r) => {
      setRows(r.items);
      setTotal(r.total);
    });
  }, [search, page]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Shops</h1>
        <input
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
          placeholder="Search shop name…"
          className="w-72 rounded border px-3 py-1.5 text-sm"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Shop</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Channels</th>
              <th className="px-3 py-2">Used</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-2 font-medium text-gray-900">{s.shopName}</td>
                <td className="px-3 py-2 text-gray-600">{s.owner?.email || '—'}</td>
                <td className="px-3 py-2">{s.plan || '—'}</td>
                <td className="px-3 py-2">{s.status || '—'}</td>
                <td className="px-3 py-2">{s.channelCount}</td>
                <td className="px-3 py-2">{s.conversationsUsed ?? '—'}/{s.conversationsLimit ?? '—'}</td>
                <td className="px-3 py-2 text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <Link to={`/admin/shops/${s.id}`} className="text-blue-600">View</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No shops</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} shops</span>
        <div className="space-x-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
          <span>Page {page}</span>
          <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
