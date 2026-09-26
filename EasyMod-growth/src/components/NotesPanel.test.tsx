import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type InternalNote, type InternalNoteListResponse } from '@/api/client';
import { usePermission } from '@/auth/usePermission';
import { NotesPanel } from './NotesPanel';

const reportApiError = vi.fn(() => false);
const session = { internalUserId: 'me-1', displayName: 'Dana', role: 'GROWTH_USER', legacyRole: null, permissions: [] };

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError, session }),
}));
vi.mock('@/auth/usePermission', () => ({
  usePermission: vi.fn(),
}));

const permissionMock = vi.mocked(usePermission);

function makeNote(overrides: Partial<InternalNote> = {}): InternalNote {
  return {
    id: 'note-1',
    targetType: 'prospect',
    targetId: 'prospect-1',
    authorUserId: 'me-1',
    authorDisplayName: 'Dana Founder',
    body: 'Owner prefers WhatsApp over calls.',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    ...overrides,
  };
}

function list(items: InternalNote[]): InternalNoteListResponse {
  return { items, total: items.length, page: 1, pageSize: 20 };
}

function renderPanel(targetType: InternalNote['targetType'] = 'prospect') {
  return render(<NotesPanel targetType={targetType} targetId="target-1" />);
}

describe('NotesPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  it('lists internal notes with the merchant-visibility warning', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(workspaceApi, 'listNotes').mockResolvedValue(list([makeNote()]));

    renderPanel();

    expect(await screen.findByText('Owner prefers WhatsApp over calls.')).toBeInTheDocument();
    expect(screen.getByText('Internal notes — never visible to merchants')).toBeInTheDocument();
    expect(workspaceApi.listNotes).toHaveBeenCalledWith('prospect', 'target-1', { page: 1, pageSize: 20 });
    expect(screen.getByRole('button', { name: /Delete note/ })).toBeInTheDocument();
  });

  it('renders operator names instead of raw UUIDs and honest fallbacks', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(workspaceApi, 'listNotes').mockResolvedValue(list([
      makeNote(),
      makeNote({
        id: 'note-gone',
        authorUserId: null,
        authorDisplayName: null,
        body: 'Note by a removed account.',
      }),
      makeNote({
        id: 'note-redacted',
        authorUserId: null,
        authorDisplayName: null,
        authorRedacted: true,
        body: 'Note seen through a restricted source scope.',
      }),
    ]));

    renderPanel();

    expect(await screen.findByText(/Dana Founder ·/)).toBeInTheDocument();
    expect(screen.getByText(/Former operator \(account removed\) ·/)).toBeInTheDocument();
    expect(screen.getByText(/Operator details restricted ·/)).toBeInTheDocument();
    expect(screen.queryByText(/me-1 ·/)).not.toBeInTheDocument();
  });

  it('hides all note surfaces unless the notes permission is granted', async () => {
    permissionMock.mockReturnValue(false);
    const listNotes = vi.spyOn(workspaceApi, 'listNotes').mockResolvedValue(list([makeNote()]));

    const { container } = renderPanel('shop');

    expect(container.firstChild).toBeNull();
    expect(listNotes).not.toHaveBeenCalled();
    expect(permissionMock).toHaveBeenCalledWith('growth_os.notes.manage');
  });

  it('creates notes and restricts delete affordances to the author', async () => {
    permissionMock.mockReturnValue(true);
    const notesListSpy = vi.spyOn(workspaceApi, 'listNotes').mockResolvedValue(list([
      makeNote({ id: 'note-own' }),
      makeNote({ id: 'note-other', authorUserId: 'someone-else', body: 'Colleague note body' }),
    ]));
    const create = vi.spyOn(workspaceApi, 'createNote').mockResolvedValue(makeNote());

    renderPanel();

    await screen.findByText('Owner prefers WhatsApp over calls.');
    const deleteButtons = screen.getAllByRole('button', { name: /Delete note/ });
    expect(deleteButtons).toHaveLength(1);

    await userEvent.setup().type(screen.getByLabelText('New note'), 'Renegotiated pricing by phone.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      targetType: 'prospect',
      targetId: 'target-1',
      body: 'Renegotiated pricing by phone.',
    }));
    await waitFor(() => expect(notesListSpy).toHaveBeenCalledTimes(2));
  });

  it('deletes a own note through the delete note endpoint', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(workspaceApi, 'listNotes').mockResolvedValue(list([makeNote()]));
    const remove = vi.spyOn(workspaceApi, 'deleteNote').mockResolvedValue({ deleted: true });

    renderPanel();

    await userEvent.setup().click(await screen.findByRole('button', { name: /Delete note/ }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('note-1'));
  });

  it('surfaces an inline retryable error when the note list fails', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(workspaceApi, 'listNotes').mockRejectedValue(new ApiError('Notes unavailable', 500));

    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Notes unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
