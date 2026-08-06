import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/shops', label: 'Shops' },
  { to: '/admin/audit-logs', label: 'Audit Logs' },
];

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 shrink-0 border-r bg-white">
        <div className="px-4 py-4 text-sm font-semibold text-gray-900">EasyModerator Admin</div>
        <nav className="space-y-1 px-2">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {l.label}
            </NavLink>
          ))}
          <NavLink to="/dashboard" className="block rounded px-3 py-2 text-sm text-gray-400 hover:bg-gray-100">
            ← Back to app
          </NavLink>
        </nav>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
