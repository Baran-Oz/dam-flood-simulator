import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

describe('App drawing controls', () => {
  it('offers Undo and Finish while drawing, disabled until there are two points', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Draw dam axis/i }))
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Undo point' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /Draw dam axis/i })).toBeInTheDocument()
  })
})

describe('App on a phone', () => {
  const realMatchMedia = window.matchMedia
  beforeEach(() => {
    window.matchMedia = q => ({
      matches: q.includes('max-width') || q.includes('coarse'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  })
  afterEach(() => { window.matchMedia = realMatchMedia })

  it('shows a compact bottom sheet that expands to the full settings', () => {
    render(<App />)
    const handle = screen.getByRole('button', { name: /Settings & details/i })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Draw dam axis/i })).toBeInTheDocument()
    expect(screen.queryByText('Terrain data')).not.toBeInTheDocument()

    fireEvent.click(handle)
    expect(screen.getByRole('button', { name: /Show less/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Terrain data')).toBeInTheDocument()
  })

  it('collapses the sheet and says "tap" when drawing starts', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Settings & details/i }))
    fireEvent.click(screen.getByRole('button', { name: /Draw dam axis/i }))
    expect(screen.getByRole('button', { name: /Settings & details/i })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/Tap points across the valley/)).toBeInTheDocument()
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
