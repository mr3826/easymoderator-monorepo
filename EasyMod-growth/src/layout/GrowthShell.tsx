import { LogOut, PanelLeft, ShieldCheck, UsersRound } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { PROSPECT_READ_PERMISSIONS, usePermission } from '@/auth/usePermission';

export function GrowthShell() {
  const { session, error, logout } = useGrowthAuth();
  const canReadProspects = usePermission(PROSPECT_READ_PERMISSIONS);

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Growth OS navigation">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <p className="brand-name">Growth OS</p>
            <p className="brand-subtitle">Internal acquisition</p>
          </div>
        </div>

        <nav className="nav-list">
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/" end>
            <PanelLeft aria-hidden="true" />
            <span>Overview</span>
          </NavLink>
          {canReadProspects ? (
            <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/prospects">
              <UsersRound aria-hidden="true" />
              <span>Prospects</span>
            </NavLink>
          ) : null}
        </nav>
      </aside>

      <div className="work-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">Internal workspace</p>
            <h1>Growth OS</h1>
          </div>
          <div className="user-strip">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>{session?.displayName}</strong>
              <span>{session?.role}</span>
            </div>
            <button className="icon-button" type="button" aria-label="Log out" title="Log out" onClick={() => void logout()}>
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <Outlet />
      </div>
    </div>
  );
}
