import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

export function LoginPage() {
  const auth = useGrowthAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'authenticated') {
    const redirectTo = typeof location.state === 'object' && location.state && 'from' in location.state
      ? String(location.state.from)
      : '/';
    return <Navigate to={redirectTo} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await auth.signin({ email, password });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-header">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <p className="eyebrow">Internal only</p>
            <h1 id="login-title">Growth OS</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          {auth.error ? <p className="form-error">{auth.error}</p> : null}
          <button className="primary-button" type="submit" disabled={submitting}>
            <LogIn aria-hidden="true" />
            <span>{submitting ? 'Signing in' : 'Sign in'}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
