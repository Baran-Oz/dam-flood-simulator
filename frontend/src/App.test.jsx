import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders and offers to draw the dam axis', () => {
    render(<App />)
    expect(screen.getByText(/Dam Flood Simulator/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Draw dam axis/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Dam height in metres/i)).toBeDisabled()
  })
})
