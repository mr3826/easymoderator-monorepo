import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { AttentionItem } from '@/api/mobile/schemas';
import i18n from '@/i18n';
import { HOME_ATTENTION_ITEMS } from '@/test/home-fixtures';
import { AttentionCard } from './AttentionCard';

const BENGALI_REASON_KEYS: Record<AttentionItem['signal_type'], string> = {
  COURIER_FAILED: 'mobile.home.reasons.COURIER_DISPATCH_FAILED',
  COURIER_INDETERMINATE: 'mobile.home.reasons.COURIER_DISPATCH_INDETERMINATE',
  COURIER_SETUP_REQUIRED: 'mobile.home.reasons.COURIER_SETUP_REQUIRED',
  INBOX_NEEDS_REPLY: 'mobile.home.reasons.CUSTOMER_UNANSWERED',
  DRAFT_ORDER: 'mobile.home.reasons.DRAFT_ORDER_AWAITING_CONFIRMATION',
  RTO_VERIFY: 'mobile.home.reasons.RTO_VERIFICATION_REQUIRED',
  LOW_STOCK: 'mobile.home.reasons.LOW_STOCK',
};

beforeEach(async () => {
  await i18n.changeLanguage('bn');
});

afterEach(async () => {
  await i18n.changeLanguage('bn');
});

describe('AttentionCard seeded attention rows', () => {
  it.each([...HOME_ATTENTION_ITEMS])(
    'renders $signal_type (tier $tier) with the server reason, entity label, and priority',
    (item) => {
      render(<AttentionCard item={item} onPress={jest.fn()} />);

      expect(screen.getByTestId(`attention-card-${item.id}`)).toBeTruthy();
      expect(screen.getByText(i18n.t(BENGALI_REASON_KEYS[item.signal_type]))).toBeTruthy();
      expect(screen.getByText(i18n.t(`mobile.home.entity.${item.entity.type}`))).toBeTruthy();
      expect(screen.getByText(i18n.t('mobile.home.attention.priority', { tier: item.tier }))).toBeTruthy();
    },
  );

  it('covers the six spec ranking rows plus both supported tier-1 courier variants', () => {
    const rows = new Set(HOME_ATTENTION_ITEMS.map((item) => `${item.tier}:${item.signal_type}`));

    expect(rows).toEqual(
      new Set([
        '1:COURIER_FAILED',
        '1:COURIER_INDETERMINATE',
        '1:COURIER_SETUP_REQUIRED',
        '2:INBOX_NEEDS_REPLY',
        '3:DRAFT_ORDER',
        '4:RTO_VERIFY',
        '5:LOW_STOCK',
      ]),
    );
  });
});

describe('AttentionCard action semantics', () => {
  it.each(
    HOME_ATTENTION_ITEMS.filter(
      (item): item is AttentionItem & { entity: { type: 'order' | 'conversation'; id: string } } =>
        item.entity.type !== 'product',
    ),
  )('presses order/conversation row $id with the exact item', (item) => {
    const onPress = jest.fn();
    render(<AttentionCard item={item} onPress={onPress} />);

    const card = screen.getByTestId(`attention-card-${item.id}`);
    expect(card.props.accessibilityRole).toBe('button');
    fireEvent.press(card);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(item);
  });

  it('keeps a product row informational-only', () => {
    const item = HOME_ATTENTION_ITEMS.find((candidate) => candidate.entity.type === 'product');
    if (!item) throw new Error('product fixture missing');

    const onPress = jest.fn();
    render(<AttentionCard item={item} onPress={onPress} />);

    const card = screen.getByTestId(`attention-card-${item.id}`);
    expect(card.props.accessibilityRole).toBe('text');
    expect(card.props.onPress).toBeUndefined();
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('AttentionCard localization and long content', () => {
  it('renders Bengali first and updates its labels when the locale changes to English', async () => {
    const item = HOME_ATTENTION_ITEMS.find((candidate) => candidate.entity.type === 'conversation');
    if (!item) throw new Error('conversation fixture missing');

    render(<AttentionCard item={item} onPress={jest.fn()} />);
    expect(screen.getByText(i18n.t('mobile.home.entity.conversation', { lng: 'bn' }))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.home.attention.priority', { tier: item.tier, lng: 'bn' }))).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await waitFor(() => {
      expect(screen.getByText(i18n.t('mobile.home.entity.conversation', { lng: 'en' }))).toBeTruthy();
      expect(screen.getByText(i18n.t('mobile.home.attention.priority', { tier: item.tier, lng: 'en' }))).toBeTruthy();
    });
  });

  it('uses the stable reason code for Bengali copy instead of rendering backend English text', () => {
    const item: AttentionItem = {
      ...HOME_ATTENTION_ITEMS[0],
      reason_code: 'COURIER_DISPATCH_FAILED',
      reason: 'Courier dispatch failed for order MA-1 — needs manual retry',
    };

    render(<AttentionCard item={item} onPress={jest.fn()} />);

    expect(screen.getByText(i18n.t('mobile.home.reasons.COURIER_DISPATCH_FAILED'))).toBeTruthy();
    expect(screen.queryByText(item.reason)).toBeNull();
  });

  it('wraps long server reasons instead of hard-clipping them', async () => {
    const item = HOME_ATTENTION_ITEMS.find((candidate) => candidate.signal_type === 'DRAFT_ORDER');
    if (!item) throw new Error('draft fixture missing');

    const longReason = `${item.reason} because the customer has not responded to several follow-up messages and the courier also flagged an address verification issue that still needs to be resolved before shipping`;
    const longItem: AttentionItem = { ...item, id: 'draft_order:order:long', reason: longReason };
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    render(<AttentionCard item={longItem} onPress={jest.fn()} />);

    expect(screen.getByText(longReason).props.numberOfLines).toBe(3);
  });
});
