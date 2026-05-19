import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Reports from '../app/components/Reports'
import type { MetaChannel } from '@/api/domains/meta-channels'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

// Reports.tsx calls listMetaChannels directly (Phase 5 cutover)
vi.mock('@/api/domains/meta-channels', () => ({
  listMetaChannels: vi.fn().mockResolvedValue([
    {
      id: 'mc-1', shopId: 'sh', platform: 'facebook', metaAssetId: 'pg-1',
      displayName: 'Facebook Inbox', pictureUrl: null, linkedFbPageId: null,
      status: 'CONNECTED', lastError: null, tokenExpiresAt: null,
      tokenLastRefreshedAt: null, webhookSubscribedFields: [],
      webhookLastVerifiedAt: null, connectedAt: null, disconnectedAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: 'mc-2', shopId: 'sh', platform: 'instagram', metaAssetId: 'ig-1',
      displayName: 'Instagram Inbox', pictureUrl: null, linkedFbPageId: null,
      status: 'CONNECTED', lastError: null, tokenExpiresAt: null,
      tokenLastRefreshedAt: null, webhookSubscribedFields: [],
      webhookLastVerifiedAt: null, connectedAt: null, disconnectedAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ] as MetaChannel[]),
}))

vi.mock('@/api', () => ({
  apiClient: {
    getDashboardMetrics: vi.fn().mockResolvedValue({
      metrics: {
        totalMessages: 30,
        activeProducts: 12,
        ordersToday: 7,
        conversionRate: 6.5,
      },
      channels: {
        active: 2,
        total: 3,
      },
      chartData: [],
    }),
    getKnowledgeGaps: vi.fn().mockResolvedValue([]),
  },
}))

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Reports', () => {
  it('renders metrics and channel performance from API data', async () => {
    renderWithRouter(<Reports />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '30' })).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: '12' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '7' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '6.5%' })).toBeInTheDocument()
    expect(screen.getByText('Facebook Inbox')).toBeInTheDocument()
    expect(screen.getByText('Instagram Inbox')).toBeInTheDocument()
  })
})
