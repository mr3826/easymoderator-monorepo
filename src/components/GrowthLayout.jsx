import React from 'react';

export default function GrowthLayout({ children }) {
  // Protected route: relies on server-side auth (cookie/session)
  // Client-side guard only for UX; real authorization enforced server-side
  return <div className="growth-os-layout">{children}</div>;
}
