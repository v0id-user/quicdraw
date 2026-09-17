# quicdraw

A small experiment on [transport-io](https://github.com/transport-io/transport-io). One shared board where everyone sees each other's cursors and draws shapes, a public chat, and private messages.

## Run

```bash
bun install
bun run dev
```

Open http://localhost:5173 in Chrome or Firefox. Safari cannot open a WebTransport session to this server.

Everyone in one browser shares a cookie and so a name. Use a private window or a second browser to be a second person.

## How it works

- **Sign in.** The page asks `/api/challenge` for a salt and finds a nonce whose SHA-256 starts with 16 zero bits. `/api/solve` checks it, derives a name from the winning hash, and sets a signed cookie for a day. A page with a valid cookie skips the puzzle. "new name" clears the cookie and solves a fresh one without reloading, so the board stays.
- **Joining the room.** WebTransport requests carry no cookies, so `/api/session` hands the page its token and the page puts it in the WebTransport URL. The server's `authorize` checks it before accepting the session, so a peer without a valid token never gets in.
- **Board.** Pick rect or ellipse and drag to draw, with a live outline and size while you drag. The select tool moves a shape, Escape returns to it, and Delete removes what's selected. Shapes live in a Yjs array and travel as raw bytes on the reliable lane, so a move syncs while it happens. The server keeps its own copy for newcomers. Cursors go over datagrams and may drop.
- **Chat.** Each session starts with the last 50 public messages. Each user is in a room named after them, so a private message is a broadcast to that room.
- **Who is online.** The server drops a name when that user's last session closes.
- **Reconnect.** The client retries on its own and sends its copy of the board back, so a restarted server gets the shapes again. Set `QUICDRAW_SECRET` to keep people signed in across server restarts.
- **Refusal.** If the server stops accepting a token, the client stops retrying and the page offers "sign in again". That runs a fresh sign-in on the same page and sends the board back.
- **Errors.** The page shows its own sentences, chosen by error code, and logs the library's full message to the console.

| Process | Port |
|---|---|
| Vite, the page | 5173 |
| `/api` for sign-in | 8787 |
| transport-io dev, certificate hash | 4432 |
| WebTransport | 4433 |

## Deploy to Fly

```bash
brew install flyctl
fly auth login
export TF_VAR_fly_api_token="$(fly tokens create org -o personal)"
terraform -chdir=infra/fly init
terraform -chdir=infra/fly apply
fly secrets set --stage QUICDRAW_SECRET="$(openssl rand -hex 32)" PUBLIC_IPV4="$(terraform -chdir=infra/fly output -raw ipv4)"
fly deploy --ha=false
```

Then open https://quicdraw.fly.dev, which is where this is deployed. If the name `quicdraw` is taken, pass `-var app_name=<name>` to Terraform and change `app` in `fly.toml` to match.

What's different from dev:

- **UDP needs a dedicated IPv4.** Fly doesn't route UDP over shared IPv4 or IPv6, so Terraform allocates one. It costs about $2 a month on top of the machine.
- **The page dials that IPv4 directly.** The `fly.dev` name also resolves to IPv6, where UDP doesn't work.
- **The server mints its own certificate.** Fly can't terminate TLS for UDP, so on startup the server creates a 13-day self-signed certificate. It serves the hash at `/api/transport` over Fly's HTTPS, and the page pins it, as in dev.
- **The server restarts itself every 12 days** so the certificate never expires. Fly's restart policy brings it back, and the board and chat reset.
- **One machine, always on.** Rooms live in memory, so `--ha=false` and auto-stop off.
- **Terraform's state file lives only on the machine that ran it**, at `infra/fly/terraform.tfstate`, and git ignores it.

Try the production build locally:

```bash
bun run build
PUBLIC_IPV4=127.0.0.1 bun run start
```

Then open http://localhost:8080.

## Design

The palette and the IBM Plex Mono wordmark come from [transport-io's brand assets](https://github.com/transport-io/transport-io/tree/main/assets/brand): ground, panel, ink and a single accent, in light and dark. Its mark belongs to that project, so quicdraw has its own glyph and uses the transport-io mark only for the credit link.

## Layout

- `shared/contract.ts` defines every message and which lane it takes.
- `server/` holds the realtime server, the sign-in endpoints, and a small test for the puzzle and tokens.
- `client/` holds the React app.
- `notes/` holds feedback on transport-io from building this, one file per version.
- `Dockerfile`, `fly.toml` and `infra/fly/` hold the deploy.

Everything is in memory. Restarting the server clears the board and chat, and without `QUICDRAW_SECRET` it also signs everyone out.

```bash
bun test
bun run typecheck
```
