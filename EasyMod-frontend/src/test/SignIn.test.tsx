import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import SignIn from '@/app/components/SignIn'

const mockSignin = vi.fn().mockResolvedValue({})

// SignIn relies on AuthProvider context via useAuth().
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    signin: mockSignin,
  }),
}))

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('SignIn', () => {
  it('renders signin form', () => {
    renderWithRouter(<SignIn />)

    expect(screen.getByLabelText(/email|mobile/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('handles form submission', async () => {
    renderWithRouter(<SignIn />)

    const emailInput = screen.getByLabelText(/email|mobile/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'password123' } })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockSignin).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      })
    })
  })
})