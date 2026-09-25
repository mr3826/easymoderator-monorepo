import { MessageCircle, Package, ShoppingBag } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import type { AttentionEntityType } from '@/api/mobile/schemas';
import type { DeepLinkEntityKind } from '@/lib/deeplink';

interface EntityPresentation {
  Icon: LucideIcon;
  labelKey: string;
}

const ENTITY_PRESENTATION: Record<AttentionEntityType, EntityPresentation> = {
  order: { Icon: ShoppingBag, labelKey: 'mobile.home.entity.order' },
  conversation: { Icon: MessageCircle, labelKey: 'mobile.home.entity.conversation' },
  product: { Icon: Package, labelKey: 'mobile.home.entity.product' },
};

export function entityPresentation(type: AttentionEntityType): EntityPresentation {
  return ENTITY_PRESENTATION[type];
}

/** Products have no mobile detail route yet; order and conversation use the shared deep-link path. */
export function isNavigableEntity(type: AttentionEntityType): type is DeepLinkEntityKind {
  return type === 'order' || type === 'conversation';
}
