# Deploying quicdraw to Fly, as it happened

A record of 2026-09-17, not a guide. quicdraw is the transport-io app in this repo: a Node
server holding a WebTransport listener plus an HTTP server, and a Vite React page.

Two things in the brief do not exist here, and I have not invented them:

- **There is no Next app.** The page is a Vite build that the same Fly machine serves from
  `/app/dist`. A Next.js server does appear in this story, but only as an unrelated local
  project of yours holding port 3000 on the Mac.
- **There is no CheckOrigin and no Vercel domain.** CheckOrigin is a WebSocket idea;
  transport-io has no equivalent and checks no origin. SECURITY.md in that repo says plainly
  that the library authenticates nothing. The only gate is the `authorize` hook quicdraw
  passes to its listener. Nothing about this deploy touches Vercel.

## 1. Account and app setup, in order

1. `which fly flyctl` found neither. Terraform 1.15.3 and Docker 29.8.0 were already there.
2. You ran `brew install flyctl`. It installed 0.4.104 and warned that the `hashicorp/tap`
   tap is untrusted, which affects Terraform upgrades and nothing here.
3. `fly auth whoami` answered `Error: no access token available. Please login with 'flyctl
   auth login'`. I could not do this step: it opens a browser and is your login.
4. You ran `fly auth login` and it returned `successfully logged in as github@v0id.me`.
5. `fly orgs list` gave one org, `#V0ID`, slug `personal`. That slug is what Terraform wants.
   Almost every `fly` command also printed `Warning: Metrics token unavailable: Get
   "https://api.fly.io/api/v1/organizations/personal": context canceled`. It never meant
   anything.
6. Name: I picked `quicdraw` and checked it only by `dig +short A quicdraw.fly.dev` and a
   curl, both empty. That is not an availability check, since an app with no IPs also fails
   to resolve. It happened to be free.
7. Region: `fra`. Nearest Fly region to UTC+3. Nothing measured it.
8. Terraform, matching the pattern in your hela repo: provider `fly-apps/fly` pinned
   `~> 0.0.23`, whose last release was June 2023. It still creates apps and IPs.
9. The provider needs a token. `fly auth token` prints `The 'fly auth token' command is
   deprecated. Use 'fly tokens create' instead.` and hands back a `fm2_` macaroon, 689
   characters. The provider's code does `SetCommonHeader("Authorization", "Bearer "+token)`
   with no special case for macaroons, so before trusting it I posted a `{ viewer { email } }`
   query to `api.fly.io/graphql` twice, once as `Bearer fm2_…` and once as
   `Bearer FlyV1 fm2_…`. Both returned the email. The plain Bearer form works.
10. `terraform init`, then `plan`: 3 to add, 0 to change, 0 to destroy. `apply` created the
    app and both addresses in about a second.
11. `fly secrets set --stage QUICDRAW_SECRET=$(openssl rand -hex 32) PUBLIC_IPV4=…`. The
    `--stage` matters: without it the command restarts machines, and at that point there
    were none.
12. `fly deploy --ha=false`. Fly built with Depot, pushed an 82 MB image, and created one
    machine, `d892175f705048`, in `fra`.
13. You then ran the same commands yourself, concurrently. Your `terraform apply` correctly
    reported no changes. Your `fly secrets set` replaced `QUICDRAW_SECRET` with a different
    random value and your `fly deploy` produced version 2, which is why the logs show a
    SIGINT and a restart 20 seconds after the first boot. Nobody had signed in, so the only
    cost was a restart.

## 2. fly.toml, every field

```toml
app = 'quicdraw'
primary_region = 'fra'

[env]
  PORT = '8080'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = false
  min_machines_running = 1

  [[http_service.checks]]
    method = 'GET'
    path = '/api/health'
    interval = '30s'
    timeout = '5s'
    grace_period = '20s'

[[services]]
  internal_port = 4433
  protocol = 'udp'

  [[services.ports]]
    port = 4433

[[restart]]
  policy = 'always'

[[vm]]
  size = 'shared-cpu-1x'
  memory = '256mb'
```

- `app`, `primary_region`: as above.
- `PORT = '8080'`: the server reads it; the same number appears in `internal_port` because
  nothing rewrites it.
- `http_service` is the page, the sign-in API and the certificate-hash endpoint. Fly's proxy
  terminates TLS here with its own `*.fly.dev` certificate. This is the part of the app that
  gets a real certificate for free, and it is also how the browser reaches the hash it needs
  to trust the UDP side.
- `force_https = true`: WebTransport needs a secure context, and the sign-in cookie is
  `Secure` in production.
- `auto_stop_machines = 'off'`, `auto_start_machines = false`, `min_machines_running = 1`:
  the board, the chat history, the rooms and the presence set live in memory. A machine that
  stops loses the room. Auto-start is also useless here, because Fly's proxy starts machines
  on TCP traffic and a WebTransport client arrives over UDP.
- The checks block: see section 6.
- `[[services]]` with `protocol = 'udp'` is the WebTransport listener. **`internal_port` and
  the external `port` are both 4433 because Fly rewrites the address of a UDP packet and
  never the port.** The usual habit of listening on 8080 internally and exposing 443 does not
  work for UDP.
- The bind address is not in this file, it is in the server: Fly delivers UDP to a socket
  bound to the name `fly-global-services`, not to `0.0.0.0`. `server/main.ts` resolves that
  name with `dns.lookup(…, 4)` when `FLY_APP_NAME` is set, and passes the address to
  `listenHttp3`. A wildcard bind gets packets but answers from the wrong source address, and
  the client never sees a reply.
- `[[restart]] policy = 'always'` exists for the certificate, section 4. The default is
  `on-failure`, under which a clean `exit(0)` means the machine stays stopped.
- `[[vm]]`: the smallest shared machine. Measured in flight: 111 MB of 212 MB free, load
  0.09, disk 1% of 7.8 GB.

## 3. The dedicated IPv4

`fly ips list -a quicdraw` labels it itself:

```
v4 │ 137.66.44.231           │ public ingress (dedicated, $2/mo)
v6 │ 2a09:8280:1::191:baff:0 │ public ingress (dedicated)
```

Terraform allocated both, `fly_ip` with `type = "v4"` and `type = "v6"`. Without the
dedicated v4 there is no UDP at all: Fly does not route UDP over a shared IPv4, and does not
route it over IPv6 in any form. The v6 is free and only serves the page over TCP.

The consequence that costs more than the $2: because UDP is v4-only and `quicdraw.fly.dev`
has an AAAA record, the page cannot dial the hostname for WebTransport. It dials
`https://137.66.44.231:4433/`. That address is baked into the `PUBLIC_IPV4` secret and
returned to the browser by `/api/transport`.

## 4. The certificate

Fly issued nothing for the UDP port. Fly's certificate covers TCP 443 through its proxy, and
that is the page only.

The server mints its own at startup, in `server/cert.ts`, shelling out to openssl because
Node cannot issue an X.509 certificate:

- ECDSA P-256, `-days 13`. The browser rule for a pinned certificate is at most 14 days.
- The SHA-256 is taken over the DER, via `new X509Certificate(pem).raw`, not over the PEM
  file.
- `/api/transport` serves `{ url, sha256 }` over Fly's HTTPS, and the page passes those 32
  bytes to `connectBrowser` as `certificateHash`. Same mechanism `transport-io dev` uses
  locally, in production.

Renewal: there is none in the running sense. transport-io's listener cannot swap a
certificate, which its own certificates guide states, so **the server does not see a renewed
file without a restart**. What quicdraw does instead is exit deliberately after 12 days,
`setTimeout(() => process.exit(0), (CERT_DAYS - 1) * DAY)`, and Fly's `restart.policy =
'always'` starts it again, which mints a fresh certificate and publishes a new hash. The
board and the chat reset at that moment. A page that is open reconnects on its own and
fetches the new hash, because the connect function runs on every attempt.

The other path, a real CA certificate, would need an ACME client inside the app, a volume to
keep the certificate across restarts, and a v4-only hostname to dial. I did not build it.

## 5. Dockerfile, base image, glibc

Multi-stage, all Debian trixie:

- `node:22-trixie-slim` as the base, with the bun binary copied in from `oven/bun:1.3`.
- `build` stage: `bun install --frozen-lockfile`, `bun run build` for the Vite output.
- `deps` stage: `bun install --frozen-lockfile --production`.
- Runtime: `apt-get install openssl`, copy `node_modules`, `dist`, `server`, `shared`, and
  `CMD ["node", "server/main.ts"]`. Node 22 strips the TypeScript itself, so there is no
  build step for the server.

glibc 2.38 did not bite, because transport-io's README names it and I started on trixie. It
would have: `@fails-components/webtransport-transport-http3-quiche` ships a prebuild that
needs 2.38, and every `node:22-*-slim` default is bookworm at 2.36. Verified inside the
image: `ldd (Debian GLIBC 2.41-12+deb13u3)`, and `webtransport.node` present in
`build/Release`. The one related snag was earlier in the project, not at deploy: bun blocks
install scripts by default and printed `Blocked 1 postinstall`, so the native binary was
missing until `trustedDependencies` listed that package.

Image: 82 MB. The build was cached on the second deploy and took about 9 seconds.

## 6. Health checks

Fly checks `GET /api/health` over HTTP against TCP 8080, every 30s, 5s timeout. It reports
`{"ok":true}`.

A UDP-only process cannot satisfy this. Fly's service checks are TCP and HTTP; there is no
UDP check. quicdraw passes only because the same process also runs the HTTP server. An app
that were purely WebTransport would need to open a TCP port for the sole purpose of being
checked, or run without checks.

Every boot logs one failure before the server is listening:

```
Health check 'servicecheck-00-http-8080' on port 8080 has failed.
quicdraw ready. page on :8080, webtransport on 137.66.44.231:4433
Health check 'servicecheck-00-http-8080' on port 8080 is now passing.
```

Three seconds apart. I raised `grace_period` from 10s to 20s to stop that line appearing on
every restart.

## 7. Scaling

One machine. `fly deploy --ha=false`, because Fly's default for a fresh app is two.

With more than one: rooms, the online set, the chat history and the server's copy of the Yjs
document are per-process, and transport-io ships only an in-memory adapter, no Redis one. Two
machines would be two disjoint boards, and which one you got would depend on which machine
Fly's UDP routing picked. Sign-in would survive, since the token is an HMAC and any machine
can verify it, but everything stateful would split. Nothing in the app detects this.

## 8. Where the page lives, and how the token crosses

Same machine, same image. `server/api.ts` serves `/app/dist` for anything that is not
`/api/*`, with `index.html` as the fallback.

1. The page asks `/api/challenge`, solves a 16-bit proof of work, posts to `/api/solve`.
2. `/api/solve` derives a name from the winning hash, signs `name.expiry.hmac`, and sets it
   as an HttpOnly, SameSite=Strict, Secure cookie.
3. WebTransport sends no cookies, so `/api/session` reads the cookie and hands the same token
   back to the page as JSON.
4. The page fetches `/api/transport`, which returns `https://137.66.44.231:4433/` and the
   certificate hash, and dials that URL with `?token=…` appended.
5. The server's `authorize` reads `query.get('token')`, verifies the HMAC, and returns
   `{ name }`, which becomes `peer.data`. A bad token is `refuse('bad-token')`, and the peer
   never receives the event table.

So the hostname the browser learns is not a hostname. It is the dedicated IPv4, learned at
runtime from an endpoint on the page's own origin.

## 9. Failures, in order

1. **`flyctl` not installed.** `which fly flyctl` found nothing, `fly auth whoami` was
   `command not found`. Fixed by `brew install flyctl`.
2. **Not logged in.** `Error: no access token available. Please login with 'flyctl auth
   login'`. Only you could fix it. I stopped and handed you the command.
3. **Deprecated token command.** `fly auth token` warns it is deprecated. It still prints a
   usable token. The uncertainty was whether a 2023 provider sending `Bearer <macaroon>`
   would be accepted; two curl calls proved it is. The README now says `fly tokens create
   org` instead.
4. **Port 3000, twice.** Earlier in the project, `transport-io dev` bound `127.0.0.1:3000`
   while your Next.js dev server held `[::]:3000`. No error, because the binds do not
   conflict, and the CLI printed `http://localhost:3000`, which a browser may resolve to
   `::1` and hit the other server. Moved the CLI to 4432. The library later shipped a fix
   that refuses a held port, including one held only on `::1`.
5. **`WT_PORT_IN_USE` locally.** Running the production build on the Mac failed because the
   dev stack still held UDP 4433. The error named the port. Stopped dev, reran.
6. **HEAD returned 404.** Found during the health pass: `curl -I https://quicdraw.fly.dev/`
   gave 404 with a JSON body, because the static handler only matched `GET`. Browsers never
   send HEAD for the page, but transport-io's own reachability probe does. Fixed by treating
   HEAD as GET and ending the response without a body.
7. **A health check failure on every boot.** Cosmetic, from a 10s grace period against a
   3s startup. Raised to 20s.
8. **One proxy error in the logs**, `[PU01] client problem: no host specified in headers or
   uri`, request url `/`, from `ams`. That is a scanner connecting to the bare IPv4 with no
   SNI or Host header. Nothing to fix. It is what a public dedicated IPv4 attracts.
9. **A gitignore typo**, `.terraform.lock.hcl.bak`, which would have ignored nothing useful.
   Removed; the real lock file is committed.

Nothing failed in the Docker build, the Terraform apply, or the first deploy.

## 10. Costs

| Item | Rate |
|---|---|
| Dedicated IPv4 | $2.00 / month, and Fly labels it in `fly ips list` |
| shared-cpu-1x, 256 MB, running 24/7 | about $1.94 / month at Fly's published rate |
| Dedicated IPv6 | free |
| Outbound bandwidth | $0.02 / GB published for Europe, past the free allowance. This app's traffic rounds to nothing |
| Depot builds | included |

About $4 a month. `fly apps destroy quicdraw` ends both lines.

## 11. What is not obvious from Fly's documentation

- Fly's UDP page says you need a dedicated IPv4. What it does not say is what that does to
  your client: your `fly.dev` name still has an AAAA record, so a QUIC client that resolves
  the name can land on IPv6 where nothing answers. Dialling the literal IPv4 is the fix, and
  a literal IPv4 is exactly what a CA certificate cannot cover, which is how you end up
  pinning a self-signed certificate in production.
- Because you pin, the browser has to fetch the hash at connect time, so the UDP app also
  needs an HTTPS origin. On Fly that is the same app with an `http_service`. The two halves
  are not optional independently.
- `fly deploy` creates two machines by default. For anything holding state in memory that is
  a silent split, not an error.
- A clean `exit(0)` does not restart a machine under the default `on-failure` policy. If you
  plan to exit deliberately, say `policy = 'always'`, and remember it also restarts after a
  crash loop.
- The UDP port is never rewritten, so your internal port is your public port, and the port
  you pick is the port your users' firewalls see.
- There is no UDP health check. Your UDP process is only as observable as the TCP listener
  you attach to it.
- `node:*-slim` is bookworm, glibc 2.36. Anything shipping a prebuild for 2.38 needs trixie
  or Ubuntu 24.04, and the failure arrives at runtime as a load error, not at build time.
- The slim image has no `ps`, no `free`, no `uptime`. `fly ssh console -C 'cat /proc/meminfo'`
  works and is how I read memory.
- The 2023 Terraform provider still creates apps and IPs against today's API, and takes a
  modern macaroon as a plain Bearer token. Its state file is local: `infra/fly/terraform.tfstate`
  on one Mac, git-ignored, and losing it means importing the app back by hand.
