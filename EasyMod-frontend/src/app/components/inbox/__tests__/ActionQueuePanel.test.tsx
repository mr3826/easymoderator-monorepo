/**
 * P+03 Merchant Action Queue — panel contract tests.
 * Mirrors src/test/InboxLeadInsight.test.tsx: real i18n + mocked domain and router.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { ActionQueuePanel } from '../ActionQueuePanel';
import type { InboxActionItem, InboxActionsResponse } from '@/api/types/inbox';
import type { InboxActionsResult } from '@/api/domains/inbox';

const inboxApi = vi.hoisted(() => ({
  getInboxActions: vi.fn(),
}));
vi.mock('@/api/domains/inbox', () => inboxApi);

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const item = (overrides: Partial<InboxActionItem> = {}): InboxActionItem => ({
  bucket: 1,
  item_key: 'hitl:conv-1',
  reason_code: 'HITL_REQUIRED',
  source: { type: 'conversation', id: 'conv-1' },
  conversation_id: 'conv-1',
  customer_id: 'cust-1',
  status: 'awaiting_human',
  owner: null,
  next_action: { type: 'open_conversation' },
  grounded_deadline: null,
  since: '2026-10-24T08:00:00Z',
  ...overrides,
});

const response = (items: InboxActionItem[]): InboxActionsResponse => ({
  items,
  generated_at: '2026-10-25T01:00:00Z',
  partial: false,
});

const okResult = (items: InboxActionItem[]): InboxActionsResult => ({
  featureDisabled: false,
  data: response(items),
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActionQueuePanel (P+03)', () => {
  it('renders nothing when the shop flag is off (409 FEATURE_DISABLED)', async () => {
    inboxApi.getInboxActions.mockResolvedValue({ featureDisabled: true });
    const { container } = render(<ActionQueuePanel />);
    await waitFor(() => expect(inboxApi.getInboxActions).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the queue is empty', async () => {
    inboxApi.getInboxActions.mockResolvedValue(okResult([]));
    const { container } = render(<ActionQueuePanel />);
    await waitFor(() => expect(inboxApi.getInboxActions).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on load failure — the strip must never block the inbox', async () => {
    inboxApi.getInboxActions.mockRejectedValue(new Error('network'));
    const { container } = render(<ActionQueuePanel />);
    await waitFor(() => expect(inboxApi.getInboxActions).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('groups items in operational-risk bucket order with reason labels, and shows the deadline only when grounded', async () => {
    // Deliberately out of bucket order: server risk-ordering is bucket asc,
    // and only the CUSTOMER_BLOCKED item carries a grounded deadline.
    inboxApi.getInboxActions.mockResolvedValue(okResult([
      item({
        bucket: 5, item_key: 'opportunity:op-9', reason_code: 'OPPORTUNITY_OPEN',
        source: { type: 'customer_opportunity', id: 'op-9' }, conversation_id: 'conv-9',
        status: 'OPEN', next_action: { type: 'review_opportunity', strength: 'HIGH' },
      }),
      item({
        bucket: 3, item_key: 'session:s-3', reason_code: 'CHECKOUT_WAITING_CUSTOMER',
        source: { type: 'order_session', id: 's-3' }, conversation_id: 'conv-3',
        status: 'suspended', next_action: { type: 'resume_checkout', step: 'ADDRESS' },
        grounded_deadline: '2026-10-25T05:00:00Z', since: '2026-10-25T00:30:00Z',
      }),
      item({
        bucket: 1, item_key: 'hitl:conv-1', reason_code: 'HITL_REQUIRED',
        conversation_id: 'conv-1', since: '2026-10-24T22:00:00Z',
      }),
    ]));
    const { container } = render(<ActionQueuePanel />);
    await screen.findByTestId('action-queue');

    const rows = Array.from(container.querySelectorAll('[data-testid="action-item"]'));
    expect(rows).toHaveLength(3);
    const text = rows.map((row) => row.textContent || '');
    expect(text[0]).toContain('Customer asked for a human');
    expect(text[1]).toContain('Customer stuck in checkout');
    expect(text[2]).toContain('Ready-to-order customer');

    // Deadline rendered for the grounded item only.
    expect(screen.getAllByTestId('action-deadline')).toHaveLength(1);
    expect(screen.getByTestId('action-deadline')).toHaveTextContent(/^Due /);

    // Summary shows the total.
    expect(screen.getByTestId('action-queue')).toHaveTextContent(/Top actions \(3\)/);
  });

  it('deep-links the next action to the conversation', async () => {
    inboxApi.getInboxActions.mockResolvedValue(okResult([
      item({ conversation_id: 'conv-7', item_key: 'hitl:conv-7' }),
    ]));
    render(<ActionQueuePanel />);
    const link = await screen.findByTestId('action-next-link');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/inbox?conversation=conv-7');
  });

  it('shows an "assigned" state chip when the item has an owner — never the name', async () => {
    inboxApi.getInboxActions.mockResolvedValue(okResult([
      item({ owner: 'user-3f2a-secret-uuid' }),
    ]));
    const { container } = render(<ActionQueuePanel />);
    await screen.findByTestId('action-queue');
    expect(screen.getByText('Assigned')).toBeInTheDocument();
    expect(container.textContent).not.toContain('user-3f2a-secret-uuid');
  });

  it('refetches when the parent fires the registered SSE refresh', async () => {
    let fireRefresh!: () => void;
    inboxApi.getInboxActions.mockResolvedValue(okResult([item()]));
    render(<ActionQueuePanel onSseRefresh={(refresh) => { fireRefresh = refresh; }} />);
    await waitFor(() => expect(inboxApi.getInboxActions).toHaveBeenCalledTimes(1));
    expect(fireRefresh).toBeTypeOf('function');

    inboxApi.getInboxActions.mockResolvedValue(okResult([
      item(),
      item({
        bucket: 4, item_key: 'draft:m-1', reason_code: 'DRAFT_AWAITING_REVIEW',
        source: { type: 'message', id: 'm-1' }, conversation_id: 'conv-1',
        status: 'DRAFT_READY', next_action: { type: 'review_draft' },
      }),
    ]));
    await act(async () => { fireRefresh(); });

    await waitFor(() => expect(inboxApi.getInboxActions).toHaveBeenCalledTimes(2));
    const rows = await screen.findAllByTestId('action-item');
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('AI draft waiting for your OK');
  });

  it('manual refresh button refetches', async () => {
    inboxApi.getInboxActions.mockResolvedValue(okResult([item()]));
    render(<ActionQueuePanel />);
    await waitFor(() => expect(inboxApi.getInboxActions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('action-queue-refresh'));
    await waitFor(() => expect(inboxApi.getInboxActions).toHaveBeenCalledTimes(2));
  });
});
