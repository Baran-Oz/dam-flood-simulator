import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

describe('App', () => {
  it('renders and offers to draw the dam axis', () => {
    render(<App />)
    expect(within(screen.getByRole('banner')).getByText(/Dam Flood Simulator/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Draw dam axis/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Dam height in metres/i)).toBeDisabled()
  })

  it('has an About dialog with the disclaimer', () => {
    render(<App />)
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'About' }))
    expect(screen.getByText('Not for engineering decisions')).toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page', () => {
    const Boom = () => { throw new Error('kaboom') }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByText('kaboom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    spy.mockRestore()
  })
})
