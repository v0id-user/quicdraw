import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { issueChallenge, redeem, SESSION_SECONDS, sign, verify } from './auth.ts'

const COOKIE = 'quicdraw'

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export interface ApiOptions {
  port: number
  host: string
  secure: boolean
  // Deployed only: where the page dials WebTransport, and the certificate hash to pin.
  transport?: { url: string; sha256: number[] }
  staticDir?: string
}

function cookieFor(token: string, maxAge: number, secure: boolean): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

// The page is one index.html, so anything that isn't a built file gets it.
async function serveStatic(dir: string, pathname: string, res: ServerResponse) {
  const root = resolve(dir)
  const file = resolve(root, `.${pathname}`)
  const isFile = file.startsWith(root + sep) && (await stat(file).then((s) => s.isFile(), () => false))
  const target = isFile ? file : join(root, 'index.html')
  const immutable = target.startsWith(join(root, 'assets') + sep)
  res.writeHead(200, {
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(target).pipe(res)
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
export function startApi({ port, host, secure, transport, staticDir }: ApiOptions) {
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const route = `${req.method} ${pathname}`

    if (route === 'GET /api/health') return send(res, 200, { ok: true })
    if (route === 'GET /api/transport' && transport) return send(res, 200, transport)

    if (route === 'GET /api/challenge') return send(res, 200, issueChallenge())

    if (route === 'POST /api/solve') {
      const solution = await readSolution(req)
      const name = solution && redeem(solution.salt, solution.nonce)
      if (!name) return send(res, 400, { error: 'bad solution' })
      const token = sign(name)
      return send(res, 200, { name, token }, { 'set-cookie': cookieFor(token, SESSION_SECONDS, secure) })
    }

    if (route === 'GET /api/session') {
      const token = tokenFrom(req)
      const name = token && verify(token)
      if (!name) return res.writeHead(204).end()
      return send(res, 200, { name, token })
    }

    if (route === 'DELETE /api/session') {
      return send(res, 200, {}, { 'set-cookie': cookieFor('', 0, secure) })
    }

    if (staticDir && req.method === 'GET' && !pathname.startsWith('/api/')) return serveStatic(staticDir, pathname, res)
    send(res, 404, { error: 'not found' })
  })
  server.listen(port, host)
}
