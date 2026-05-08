import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Orders from '@/app/components/Orders'

// Mock the API client
vi.mock('@/api', () => ({
  apiClient: {
    getOrders: vi.fn().mockResolvedValue([]),
    getProducts: vi.fn().mockResolvedValue([])
  }
}))

describe('Orders', () => {
  it('renders orders page', async () => {
    render(<BrowserRouter><Orders /></BrowserRouter>)

    await waitFor(() => {
      expect(screen.getByText('Orders')).toBeInTheDocument()
    })
  })
})