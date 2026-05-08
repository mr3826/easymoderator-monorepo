import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddProduct from '../app/components/AddProduct'

const mockNavigate = vi.fn()
const mockOnClose = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
  }
})

vi.mock('../app/lib/api', () => ({
  apiClient: {
    getCategories: vi.fn().mockResolvedValue([]),
    createProduct: vi.fn().mockResolvedValue({ id: 'prod-123', name: 'Demo Product' }),
    updateProduct: vi.fn().mockResolvedValue({ id: 'prod-123', name: 'Updated Product' }),
    getProduct: vi.fn().mockResolvedValue({}),
  },
}))

const getPublishButton = () => {
  const button = screen
    .getAllByRole('button')
    .find((node) => node.textContent?.toLowerCase().includes('publish'))

  if (!button) {
    throw new Error('Publish button not found')
  }

  return button
}

describe('AddProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders add product modal fields', () => {
    render(<AddProduct isModal={true} onClose={mockOnClose} />)

    expect(document.getElementById('modal-product-name')).toBeInTheDocument()
    expect(document.getElementById('modal-base-price')).toBeInTheDocument()
    expect(getPublishButton()).toBeInTheDocument()
  })

  it('shows validation error when product name is missing', async () => {
    render(<AddProduct isModal={true} onClose={mockOnClose} />)

    const priceInput = document.getElementById('modal-base-price') as HTMLInputElement
    fireEvent.change(priceInput, { target: { value: '99.99' } })
    fireEvent.click(getPublishButton())

    await waitFor(() => {
      expect(screen.getByText('Product name is required')).toBeInTheDocument()
    })
  })

  it('creates product and navigates to products page', async () => {
    const { apiClient } = await import('../app/lib/api')

    render(<AddProduct isModal={true} onClose={mockOnClose} />)

    const nameInput = document.getElementById('modal-product-name') as HTMLInputElement
    const priceInput = document.getElementById('modal-base-price') as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'Demo Product' } })
    fireEvent.change(priceInput, { target: { value: '99.99' } })
    fireEvent.click(getPublishButton())

    await waitFor(() => {
      expect(apiClient.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Demo Product',
          price: 99.99,
        })
      )
      expect(mockNavigate).toHaveBeenCalledWith('/app/products')
    })
  })
})
