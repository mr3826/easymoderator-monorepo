import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import App from '../app/App'

describe('App', () => {
  it('renders without crashing', () => {
    expect(() => render(<App />)).not.toThrow()
  })
})