import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { leadingZeroBits } from '../shared/encoding.ts'

export const DIFFICULTY = 16
export const SESSION_SECONDS = 24 * 60 * 60
const CHALLENGE_MS = 60_000
const SECRET = process.env.QUICDRAW_SECRET ?? randomBytes(32).toString('hex')

const ADJECTIVES = ['brisk', 'calm', 'dusty', 'eager', 'fuzzy', 'giddy', 'hazy', 'jolly',
  'lucky', 'mellow', 'nimble', 'odd', 'plucky', 'quiet', 'rusty', 'sunny']
const ANIMALS = ['otter', 'heron', 'lynx', 'moth', 'newt', 'owl', 'panda', 'quail',
  'raven', 'seal', 'tapir', 'urchin', 'vole', 'wasp', 'yak', 'zebra']

// salt -> expiry. A challenge is deleted once solved, so a solution cannot be replayed.
const open = new Map<string, number>()

export function issueChallenge(now = Date.now()) {
  for (const [salt, expires] of open) if (expires < now) open.delete(salt)
  const salt = randomBytes(16).toString('hex')
  open.set(salt, now + CHALLENGE_MS)
  return { salt, difficulty: DIFFICULTY }
}

// The name comes from the winning hash, so nobody picks their own.
export function redeem(salt: string, nonce: string, now = Date.now()): string | null {
  const expires = open.get(salt)
  if (expires === undefined || expires < now || nonce.length > 32) return null
  const hash = createHash('sha256').update(`${salt}:${nonce}`).digest()
  if (leadingZeroBits(hash) < DIFFICULTY) return null
  open.delete(salt)
  const adjective = ADJECTIVES[hash.readUInt8(4) % ADJECTIVES.length]
  const animal = ANIMALS[hash.readUInt8(5) % ANIMALS.length]
  return `${adjective}-${animal}-${hash.subarray(6, 8).toString('hex')}`
}

function mac(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('base64url')
}

export function sign(name: string, now = Date.now()): string {
  const data = `${name}.${now + SESSION_SECONDS * 1000}`
  return `${data}.${mac(data)}`
}

export function verify(token: string, now = Date.now()): string | null {
  const [name, expires, sig] = token.split('.')
  if (name === undefined || expires === undefined || sig === undefined) return null
  const want = Buffer.from(mac(`${name}.${expires}`))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return Number(expires) > now ? name : null
}
