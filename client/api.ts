import { createHooks } from '@transport-io/react'
import type { AppMap } from '../shared/contract.ts'

export const api = createHooks<AppMap>()

export function colorOf(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 70% 50%)`
}
