import { createHash } from 'node:crypto'
import { expect, test } from 'bun:test'
import { leadingZeroBits } from '../shared/pow.ts'
import { DIFFICULTY, issueChallenge, redeem, sign, verify } from './auth.ts'

function solve(salt: string): string {
  for (let n = 0; ; n++) {
    const hash = createHash('sha256').update(`${salt}:${n}`).digest()
    if (leadingZeroBits(hash) >= DIFFICULTY) return String(n)
  }
}

test('a solved challenge earns a name once', () => {
  const { salt } = issueChallenge()
  const nonce = solve(salt)
  expect(redeem(salt, nonce)).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/)
  expect(redeem(salt, nonce)).toBeNull()
})

test('a wrong nonce or unknown salt earns nothing', () => {
  const { salt } = issueChallenge()
  expect(redeem(salt, 'nope')).toBeNull()
  expect(redeem('not-issued', '0')).toBeNull()
})

test('tokens verify until tampered or expired', () => {
  const token = sign('calm-otter-00ff', 0)
  expect(verify(token, 1)).toBe('calm-otter-00ff')
  expect(verify(token.replace('calm', 'odd'), 1)).toBeNull()
  expect(verify(token, Date.now() + 10 ** 12)).toBeNull()
})
