import { createHooks } from '@transport-io/react'
import type { AppMap } from '../shared/contract.ts'

export const api = createHooks<AppMap>({ fallback: false })

export function colorOf(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  // Saturation and lightness come from the theme, so every name sits in the same register.
  return `hsl(${hash % 360} var(--user-saturation) var(--user-lightness))`
}
