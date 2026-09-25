import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { AttentionCard } from './AttentionCard';
import i18n from '@/i18n';
import type { AttentionItem } from '@/api/mobile/schemas';

/**
 * Dedicated `AttentionCard` coverage (Test Master pass, mobile/p2-home). `HomeScreen.test.tsx`
 * covers the integration-level ranked-list/navigation behavior; this file isolates the card itself
 * so every one of the six real attention tiers/signal_types (`attention.service.js`) gets its own,
 * directly-assertable render — a correct, human-readable tier badge + reason + entity label — plus
 * the navigability rule (`entity.type` decides, per `attention-presentation.ts`) and long-content
 * safety.
 */

// One real fixture per signal_type (`attention.service.js`'s six collectors — tier 1 has two:
// courier-failed/indeterminate and courier-setup-blocked), reason text matching the service's own
// template strings so this stays grounded in the real backend shape (ADR M-003).
const SIX_TIER_FIXTURES: AttentionItem[] = [
  {
    id: 'courier_failed:order:order-1',
    tier: 1,
    urgency_score: 5.02,
    signal_type: 'COURIER_FAILED',
    reason: 'Courier dispatch failed for order MA-1 — needs manual retry',
    entity: { type: 'order', id: 'order-1' },
  },
  {
    id: 'courier_setup_required:shop:shop-1',
    tier: 1,
    urgency_score: 20.1,
    signal_type: 'COURIER_SETUP_REQUIRED',
    reason: 'Courier setup is incomplete and order MA-2 is ready to ship',
    entity: { type: 'order', id: 'order-2' },
  },
  {
    id: 'inbox_needs_reply:conversation:convo-1',
    tier: 2,
    urgency_score: 3.1,
    signal_type: 'INBOX_NEEDS_REPLY',
    reason: "The customer's last message has not been answered",
    entity: { type: 'conversation', id: 'convo-1' },
  },
  {
    id: 'draft_order:order:order-3',
    tier: 3,
    urgency_score: 5000,
    signal_type: 'DRAFT_ORDER',
    reason: 'Draft order MA-3 (৳500) has been awaiting confirmation for 10h',
    entity: { type: 'order', id: 'order-3' },
  },
  {
    id: 'rto_verify:order:order-4',
    tier: 4,
    urgency_score: 2.0,
    signal_type: 'RTO_VERIFY',
    reason: 'Customer on order MA-4 has an elevated return history — verify before shipping',
    entity: { type: 'order', id: 'order-4' },
  },
  {
    id: 'low_stock:product:product-1',
    tier: 5,
    urgency_score: 0.8,
    signal_type: 'LOW_STOCK',
    reason: 'Widget is low on stock (2 left, threshold 10)',
    entity: { type: 'product', id: 'product-1' },
  },
];

// A second tier-2 fixture covering the HITL-handoff reason variant (distinct from the plain
// "unanswered" text above) — both are `INBOX_NEEDS_REPLY`, just different `reason` strings
// (`NEEDS_REPLY_REASON_TEXT` in `attention.service.js`).
const HITL_FIXTURE: AttentionItem = {
  id: 'inbox_needs_reply:conversation:convo-2',
  tier: 2,
  urgency_score: 8.4,
  signal_type: 'INBOX_NEEDS_REPLY',
  reason: 'This conversation was handed off to you by the AI',
  entity: { type: 'conversation', id: 'convo-2' },
};

afterEach(async () => {
  await i18n.changeLanguage('bn');
});

describe('AttentionCard — all six attention tiers render a correct, human-readable label', () => {
  it.each(SIX_TIER_FIXTURES)(
    'renders tier $tier ($signal_type) with its reason, entity label, and priority badge',
    (item) => {
      render(<AttentionCard item={item} onPress={jest.fn()} />);

      expect(screen.getByTestId(`attention-card-${item.id}`)).toBeTruthy();
      expect(screen.getByText(item.reason)).toBeTruthy();
      expect(screen.getByText(i18n.t(`mobile.home.entity.${item.entity.type}`))).toBeTruthy();
      expect(screen.getByText(i18n.t('mobile.home.attention.priority', { tier: item.tier }))).toBeTruthy();
    },
  );

  it('renders the HITL-handoff reason variant for a tier 2 inbox signal distinctly from a plain unanswered one', () => {
    render(<AttentionCard item={HITL_FIXTURE} onPress={jest.fn()} />);
    expect(screen.getByText(HITL_FIXTURE.reason)).toBeTruthy();
  });

  it('renders the same six tiers with correct, non-hardcoded-English labels in en too', () => {
    void i18n.changeLanguage('en');
    for (const item of SIX_TIER_FIXTURES) {
      const { unmount } = render(<AttentionCard item={item} onPress={jest.fn()} />);
      expect(screen.getByText(i18n.t(`mobile.home.entity.${item.entity.type}`, { lng: 'en' }))).toBeTruthy();
      expect(
        screen.getByText(i18n.t('mobile.home.attention.priority', { tier: item.tier, lng: 'en' })),
      ).toBeTruthy();
      unmount();
    }
  });
});

describe('AttentionCard navigability (entity.type decides, not signal_type)', () => {
  it('is Pressable and calls onPress with the exact item for an order entity', () => {
    const onPress = jest.fn();
    const item = SIX_TIER_FIXTURES[0]; // order entity
    render(<AttentionCard item={item} onPress={onPress} />);

    const card = screen.getByTestId(`attention-card-${item.id}`);
    expect(card.props.accessibilityRole).toBe('button');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(item);
  });

  it('is Pressable and calls onPress with the exact item for a conversation entity', () => {
    const onPress = jest.fn();
    const item = SIX_TIER_FIXTURES[2]; // conversation entity
    render(<AttentionCard item={item} onPress={onPress} />);

    const card = screen.getByTestId(`attention-card-${item.id}`);
    expect(card.props.accessibilityRole).toBe('button');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(item);
  });

  it('renders a product entity as informational-only: no onPress, accessibilityRole="text"', () => {
    const onPress = jest.fn();
    const item = SIX_TIER_FIXTURES[5]; // product entity
    render(<AttentionCard item={item} onPress={onPress} />);

    const card = screen.getByTestId(`attention-card-${item.id}`);
    expect(card.props.onPress).toBeUndefined();
    expect(card.props.accessibilityRole).toBe('text');
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('AttentionCard long content safety', () => {
  it('renders a reason long enough to overflow a normal card width without crashing, wrapping via numberOfLines rather than destructively clipping', () => {
    const longReason =
      'Draft order MA-999 (৳12,345) has been awaiting confirmation for an unusually long time because the customer has not responded to several follow-up messages and the courier partner also flagged an address verification issue that still needs to be resolved before this can ship';
    const longItem: AttentionItem = { ...SIX_TIER_FIXTURES[3], id: 'draft_order:order:long-1', reason: longReason };

    render(<AttentionCard item={longItem} onPress={jest.fn()} />);

    const reasonNode = screen.getByText(longReason);
    expect(reasonNode).toBeTruthy();
    // Truncates with an ellipsis (RN's default `ellipsizeMode`) rather than an un-ellipsized hard
    // clip — `numberOfLines` is the mechanism, not a `noWrap`/fixed-height container.
    expect(reasonNode.props.numberOfLines).toBe(3);
  });
});
