import { leadingZeroBits } from '../shared/pow.ts'

export interface Session {
  name: string
  token: string
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url} answered ${res.status}`)
  return res.json()
}

// Reuses the cookie when it is still good, otherwise solves a fresh challenge.
export async function signIn(signal: AbortSignal, onProgress: (tries: number) => void): Promise<Session> {
  const existing = await fetch('/api/session', { signal })
  if (existing.status === 200) return existing.json()

  const { salt, difficulty } = await json<{ salt: string; difficulty: number }>(
    await fetch('/api/challenge', { signal }),
  )
  const encoder = new TextEncoder()
  for (let nonce = 0; ; nonce++) {
    signal.throwIfAborted()
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${nonce}`))
    if (leadingZeroBits(new Uint8Array(hash)) >= difficulty) {
      const res = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ salt, nonce: String(nonce) }),
        signal,
      })
      return json<Session>(res)
    }
    if (nonce % 1000 === 0) onProgress(nonce)
  }
}

export async function signOut() {
  await fetch('/api/session', { method: 'DELETE' })
}
