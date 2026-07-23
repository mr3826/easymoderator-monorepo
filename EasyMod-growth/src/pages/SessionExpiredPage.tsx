import { Link } from 'react-router-dom';
import { MessageState } from '@/components/states';

export function SessionExpiredPage() {
  return (
    <MessageState title="Session expired">
      <p>Your internal session is no longer valid.</p>
      <Link className="primary-button" to="/login">Sign in again</Link>
    </MessageState>
  );
}
