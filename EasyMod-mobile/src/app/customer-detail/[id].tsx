import { useLocalSearchParams } from 'expo-router';

import { CustomerQuickViewScreen } from '@/components/customers/CustomerQuickViewScreen';

export default function CustomerDetailRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <CustomerQuickViewScreen id={id} />;
}
