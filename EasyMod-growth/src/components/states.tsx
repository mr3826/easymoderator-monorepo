import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingState() {
  return (
    <main className="center-screen">
      <div className="loading-mark" aria-label="Loading Growth OS" />
    </main>
  );
}

export function MessageState({
  eyebrow = 'Growth OS',
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="center-screen">
      <section className="message-panel" aria-labelledby="state-title">
        <ShieldAlert aria-hidden="true" className="state-icon" />
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="state-title">{title}</h1>
        <div className="state-copy">{children}</div>
      </section>
    </main>
  );
}
