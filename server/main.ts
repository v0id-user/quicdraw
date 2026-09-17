import { lookup } from 'node:dns/promises'
import { type Authorize, createServer, refuse } from 'transport-io'
import { listenDev, listenHttp3 } from 'transport-io/node-transport'
import * as Y from 'yjs'
import { type AppMap, contract, type Line } from '../shared/contract.ts'
import { startApi } from './api.ts'
import { verify } from './auth.ts'
import { CERT_DAYS, mintCertificate } from './cert.ts'

const DAY = 24 * 60 * 60 * 1000
const WT_PORT = 4433
const BOARD = 'board'
const inbox = (name: string) => `user:${name}`

const server = createServer<AppMap, { name: string }>({ contract })
const doc = new Y.Doc()
const online = new Set<string>()
const history: Line[] = []

function publishUsers() {
  void server.to(BOARD).emit('users', { names: [...online].sort() })
}

server.handle('say', async ({ body }, { peer }) => {
  const line = { from: peer.data.name, body, at: Date.now() }
  history.push(line)
  if (history.length > 50) history.shift()
  await server.to(BOARD).emit('chat', line)
  return true
})

server.handle('whisper', async ({ to, body }, { peer }) => {
  const from = peer.data.name
  if (to === from || server.memberCount(inbox(to)) === 0) return false
  const dm = { from, to, body, at: Date.now() }
  await server.to(inbox(to)).emit('dm', dm)
  await server.to(inbox(from)).emit('dm', dm)
  return true
})

server.onSession((peer) => {
  const { name } = peer.data
  
  // Sent before joining, so they arrive ahead of anything the rooms broadcast.
  peer.emit('history', history)
  peer.emit('doc', Y.encodeStateAsUpdate(doc))
  Promise.all([peer.join(BOARD), peer.join(inbox(name))]).then(
    () => {
      online.add(name)
      publishUsers()
    },
    () => {}, // The peer left before joining.
  )

  void peer.closed.then(() => {
    if (server.memberCount(inbox(name)) === 0 && online.delete(name)) publishUsers()
  })

  peer.on('move', ({ x, y }) => {
    void server.to(BOARD).except(peer.id).emit('cursor', { from: name, x, y })
  })

  peer.on('doc', (update) => {
    try {
      Y.applyUpdate(doc, update)
    } catch {
      return
    }
    void server.to(BOARD).except(peer.id).emit('doc', update)
  })
})

// Browsers send no cookies on WebTransport, so the page puts its token in the URL.
const authorize: Authorize<{ name: string }> = ({ query }) => {
  const name = verify(query.get('token') ?? '')
  return name === null ? refuse('bad-token') : { name }
}

if (process.env.NODE_ENV === 'production') {
  const ip = process.env.PUBLIC_IPV4
  if (!ip) throw new Error('PUBLIC_IPV4 is not set. It is the dedicated IPv4 that browsers dial for WebTransport.')
  const { cert, privKey, sha256 } = mintCertificate(ip)
  // Fly routes UDP only to sockets bound to fly-global-services.
  const udpHost = process.env.FLY_APP_NAME ? (await lookup('fly-global-services', 4)).address : '0.0.0.0'
  startApi({
    port: Number(process.env.PORT ?? 8080),
    host: '0.0.0.0',
    secure: true,
    staticDir: 'dist',
    transport: { url: `https://${ip}:${WT_PORT}/`, sha256 },
  })
  await server.listen(await listenHttp3({ port: WT_PORT, host: udpHost, cert, privKey, authorize }))
  // The listener can't swap certificates, so exit a day before this one expires and let Fly restart us.
  setTimeout(() => process.exit(0), (CERT_DAYS - 1) * DAY)
  console.log(`quicdraw ready. page on :${process.env.PORT ?? 8080}, webtransport on ${ip}:${WT_PORT}`)
} else {
  startApi({ port: 8787, host: '127.0.0.1', secure: false })
  await server.listen(await listenDev({ authorize }))
  console.log('quicdraw ready. api on :8787, page on http://localhost:5173')
}
