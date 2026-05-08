import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Categories from '@/app/components/Categories'

// Mock the API client
vi.mock('@/api', () => ({
  apiClient: {
    getCategories: vi.fn().mockResolvedValue([
      { id: '1', name: 'Electronics', subcategories: [] }
    ])
  }
}))

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Categories', () => {
  it('renders categories list', async () => {
    renderWithRouter(<Categories />)

    await waitFor(() => {
      expect(screen.getByText('Electronics')).toBeInTheDocument()
    })
  })
})