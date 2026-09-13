import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, growthApi, type ProspectListItem } from '@/api/client';
import { CapturePage } from './CapturePage';

const CAPTURE_STORAGE_KEY = 'growth-os.capture-payload.v1';

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

  it('shows duplicate matches from preflight and lets the operator continue anyway', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Create anyway' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ source: 'browser_extension' })));
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
