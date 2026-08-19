import { Link } from 'react-router-dom';
import { MessageState } from '@/components/states';

export function AccessDeniedPage() {
  return (
    <MessageState title="Access denied">
      <p>Your EasyModerator account is authenticated, but it does not have an active Growth OS role.</p>
      <Link className="secondary-button" to="/login">Use another account</Link>
    </MessageState>
  );
}
