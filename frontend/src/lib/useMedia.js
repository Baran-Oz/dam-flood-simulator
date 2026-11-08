import { useEffect, useState } from 'react'

const match = q => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false)

/** Whether a CSS media query matches, kept up to date (false where matchMedia is missing) */
export function useMedia(query) {
  const [matches, setMatches] = useState(() => match(query))
  useEffect(() => {
    if (!window.matchMedia) return
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener?.('change', update)
    return () => mql.removeEventListener?.('change', update)
  }, [query])
  return matches
}

export const MOBILE_QUERY = '(max-width: 640px)'
export const TOUCH_QUERY = '(pointer: coarse)'
