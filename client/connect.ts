import { connectBrowser } from 'transport-io/browser-transport'
import { connectDev } from 'transport-io/dev-transport'

// In dev, `transport-io dev` publishes the certificate hash. Deployed, our own server mints
// the certificate and serves the hash and the address to dial. Both run on every attempt.
export function connectWith(token: () => string) {
  if (import.meta.env.DEV) return () => connectDev({ query: () => ({ token: token() }) })
  return async () => {
    const res = await fetch('/api/transport', { cache: 'no-store' })
    const { url, sha256 } = await res.json()
    return connectBrowser({
      url: `${url}?token=${encodeURIComponent(token())}`,
      certificateHash: new Uint8Array(sha256),
      // The page's own origin answers over HTTPS, so a blocked UDP path reports as such.
      probe: `${location.origin}/api/health`,
    })
  }
}
