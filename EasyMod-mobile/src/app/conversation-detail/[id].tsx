import { useLocalSearchParams } from 'expo-router';

import { ConversationScreen } from '@/components/inbox/ConversationScreen';

/** Read-only transcript destination opened from the native Inbox list. */
export default function ConversationDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return <ConversationScreen id={id} />;
}
