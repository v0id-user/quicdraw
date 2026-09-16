import { createServer, type ServerPeer } from 'transport-io'
import { listenDev } from 'transport-io/node-transport'
import * as Y from 'yjs'
import { type AppMap, contract } from '../shared/contract.ts'
import { fromBase64, toBase64 } from '../shared/encoding.ts'
import { startApi } from './api.ts'
import { verify } from './auth.ts'

const API_PORT = 8787
const BOARD = 'board'
const inbox = (name: string) => `user:${name}`

const server = createServer<AppMap>({ contract })
const doc = new Y.Doc()
const names = new WeakMap<ServerPeer<AppMap>, string>()
const online = new Set<string>()
const history: AppMap['chat']['payload'][] = []

function nameOf(peer: ServerPeer<AppMap>): string {
  const name = names.get(peer)
  if (name === undefined) throw new Error('say hello first')
  return name
}

function publishUsers() {
  void server.to(BOARD).emit('users', { names: [...online].sort() })
}

server.handle('hello', async ({ token }, { peer }) => {
  const name = verify(token)
  if (name === null) throw new Error('bad or expired token')
  names.set(peer, name)
  // Sent before joining, so they arrive ahead of any live broadcast on the same stream.
  for (const msg of history) peer.emit('chat', msg)
  peer.emit('doc', { update: toBase64(Y.encodeStateAsUpdate(doc)) })
  await peer.join(BOARD)
  await peer.join(inbox(name))
  online.add(name)
  publishUsers()
  return { name }
})

server.handle('say', async ({ body }, { peer }) => {
  const msg = { from: nameOf(peer), body, at: Date.now() }
  history.push(msg)
  if (history.length > 50) history.shift()
  await server.to(BOARD).emit('chat', msg)
  return true
})

server.handle('whisper', async ({ to, body }, { peer }) => {
  const from = nameOf(peer)
  if (to === from || server.memberCount(inbox(to)) === 0) return false
  const msg = { from, to, body, at: Date.now() }
  await server.to(inbox(to)).emit('dm', msg)
  await server.to(inbox(from)).emit('dm', msg)
  return true
})

server.onSession((peer) => {
  setTimeout(() => {
    if (!names.has(peer)) peer.close()
  }, 10_000)

  peer.on('cursor', ({ x, y }) => {
    const from = names.get(peer)
    if (from !== undefined) void server.to(BOARD).except(peer.id).emit('cursor', { from, x, y })
  })

  peer.on('doc', ({ update }) => {
    if (!names.has(peer)) return
    try {
      Y.applyUpdate(doc, fromBase64(update))
    } catch {
      return
    }
    void server.to(BOARD).except(peer.id).emit('doc', { update })
  })
})

startApi(API_PORT)
await server.listen(await listenDev())

// There is no disconnect callback, so presence is read back from room membership.
setInterval(() => {
  const before = online.size
  for (const name of online) if (server.memberCount(inbox(name)) === 0) online.delete(name)
  if (online.size !== before) publishUsers()
}, 2000)

console.log(`quicdraw ready. api on :${API_PORT}, page on http://localhost:5173`)
