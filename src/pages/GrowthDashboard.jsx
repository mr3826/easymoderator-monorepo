import React, { useEffect, useState } from 'react';

async function fetchGrowthStatus() {
  const base = import.meta.env.VITE_APP_API_BASE || '/api/internal/growth-os';
  const res = await fetch(`${base}/status`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}`);
    error.status = res.status;
    error.body = await res.text().catch(() => '');
    throw error;
  }
  return res.json();
}

export default function GrowthDashboard() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchGrowthStatus()
      .then(data => {
        if (!active) return;
        setStatus(data);
      })
      .catch(err => {
        if (!active) return;
        setError({ message: err.message, status: err.status, body: err.body });
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="growth-shell">
      <section className="growth-card">
        <p className="growth-kicker">Internal console</p>
        <h1>Growth OS</h1>
        <p className="growth-lede">
          Dedicated frontend for the internal Growth OS API boundary.
        </p>

        <dl className="growth-meta">
          <div>
            <dt>Domain</dt>
            <dd>{import.meta.env.VITE_APP_DOMAIN || 'growth.easymod.tech'}</dd>
          </div>
          <div>
            <dt>Namespace</dt>
            <dd>{import.meta.env.VITE_APP_API_BASE || '/api/internal/growth-os'}</dd>
          </div>
        </dl>

        {loading ? (
          <p className="growth-state">Checking session and Growth OS status...</p>
        ) : error ? (
          <div className="growth-alert" role="alert">
            <strong>Access denied or error</strong>
            <span>
              {error.status ? `HTTP ${error.status}` : error.message}
            </span>
            {error.body ? <pre>{error.body}</pre> : null}
          </div>
        ) : (
          <div className="growth-result">
            <h2>Status</h2>
            <pre>{JSON.stringify(status, null, 2)}</pre>
          </div>
        )}
      </section>
    </main>
  );
}
