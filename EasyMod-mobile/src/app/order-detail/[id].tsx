import { useLocalSearchParams } from 'expo-router';

import { OrderDetailScreen } from '@/components/orders/OrderDetailScreen';

export default function OrderDetailRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <OrderDetailScreen id={id} />;
}
