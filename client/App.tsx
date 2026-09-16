import { TransportProvider } from '@transport-io/react'
import { useEffect, useState } from 'react'
import { Client } from 'transport-io'
import { connectBrowser } from 'transport-io/browser-transport'
import { type AppMap, contract } from '../shared/contract.ts'
import { type Session, signIn } from './auth.ts'
import { Room } from './Room.tsx'

// connectDev takes no query string, so this reads the same dev manifest and adds the token.
async function connectWithToken(token: string) {
  const manifest = await (await fetch('/.well-known/transport-io-dev')).json()
  return connectBrowser({
    url: `${manifest.url}?token=${encodeURIComponent(token)}`,
    certificateHash: new Uint8Array(manifest.sha256),
    probe: false,
  })
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [tries, setTries] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // StrictMode mounts twice; the abort stops the first run before it claims a name.
    const abort = new AbortController()
    signIn(abort.signal, setTries).then(setSession, (e: Error) => {
      if (!abort.signal.aborted) setError(e.message)
    })
    return () => abort.abort()
  }, [])

  if (session === null) {
    return (
      <div className="splash">
        <h1>quicdraw</h1>
        <p>{error ?? `proving work… ${tries.toLocaleString()} hashes`}</p>
      </div>
    )
  }
  return <Connected session={session} />
}

function Connected({ session }: { session: Session }) {
  const [client] = useState(
    () =>
      new Client<AppMap>({
        contract,
        connect: () => connectWithToken(session.token),
        reconnect: { minMs: 500, maxMs: 5000 },
      }),
  )
  return (
    <TransportProvider client={client}>
      <Room me={session.name} />
    </TransportProvider>
  )
}
