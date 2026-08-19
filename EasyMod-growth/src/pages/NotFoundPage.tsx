import { Link } from 'react-router-dom';
import { MessageState } from '@/components/states';

export function NotFoundPage() {
  return (
    <MessageState title="Page not found">
      <p>The requested Growth OS route is not enabled.</p>
      <Link className="secondary-button" to="/">Go to overview</Link>
    </MessageState>
  );
}
