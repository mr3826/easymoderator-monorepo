/**
 * Campaigns Component — Vitest Unit Tests
 * Tests campaign list, create form, preflight validation, run/schedule/stats actions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import Campaigns from '../Campaigns';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/api', () => ({
    apiClient: {
        getCampaigns: vi.fn(),
        createCampaign: vi.fn(),
        runCampaign: vi.fn(),
        scheduleCampaign: vi.fn(),
        getCampaignStats: vi.fn()
    }
}));

import { apiClient } from '@/api';
import { toast } from 'sonner';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeCampaign = (overrides = {}) => ({
    id: 'camp-1',
    name: 'Ramadan Win-Back',
    message_template: 'Hi! We miss you. Get 15% off this week.',
    status: 'draft',
    segment_filter: { requireConsent: true, recipientCap: 500 },
    total_recipients: 100,
    sent_count: 0,
    failed_count: 0,
    scheduled_at: null,
    created_at: new Date().toISOString(),
    ...overrides
});

const renderCampaigns = () =>
    render(
        <BrowserRouter>
            <Campaigns />
        </BrowserRouter>
    );

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Campaigns', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Rendering ─────────────────────────────────────────────────────────────

    it('renders Campaign Control Panel heading', async () => {
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText('Campaign Control Panel')).toBeInTheDocument();
        });
    });

    it('renders Create Campaign section', async () => {
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText('Create Campaign')).toBeInTheDocument();
        });
    });

    it('shows empty state when no campaigns', async () => {
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText('No campaigns yet.')).toBeInTheDocument();
        });
    });

    it('renders campaign list when campaigns loaded', async () => {
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([makeCampaign()]);
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText('Ramadan Win-Back')).toBeInTheDocument();
        });
    });

    it('renders table columns when campaigns exist', async () => {
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([makeCampaign()]);
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText('Name')).toBeInTheDocument();
            expect(screen.getByText('Status')).toBeInTheDocument();
            expect(screen.getByText('Recipients')).toBeInTheDocument();
        });
    });

    // ── Preflight Validation ──────────────────────────────────────────────────

    it('shows no blocking issues when form is valid', async () => {
        const user = userEvent.setup();
        renderCampaigns();
        await waitFor(() => screen.getByText('Campaign name is required.'));

        await user.type(screen.getByPlaceholderText('Ramadan Win-Back'), 'My Campaign');
        await user.type(screen.getByPlaceholderText(/We miss you/i), 'Hello this is a message');

        await waitFor(() => {
            expect(screen.getByText('No blocking issues detected.')).toBeInTheDocument();
        });
    });

    it('shows error when campaign name is empty', async () => {
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText('Campaign name is required.')).toBeInTheDocument();
        });
    });

    it('shows error when message template is empty', async () => {
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText('Message template is required.')).toBeInTheDocument();
        });
    });

    it('shows error when recipient cap is 0', async () => {
        const user = userEvent.setup();
        renderCampaigns();
        await waitFor(() => screen.getByLabelText(/Recipient cap/i));

        const capInput = screen.getByLabelText(/Recipient cap/i);
        await user.clear(capInput);
        await user.type(capInput, '0');

        await waitFor(() => {
            expect(screen.getByText('Recipient cap must be greater than 0.')).toBeInTheDocument();
        });
    });

    it('shows warning when recipient cap exceeds 500', async () => {
        const user = userEvent.setup();
        renderCampaigns();
        await waitFor(() => screen.getByLabelText(/Recipient cap/i));

        const capInput = screen.getByLabelText(/Recipient cap/i);
        await user.clear(capInput);
        await user.type(capInput, '600');

        await waitFor(() => {
            expect(screen.getByText(/Recipient cap above 500/i)).toBeInTheDocument();
        });
    });

    it('shows warning when consent is unchecked', async () => {
        const user = userEvent.setup();
        renderCampaigns();
        await waitFor(() => screen.getByRole('checkbox'));
        await user.click(screen.getByRole('checkbox'));
        await waitFor(() => {
            expect(screen.getByText(/compliance risk/i)).toBeInTheDocument();
        });
    });

    it('shows warning when message is very short', async () => {
        const user = userEvent.setup();
        renderCampaigns();
        await waitFor(() => screen.getByPlaceholderText(/We miss you/i));
        await user.type(screen.getByPlaceholderText('Ramadan Win-Back'), 'X');
        await user.type(screen.getByPlaceholderText(/We miss you/i), 'Short');
        await waitFor(() => {
            expect(screen.getByText(/very short/i)).toBeInTheDocument();
        });
    });

    // ── Create Campaign ───────────────────────────────────────────────────────

    it('calls apiClient.createCampaign with correct payload', async () => {
        const user = userEvent.setup();
        const newCampaign = makeCampaign({ name: 'Eid Special' });
        vi.mocked(apiClient.createCampaign).mockResolvedValue(newCampaign);
        renderCampaigns();

        await waitFor(() => screen.getByPlaceholderText('Ramadan Win-Back'));
        await user.type(screen.getByPlaceholderText('Ramadan Win-Back'), 'Eid Special');
        await user.type(screen.getByPlaceholderText(/We miss you/i), 'Hello! Eid Mubarak discount just for you.');
        await user.click(screen.getByRole('button', { name: /create campaign/i }));

        await waitFor(() => {
            expect(apiClient.createCampaign).toHaveBeenCalledWith(expect.objectContaining({
                name: 'Eid Special'
            }));
        });
    });

    it('shows toast.success after successful campaign creation', async () => {
        const user = userEvent.setup();
        vi.mocked(apiClient.createCampaign).mockResolvedValue(makeCampaign());
        renderCampaigns();

        await waitFor(() => screen.getByPlaceholderText('Ramadan Win-Back'));
        await user.type(screen.getByPlaceholderText('Ramadan Win-Back'), 'New');
        await user.type(screen.getByPlaceholderText(/We miss you/i), 'A longer message for the campaign here.');
        await user.click(screen.getByRole('button', { name: /create campaign/i }));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalled();
        });
    });

    it('shows toast.error when creation fails', async () => {
        const user = userEvent.setup();
        vi.mocked(apiClient.createCampaign).mockRejectedValue({ response: { data: { error: { message: 'Server error' } } } });
        renderCampaigns();

        await waitFor(() => screen.getByPlaceholderText('Ramadan Win-Back'));
        await user.type(screen.getByPlaceholderText('Ramadan Win-Back'), 'New');
        await user.type(screen.getByPlaceholderText(/We miss you/i), 'A longer message for the campaign here.');
        await user.click(screen.getByRole('button', { name: /create campaign/i }));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalled();
        });
    });

    it('does not submit when preflight errors exist', async () => {
        const user = userEvent.setup();
        renderCampaigns();
        await waitFor(() => screen.getByRole('button', { name: /create campaign/i }));
        await user.click(screen.getByRole('button', { name: /create campaign/i }));
        expect(apiClient.createCampaign).not.toHaveBeenCalled();
    });

    // ── Campaign Actions ──────────────────────────────────────────────────────

    it('calls apiClient.runCampaign when Run is clicked', async () => {
        const user = userEvent.setup();
        const campaign = makeCampaign();
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([campaign]);
        vi.mocked(apiClient.runCampaign).mockResolvedValue({ ...campaign, status: 'running' });
        renderCampaigns();

        await waitFor(() => screen.getByRole('button', { name: /^run$/i }));
        await user.click(screen.getByRole('button', { name: /^run$/i }));

        await waitFor(() => {
            expect(apiClient.runCampaign).toHaveBeenCalledWith('camp-1');
        });
    });

    it('shows toast.error when Schedule clicked without datetime', async () => {
        const user = userEvent.setup();
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([makeCampaign()]);
        renderCampaigns();

        await waitFor(() => screen.getByRole('button', { name: /schedule/i }));
        await user.click(screen.getByRole('button', { name: /schedule/i }));
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/schedule time/i));
    });

    it('calls apiClient.getCampaignStats when Stats is clicked', async () => {
        const user = userEvent.setup();
        const campaign = makeCampaign();
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([campaign]);
        vi.mocked(apiClient.getCampaignStats).mockResolvedValue({
            ...campaign, sent_count: 30, failed_count: 2, total_recipients: 100, status: 'running'
        });
        renderCampaigns();

        await waitFor(() => screen.getByRole('button', { name: /stats/i }));
        await user.click(screen.getByRole('button', { name: /stats/i }));

        await waitFor(() => {
            expect(apiClient.getCampaignStats).toHaveBeenCalledWith('camp-1');
        });
    });

    // ── Running State & Progress ──────────────────────────────────────────────

    it('shows progress bar when campaign is running', async () => {
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([
            makeCampaign({ status: 'running', sent_count: 50, total_recipients: 100, failed_count: 0 })
        ]);
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText(/50\/100 sent/i)).toBeInTheDocument();
        });
    });

    it('shows failed count in red when failed > 0', async () => {
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([
            makeCampaign({ status: 'running', sent_count: 90, total_recipients: 100, failed_count: 5 })
        ]);
        renderCampaigns();
        await waitFor(() => {
            expect(screen.getByText(/5 failed/i)).toBeInTheDocument();
        });
    });

    it('does not show progress bar for non-running campaigns', async () => {
        vi.mocked(apiClient.getCampaigns).mockResolvedValue([
            makeCampaign({ status: 'completed', sent_count: 100, total_recipients: 100 })
        ]);
        renderCampaigns();
        await waitFor(() => screen.getByText('Ramadan Win-Back'));
        expect(screen.queryByText(/\/100 sent/i)).toBeNull();
    });
});
