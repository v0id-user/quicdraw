import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { issueChallenge, redeem, SESSION_SECONDS, sign, verify } from './auth.ts'

const COOKIE = 'quicdraw'

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function cookieFor(token: string, maxAge: number): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`
}

function tokenFrom(req: IncomingMessage): string | undefined {
  const pair = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))
  return pair?.slice(COOKIE.length + 1)
}

async function readSolution(req: IncomingMessage): Promise<{ salt: string; nonce: string } | null> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 1024) return null
  }
  try {
    const { salt, nonce } = JSON.parse(raw)
    return typeof salt === 'string' && typeof nonce === 'string' ? { salt, nonce } : null
  } catch {
    return null
  }
}

// WebTransport requests carry no cookies, so the page reads its token here
// and puts it in the WebTransport URL for `authorize`.
export function startApi(port: number) {
  const server = createServer(async (req, res) => {
    const route = `${req.method} ${req.url}`

    if (route === 'GET /api/challenge') return send(res, 200, issueChallenge())

    if (route === 'POST /api/solve') {
      const solution = await readSolution(req)
      const name = solution && redeem(solution.salt, solution.nonce)
      if (!name) return send(res, 400, { error: 'bad solution' })
      const token = sign(name)
      return send(res, 200, { name, token }, { 'set-cookie': cookieFor(token, SESSION_SECONDS) })
    }

    if (route === 'GET /api/session') {
      const token = tokenFrom(req)
      const name = token && verify(token)
      if (!name) return res.writeHead(204).end()
      return send(res, 200, { name, token })
    }

    if (route === 'DELETE /api/session') {
      return send(res, 200, {}, { 'set-cookie': cookieFor('', 0) })
    }

    send(res, 404, { error: 'not found' })
  })
  server.listen(port, '127.0.0.1')
}
