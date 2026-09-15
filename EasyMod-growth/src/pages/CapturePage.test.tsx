import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, growthApi, type ProspectListItem } from '@/api/client';
import { CapturePage } from './CapturePage';

const CAPTURE_STORAGE_KEY = 'growth-os.capture-payload.v1';
const CAPTURE_NONCE = '0123456789abcdef0123456789abcdef';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

function makeProspect(overrides: Partial<ProspectListItem> = {}): ProspectListItem {
  return {
    id: 'captured-1',
    businessName: 'Salon Aasha',
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    pageUrl: 'https://facebook.com/salon-aasha',
    niche: null,
    notes: null,
    source: 'browser_extension',
    sourceDetail: 'facebook.com',
    sourceReference: null,
    sourceRecordedAt: null,
    status: 'new',
    statusChangedAt: null,
    disqualifiedReason: null,
    ownerUserId: null,
    assignedAt: null,
    assignedBy: null,
    linkedShopId: null,
    linkedUserId: null,
    linkedAt: null,
    mergedIntoId: null,
    mergedAt: null,
    createdBy: null,
    metadata: {},
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

function seedPayload(payload: unknown) {
  window.sessionStorage.setItem(CAPTURE_STORAGE_KEY, JSON.stringify(payload));
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/capture']}>
      <CapturePage />
    </MemoryRouter>,
  );
}

describe('CapturePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
    window.sessionStorage.removeItem(CAPTURE_STORAGE_KEY);
    window.history.replaceState({}, '', '/');
  });

  it('explains the extension flow when no capture payload exists', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'No page capture found' })).toBeInTheDocument();
    expect(screen.getByText(/browser extension/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create prospect' })).not.toBeInTheDocument();
  });

  it('ignores a malformed payload safely', async () => {
    window.sessionStorage.setItem(CAPTURE_STORAGE_KEY, 'not-json{');

    renderPage();

    expect(await screen.findByRole('heading', { name: 'No page capture found' })).toBeInTheDocument();
  });

  it('renders an editable preview with the source locked to the browser extension', async () => {
    seedPayload({
      businessName: 'Salon Aasha',
      pageUrl: 'https://facebook.com/salon-aasha',
      sourceWebsite: 'facebook.com',
      selectedText: 'Salon Aasha — beauty parlour in Dhaka',
      note: 'Metata owner replies fast',
    });

    renderPage();

    expect(await screen.findByLabelText(/Business name/)).toHaveValue('Salon Aasha');
    expect(screen.getByLabelText('Page URL')).toHaveValue('https://facebook.com/salon-aasha');
    expect(screen.getByLabelText('Note')).toHaveValue('Metata owner replies fast');
    expect(screen.getByText('browser extension')).toBeInTheDocument();
    expect(screen.getByText('Salon Aasha — beauty parlour in Dhaka')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create prospect' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CAPTURE_STORAGE_KEY)).toBeTruthy();
  });

  it('consumes an asynchronously posted, validated bridge payload when storage was not populated', async () => {
    window.history.replaceState({}, '', `/capture?captureNonce=${CAPTURE_NONCE}`);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'No page capture found' })).toBeInTheDocument();

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: window,
      data: {
        channel: 'growth-os.capture-bridge.v1',
        nonce: CAPTURE_NONCE,
        targetOrigin: window.location.origin,
        targetPath: '/capture',
        payload: {
          businessName: 'Async Salon',
          pageUrl: 'https://operator:secret@example.com/listing',
          sourceWebsite: 'example.com',
          selectedText: 'Open today',
        },
      },
    }));

    expect(await screen.findByLabelText(/Business name/)).toHaveValue('Async Salon');
    expect(screen.getByLabelText('Page URL')).toHaveValue('https://example.com/listing');
    expect(screen.getByText('Open today')).toBeInTheDocument();
  });

  it('ignores bridge payloads with invalid nonce, origin, or target', async () => {
    window.history.replaceState({}, '', `/capture?captureNonce=${CAPTURE_NONCE}`);

    renderPage();
    expect(await screen.findByRole('heading', { name: 'No page capture found' })).toBeInTheDocument();

    const message = {
      channel: 'growth-os.capture-bridge.v1',
      nonce: CAPTURE_NONCE,
      targetOrigin: window.location.origin,
      targetPath: '/capture',
      payload: { businessName: 'Spoofed Salon' },
    };
    for (const invalid of [
      { nonce: 'fedcba9876543210fedcba9876543210' },
      { targetOrigin: 'https://evil.example' },
      { targetPath: '/prospects' },
    ]) {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: { ...message, ...invalid },
      }));
    }
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example',
      source: window,
      data: message,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: message,
    }));

    await waitFor(() => expect(screen.queryByLabelText(/Business name/)).not.toBeInTheDocument());
  });

  it('creates the record after confirmation and only then clears the stored payload', async () => {
    const user = userEvent.setup();
    seedPayload({
      businessName: 'Salon Aasha',
      pageUrl: 'https://facebook.com/salon-aasha',
      sourceWebsite: 'facebook.com',
      selectedText: 'Beauty parlour in Dhaka',
    });
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    vi.spyOn(growthApi, 'createProspect').mockResolvedValue(makeProspect());

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Create prospect' }));

    await waitFor(() => expect(window.sessionStorage.getItem(CAPTURE_STORAGE_KEY)).toBeNull());
    expect(screen.getByRole('heading', { name: 'Salon Aasha' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open prospect record' })).toHaveAttribute('href', '/prospects/captured-1');
  });

  it('keeps the success state when capture storage cleanup throws', async () => {
    const user = userEvent.setup();
    seedPayload({
      businessName: 'Salon Aasha',
      pageUrl: 'https://facebook.com/salon-aasha',
      sourceWebsite: 'facebook.com',
    });
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    vi.spyOn(growthApi, 'createProspect').mockResolvedValue(makeProspect());
    const originalStorage = window.sessionStorage;
    const removeItem = vi.fn(() => {
      throw new Error('session storage unavailable');
    });
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({
      getItem: originalStorage.getItem.bind(originalStorage),
      setItem: originalStorage.setItem.bind(originalStorage),
      removeItem,
      clear: originalStorage.clear.bind(originalStorage),
      key: originalStorage.key.bind(originalStorage),
      length: originalStorage.length,
    } as unknown as Storage);

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByRole('heading', { name: 'Salon Aasha' })).toBeInTheDocument();
    expect(removeItem).toHaveBeenCalledWith(CAPTURE_STORAGE_KEY);
  });

  it('shows duplicate matches from preflight without offering a duplicate override', async () => {
    const user = userEvent.setup();
    seedPayload({ businessName: 'Salon Aasha', contactPhone: '01700000000', sourceWebsite: 'facebook.com' });
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({
      matches: [{ prospectId: 'existing-1', businessName: 'Existing Salon', status: 'new', matchedFields: ['contactPhone'] }],
    });
    const create = vi.spyOn(growthApi, 'createProspect').mockResolvedValue(makeProspect());

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByText('Possible duplicate prospect')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Existing Salon' })).toHaveAttribute('href', '/prospects/existing-1');
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create anyway' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update details' })).toBeInTheDocument();
  });

  it('strips page URL credentials before creating a captured prospect', async () => {
    const user = userEvent.setup();
    seedPayload({
      businessName: 'Salon Aasha',
      pageUrl: 'https://operator:secret@example.com/salon',
      sourceWebsite: 'example.com',
    });
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    const create = vi.spyOn(growthApi, 'createProspect').mockResolvedValue(makeProspect());

    renderPage();

    expect(await screen.findByLabelText('Page URL')).toHaveValue('https://example.com/salon');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      pageUrl: 'https://example.com/salon',
    })));
  });

  it('keeps the stored payload when creation fails on the server', async () => {
    const user = userEvent.setup();
    seedPayload({ businessName: 'Salon Aasha', pageUrl: 'https://facebook.com/salon-aasha' });
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    vi.spyOn(growthApi, 'createProspect').mockRejectedValue(new ApiError('Growth store unavailable', 500));

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Growth store unavailable');
    expect(window.sessionStorage.getItem(CAPTURE_STORAGE_KEY)).toBeTruthy();
  });

  it('blocks confirmation without any contact channel', async () => {
    const user = userEvent.setup();
    seedPayload({ businessName: 'Salon Aasha' });
    const create = vi.spyOn(growthApi, 'createProspect');

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('At least one of phone, email, or page URL is required.');
    expect(create).not.toHaveBeenCalled();
  });
});
