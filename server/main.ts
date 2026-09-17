import { createServer, refuse } from 'transport-io'
import { listenDev } from 'transport-io/node-transport'
import * as Y from 'yjs'
import { type AppMap, contract, type Line } from '../shared/contract.ts'
import { startApi } from './api.ts'
import { verify } from './auth.ts'

const API_PORT = 8787
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

startApi(API_PORT)

const listener = await listenDev({
  // Browsers send no cookies on WebTransport, so the page puts its token in the URL.
  authorize: ({ query }) => {
    const name = verify(query.get('token') ?? '')
    return name === null ? refuse('bad-token') : { name }
  },
})
await server.listen(listener)

console.log(`quicdraw ready. api on :${API_PORT}, page on http://localhost:5173`)
