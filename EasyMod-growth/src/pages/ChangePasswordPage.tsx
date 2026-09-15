import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { LoadingState } from '@/components/states';

function passwordPolicyError(value: string) {
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Z]/.test(value)) return 'Include at least one uppercase letter.';
  if (!/[0-9]/.test(value)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Include at least one special character.';
  return null;
}

function formatExpiry(value: string | null) {
  if (!value) return 'within 24 hours';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'within 24 hours';
  return `by ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
}

export function ChangePasswordPage() {
  const auth = useGrowthAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'loading') return <LoadingState />;
  if (auth.status === 'authenticated') return <Navigate to="/" replace />;
  if (auth.status !== 'password-change-required') return <Navigate to="/login" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!currentPassword) {
      setFormError('Enter the temporary password you used to sign in.');
      return;
    }
    const policyError = passwordPolicyError(newPassword);
    if (policyError) {
      setFormError(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('The new passwords do not match.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await auth.changePassword(currentPassword, newPassword);
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Password change failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="change-password-title">
        <div className="login-header">
          <div className="brand-mark" aria-hidden="true"><KeyRound /></div>
          <div>
            <p className="eyebrow">Security check</p>
            <h1 id="change-password-title">Set your password</h1>
          </div>
        </div>
        <p className="state-copy">
          This temporary password {formatExpiry(auth.temporaryPasswordExpiresAt)} and cannot be used
          to access Growth OS until you choose a new password.
        </p>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Temporary password
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {formError || auth.error ? <p className="form-error" role="alert">{formError || auth.error}</p> : null}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Saving password' : 'Save password'}
          </button>
        </form>
      </section>
    </main>
  );
}
