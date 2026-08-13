import React, { useEffect, useState } from 'react';

async function fetchGrowthStatus() {
  const base = import.meta.env.VITE_APP_API_BASE || '/api/internal/growth-os';
  const res = await fetch(`${base}/status`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function GrowthDashboard() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchGrowthStatus()
      .then(data => setStatus(data))
      .catch(err => setError(err.message));
  }, []);

  return (
    <div>
      <h1>Growth OS — Internal Dashboard</h1>
      <p>Domain: {import.meta.env.VITE_APP_DOMAIN}</p>
      <p>Namespace: {import.meta.env.VITE_APP_API_BASE}</p>
      {error ? <p style={{ color: 'red' }}>Access denied or error: {error}</p> : <pre>{JSON.stringify(status, null, 2)}</pre>}
    </div>
  );
}
