import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from '@/i18n';
import FaqSettings from './FaqSettings';
import { apiClient } from '@/api';
import type { KnowledgeGapSuggestion } from '@/api/types/knowledge';
import { toast } from 'sonner';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/api', () => ({
  apiClient: {
    listKnowledgeFaqs: vi.fn(),
    updateKnowledgeFaq: vi.fn(),
    createKnowledgeFaq: vi.fn(),
    deleteKnowledgeFaq: vi.fn(),
  },
}));

const gapApi = vi.hoisted(() => ({
  listGapSuggestions: vi.fn(),
  reviewGapSuggestion: vi.fn(),
  dismissGapSuggestion: vi.fn(),
  publishGapSuggestion: vi.fn(),
  isGapSuggestionsDisabled: vi.fn(),
}));
vi.mock('@/api/domains/knowledge', () => gapApi);

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const suggestion = (overrides: Partial<KnowledgeGapSuggestion> = {}): KnowledgeGapSuggestion => ({
  id: 'gap-1',
  display_question: 'How do I pay with bKash?',
  owner_domain: 'PAYMENT',
  status: 'OPEN',
  evidence_count: 7,
  first_seen_at: '2026-10-01T00:00:00Z',
  last_seen_at: '2026-10-24T00:00:00Z',
  resolved_faq_id: null,
  published_at: null,
  authoritative_action: 'open_payment_settings',
  ...overrides,
});

const policySuggestion = () =>
  suggestion({
    id: 'gap-4',
    display_question: 'Can I return a dress if it does not fit?',
    owner_domain: 'POLICY',
    authoritative_action: 'author_faq',
    evidence_count: 3,
  });

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.listKnowledgeFaqs as any).mockResolvedValue([]);
  gapApi.listGapSuggestions.mockResolvedValue({ featureDisabled: false, data: [] });
  gapApi.reviewGapSuggestion.mockResolvedValue({ status: 'IN_REVIEW' });
  gapApi.dismissGapSuggestion.mockResolvedValue({ status: 'DISMISSED' });
  gapApi.publishGapSuggestion.mockResolvedValue({ faq_id: 'faq-9', status: 'PUBLISHED' });
});

describe('P+05 FAQ settings knowledge-gap-suggestions', () => {
  it('renders nothing when the feature flag is off, with a single fetch on mount', async () => {
    gapApi.listGapSuggestions.mockResolvedValue({ featureDisabled: true });
    render(<FaqSettings />);

    await waitFor(() => expect(gapApi.listGapSuggestions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apiClient.listKnowledgeFaqs).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('gap-suggestions')).toBeNull();
    expect(screen.queryByText('Questions customers keep asking')).toBeNull();
  });

  it('renders a card per suggestion with the domain-correct primary action', async () => {
    gapApi.listGapSuggestions.mockResolvedValue({
      featureDisabled: false,
      data: [
        suggestion(),
        suggestion({ id: 'gap-2', display_question: 'How long does delivery take outside Dhaka?', owner_domain: 'DELIVERY', authoritative_action: 'open_delivery_settings', evidence_count: 5 }),
        suggestion({ id: 'gap-3', display_question: 'Is the 32GB RAM variant in stock?', owner_domain: 'PRODUCT', authoritative_action: 'open_product_catalog', evidence_count: 2 }),
        policySuggestion(),
        suggestion({ id: 'gap-5', display_question: 'Do you ship to Chattogram?', owner_domain: 'OTHER', authoritative_action: 'author_faq', evidence_count: 4 }),
      ],
    });
    render(<FaqSettings />);

    const section = await screen.findByTestId('gap-suggestions');
    expect(within(section).getByText('Questions customers keep asking')).toBeInTheDocument();

    expect(within(screen.getByTestId('gap-suggestion-gap-1')).getByRole('button', { name: /Open settings/i })).toBeInTheDocument();
    expect(within(screen.getByTestId('gap-suggestion-gap-2')).getByRole('button', { name: /Open settings/i })).toBeInTheDocument();
    expect(within(screen.getByTestId('gap-suggestion-gap-3')).getByRole('button', { name: /Open settings/i })).toBeInTheDocument();
    expect(within(screen.getByTestId('gap-suggestion-gap-4')).getByRole('button', { name: /Write answer/i })).toBeInTheDocument();
    expect(within(screen.getByTestId('gap-suggestion-gap-5')).getByRole('button', { name: /Write answer/i })).toBeInTheDocument();

    expect(within(screen.getByTestId('gap-suggestion-gap-1')).getByText('asked 7 times')).toBeInTheDocument();
    expect(within(screen.getByTestId('gap-suggestion-gap-1')).getByText('Payment')).toBeInTheDocument();
    expect(within(screen.getByTestId('gap-suggestion-gap-3')).getByText('Product')).toBeInTheDocument();
    expect(within(screen.getByTestId('gap-suggestion-gap-5')).getByText('Other')).toBeInTheDocument();
  });

  it('routes the settings button of each domain to its existing settings page', async () => {
    gapApi.listGapSuggestions.mockResolvedValue({
      featureDisabled: false,
      data: [
        suggestion(),
        suggestion({ id: 'gap-2', owner_domain: 'DELIVERY', authoritative_action: 'open_delivery_settings' }),
        suggestion({ id: 'gap-3', owner_domain: 'PRODUCT', authoritative_action: 'open_product_catalog' }),
      ],
    });
    render(<FaqSettings />);

    await screen.findByTestId('gap-suggestions');
    fireEvent.click(within(screen.getByTestId('gap-suggestion-gap-1')).getByTestId('gap-open-settings'));
    fireEvent.click(within(screen.getByTestId('gap-suggestion-gap-2')).getByTestId('gap-open-settings'));
    fireEvent.click(within(screen.getByTestId('gap-suggestion-gap-3')).getByTestId('gap-open-settings'));

    expect(navigateMock).toHaveBeenNthCalledWith(1, '/manage-shop/payment-settings');
    expect(navigateMock).toHaveBeenNthCalledWith(2, '/manage-shop/delivery-settings');
    expect(navigateMock).toHaveBeenNthCalledWith(3, '/products');
  });

  it('marks the suggestion in review and posts the merchant-authored question and answer on publish', async () => {
    gapApi.listGapSuggestions.mockResolvedValue({ featureDisabled: false, data: [policySuggestion()] });
    render(<FaqSettings />);

    const card = await screen.findByTestId('gap-suggestion-gap-4');
    fireEvent.click(within(card).getByRole('button', { name: /Write answer/i }));

    await waitFor(() => expect(gapApi.reviewGapSuggestion).toHaveBeenCalledWith('gap-4'));

    expect(within(card).getByDisplayValue('Can I return a dress if it does not fit?')).toBeInTheDocument();
    fireEvent.change(within(card).getByRole('textbox', { name: /Your answer/i }), {
      target: { value: 'Yes — send it back within 7 days with the tag intact.' },
    });
    fireEvent.click(within(card).getByTestId('gap-publish'));

    await waitFor(() =>
      expect(gapApi.publishGapSuggestion).toHaveBeenCalledWith('gap-4', {
        question: 'Can I return a dress if it does not fit?',
        answer: 'Yes — send it back within 7 days with the tag intact.',
      })
    );
  });

  it('removes the card and toasts on publish success', async () => {
    gapApi.listGapSuggestions.mockResolvedValue({ featureDisabled: false, data: [policySuggestion()] });
    render(<FaqSettings />);

    const card = await screen.findByTestId('gap-suggestion-gap-4');
    fireEvent.click(within(card).getByRole('button', { name: /Write answer/i }));
    fireEvent.change(within(card).getByRole('textbox', { name: /Your answer/i }), {
      target: { value: 'Within 7 days, no questions asked.' },
    });
    fireEvent.click(within(card).getByTestId('gap-publish'));

    await waitFor(() => expect(screen.queryByTestId('gap-suggestion-gap-4')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Answer published to your FAQs.');
    expect(gapApi.listGapSuggestions).toHaveBeenCalledTimes(1);
  });

  it('dismisses with the chosen reason', async () => {
    gapApi.listGapSuggestions.mockResolvedValue({ featureDisabled: false, data: [suggestion()] });
    render(<FaqSettings />);

    const card = await screen.findByTestId('gap-suggestion-gap-1');
    fireEvent.click(within(card).getByRole('button', { name: /^Dismiss$/i }));
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'OUTDATED' } });
    fireEvent.click(within(card).getByTestId('gap-dismiss-confirm'));

    await waitFor(() => expect(gapApi.dismissGapSuggestion).toHaveBeenCalledWith('gap-1', 'OUTDATED'));
    await waitFor(() => expect(screen.queryByTestId('gap-suggestion-gap-1')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Suggestion dismissed.');
  });

  it('refetches the list without a success toast when publish hits a 409 state conflict', async () => {
    gapApi.listGapSuggestions
      .mockResolvedValueOnce({ featureDisabled: false, data: [policySuggestion()] })
      .mockResolvedValueOnce({ featureDisabled: false, data: [] });
    gapApi.publishGapSuggestion.mockRejectedValue(
      Object.assign(new Error('conflict'), { statusCode: 409, code: 'GAP_STATE_CONFLICT' })
    );
    render(<FaqSettings />);

    const card = await screen.findByTestId('gap-suggestion-gap-4');
    fireEvent.click(within(card).getByRole('button', { name: /Write answer/i }));
    fireEvent.change(within(card).getByRole('textbox', { name: /Your answer/i }), {
      target: { value: 'Some answer' },
    });
    fireEvent.click(within(card).getByTestId('gap-publish'));

    await waitFor(() => expect(gapApi.listGapSuggestions).toHaveBeenCalledTimes(2));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('refetches the list without a success toast when dismiss hits a 409 state conflict', async () => {
    gapApi.listGapSuggestions
      .mockResolvedValueOnce({ featureDisabled: false, data: [suggestion()] })
      .mockResolvedValueOnce({ featureDisabled: false, data: [] });
    gapApi.dismissGapSuggestion.mockRejectedValue(
      Object.assign(new Error('conflict'), { statusCode: 409, code: 'GAP_STATE_CONFLICT' })
    );
    render(<FaqSettings />);

    const card = await screen.findByTestId('gap-suggestion-gap-1');
    fireEvent.click(within(card).getByRole('button', { name: /^Dismiss$/i }));
    fireEvent.click(within(card).getByTestId('gap-dismiss-confirm'));

    await waitFor(() => expect(gapApi.listGapSuggestions).toHaveBeenCalledTimes(2));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
