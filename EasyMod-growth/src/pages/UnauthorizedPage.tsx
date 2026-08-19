import { Link } from 'react-router-dom';
import { MessageState } from '@/components/states';

export function UnauthorizedPage() {
  return (
    <MessageState title="Authentication required">
      <p>Sign in with an internal EasyModerator account before opening Growth OS.</p>
      <Link className="primary-button" to="/login">Sign in</Link>
    </MessageState>
  );
}
