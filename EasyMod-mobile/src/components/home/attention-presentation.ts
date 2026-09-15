import { MessageCircle, Package, ShoppingBag } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import type { AttentionEntityType } from '@/api/mobile/schemas';
import type { DeepLinkEntityKind } from '@/lib/deeplink';

/**
 * Home ("Needs Attention") card presentation, keyed by `entity.type` — the master brief is
 * explicit that only `entity.type` (not `signal_type`) drives icon/label/navigability, since the
 * backend's `reason` string already carries the specific signal in human-readable form (ADR M-008
 * §2.1); this client never re-derives or re-labels that.
 */
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

/**
 * Only `order` and `conversation` have a deep-link destination (`@/lib/deeplink`'s
 * `DeepLinkEntityKind`) — no product detail route/endpoint exists yet (master brief: building one
 * here would be scope creep). Narrows `AttentionEntityType` down to `DeepLinkEntityKind` so a card
 * for a non-navigable entity (`product`, or any future type the client doesn't recognize as one of
 * the two) can never be wired to `openDeepLink`.
 */
export function isNavigableEntity(type: AttentionEntityType): type is DeepLinkEntityKind {
  return type === 'order' || type === 'conversation';
}
