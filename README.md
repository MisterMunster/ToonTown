# Toon Town

A tiny, cheerful 3D town that runs in your browser. You play **Pip**, a cartoon
hero who can stroll, sprint and double-jump around a toy-like town. There are
houses, shops, a fountain square and a park, townsfolk who wave hello, and
shiny coins to find (some hidden on top of crates and platforms). The sun sets,
the street lamps switch on, and the town glows under the moon.

Built with **Babylon.js 9**. Everything you see and hear is generated in code,
with no downloaded models, textures or sound files. It aims for a smooth 60 fps
on a laptop and also works on phones.

---

## Controls

| | Keyboard / mouse | Gamepad | Touch |
|---|---|---|---|
| Move | Arrow keys or WASD | Left stick / D-pad | On-screen D-pad |
| Run | Shift (hold) | B or right trigger | Run toggle |
| Jump (press again in the air to double-jump) | Space | A | Jump button |
| Camera | Drag the mouse, wheel to zoom, C to reset | Right stick | Drag, pinch to zoom |
| Hotbar | 1-8, Q / E, F or click to use | LB / RB, X to use | Tap a slot |
| Pause | Esc or P | Start | Pause button |
| Extras | N time of day, M mute, H help | | |

The hotbar items are just for show for now ("coming soon!").

---

## Quick start (development)

You need **Node.js 20 or newer**.

```bash
npm install
npm run dev          # http://localhost:5173  (hot reload)
```

To try the production build with the real password page on your own machine:

```bash
npm run preview      # vite build + precompress, then the server on http://localhost:8080
```

If `GAME_PASSWORD` isn't set, the server makes up a random development password
and prints it in the terminal.

---

## Run it in Docker (locally)

```bash
cp .env.example .env         # then open .env and set GAME_PASSWORD
docker compose up --build    # http://localhost:8080
```

Add `-d` to run it in the background. `docker compose logs -f` shows the logs and
`docker compose down` stops it.

`.env` holds the settings (see [Configuration](#configuration)):

```ini
GAME_PASSWORD=purple-otter-bakes-pies
SESSION_SECRET=paste-the-output-of-openssl-rand-hex-32-here
```

The container runs with a read-only filesystem as an unprivileged user, with
all Linux capabilities dropped and a 256 MB memory limit. It also has a health
check (`/healthz`).

---

## Put it on your own server

You need a Linux server with **Docker** and the **Compose plugin** installed
(`docker compose version`), plus a domain name pointing at it, e.g.
`toontown.example.com` (an A/AAAA DNS record).

### Option A: copy the project and build on the server (simplest)

```bash
# from your computer (skip node_modules/dist, they're rebuilt on the server)
rsync -av --exclude node_modules --exclude dist --exclude .git ./ me@my-server:~/toon-town/

# on the server
cd ~/toon-town
cp .env.example .env && nano .env      # set GAME_PASSWORD, SESSION_SECRET and PUBLISH=127.0.0.1:8080
docker compose up -d --build
```

### Option B: build here, ship only the image

Build the image locally and send it over SSH, so the server never needs the
source code.

```bash
# Apple Silicon Macs build arm64 by default; most servers are amd64:
docker build --platform linux/amd64 -t toon-town:latest .
docker save toon-town:latest | gzip | ssh me@my-server 'gunzip | docker load'

scp docker-compose.yml .env.example me@my-server:~/toon-town/
ssh me@my-server
cd ~/toon-town && cp .env.example .env && nano .env
docker compose up -d --no-build
```

To update later, repeat the build/save/load step and run
`docker compose up -d --no-build` again.

### Option C: HTTPS included, one command per update (`deploy/`)

`deploy/compose.prod.yml` adds a hardened Caddy container that fetches and renews
the Let's Encrypt certificate itself, so the server only needs Docker. Once, on
the server:

```bash
mkdir -p /opt/toon-town && nano /opt/toon-town/.env
# GAME_PASSWORD='...'  SESSION_SECRET=...  SITE_DOMAIN=game.example.com  PUBLISH=127.0.0.1:8080
```

Then, from your computer, for the first deploy and every update (set
`DEPLOY_HOST`, `SSH_KEY` or `DEPLOY_DIR` if yours differ from the defaults at the
top of the script):

```bash
deploy/deploy.sh
```

It checks the server's `.env` (without copying or printing it, and refuses to
deploy if `PUBLISH` isn't loopback-only), uploads only the code, builds and
starts both containers, and finishes by fetching `https://<SITE_DOMAIN>/healthz`.
Ports 80 and 443 (TCP, plus UDP 443 for HTTP/3) must be open.

> **Tip:** with a reverse proxy in front (next section), set
> `PUBLISH=127.0.0.1:8080` in `.env`. The game is then reachable **only** through
> HTTPS, and the plain-HTTP port 8080 is closed to the internet. (Ports published
> by Docker bypass `ufw`, so a firewall rule alone does not close it.)

---

## HTTPS with a reverse proxy

The Node server speaks plain HTTP on port 8080. Put a reverse proxy in front of it
for HTTPS. The server already trusts proxies on localhost and private networks
(`TRUST_PROXY`), so it sees your friends' real IP addresses, marks the login
cookie `Secure` and sends HSTS.

### Caddy (recommended: automatic Let's Encrypt certificates)

Install Caddy ([caddyserver.com/docs/install](https://caddyserver.com/docs/install)),
then put this in `/etc/caddy/Caddyfile`:

```caddy
toontown.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

That's it. Caddy gets and renews the certificate, redirects HTTP to HTTPS and
forwards the right headers. Ports 80 and 443 must be open in your firewall.

### Nginx

Using a certificate from certbot (`sudo certbot certonly --nginx -d toontown.example.com`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name toontown.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name toontown.example.com;

    ssl_certificate     /etc/letsencrypt/live/toontown.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/toontown.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Share it with a friend

1. Send them the link: `https://toontown.example.com`
2. Send them the password **separately** (a different app, or tell them in person).
3. They see the "This town is invite-only" page, type the password, and they're
   in. The login lasts 30 days (`SESSION_DAYS`) on that browser.

After 10 wrong passwords in 15 minutes from the same address, the page asks
them to take a breather for a while.

### Change the password (or sign everyone out)

```bash
nano .env                 # new GAME_PASSWORD (in 'single quotes' if it contains $ or #)
docker compose up -d      # recreates the container with the new settings
```

With the `deploy/` setup, run
`docker compose -f docker-compose.yml -f deploy/compose.prod.yml up -d` instead.

Changing the password signs **everyone** out, because login cookies are tied to
the password. Changing `SESSION_SECRET` does the same.

---

## Configuration

All settings are environment variables (`.env` when using Docker Compose):

| Variable | Default | What it does |
|---|---|---|
| `GAME_PASSWORD` | *(required)* | The shared password. In production (`NODE_ENV=production`, as in Docker) the server **refuses to start** without it. In development a random one is printed. |
| `SESSION_SECRET` | random per start | Signs the login cookies. **Set it** (`openssl rand -hex 32`), or everyone has to log in again after each restart or redeploy. |
| `SESSION_DAYS` | `30` | How long a login stays valid. |
| `PUBLISH` | `8080` | *(Compose only)* Where the app is published on the host. Use `127.0.0.1:8080` behind a reverse proxy. |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Which proxies may set `X-Forwarded-*` headers ([Express "trust proxy"](https://expressjs.com/en/guide/behind-proxies.html)). `false` = none, a number = that many hops. |
| `PORT` | `8080` | Port the Node server listens on (leave as is in Docker). |
| `DIST_DIR` | `dist/` | Folder with the built game. |

### What the server does for security

- Password check in constant time (SHA-256 + `timingSafeEqual`), with a rate
  limit of 10 failures per 15 minutes per IP (per /64 for IPv6).
- Stateless, HMAC-signed session cookie: `HttpOnly`, `SameSite=Lax`, `Secure`
  over HTTPS. No passwords or cookies are ever logged.
- Logins are only accepted from the login page itself (`Origin` /
  `Sec-Fetch-Site` check), so another website can't make its visitors'
  browsers guess passwords for it.
- Everything except the login page, `/healthz`, `/robots.txt` and
  `/favicon.svg` requires a login. Redirects after login only go to paths on
  your own site.
- Strict Content-Security-Policy (no third-party scripts, fonts or frames),
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  HSTS over HTTPS, and `noindex` so search engines stay out.
- Precompressed Brotli/gzip files with long-lived (browser-only, `private`)
  caching for the hashed `/assets/*`. Path traversal, dotfiles and symlinks
  leading out of `dist/` are blocked.
- Small request bodies only, and tight header/request timeouts against
  slow-drip (slowloris) clients. With `deploy/`, Caddy also caps request
  bodies at 64 KB and hides its `Server`/`Via` banners.
- `node tools/server-test.mjs` checks all of the above (and more).

Use a long passphrase (four random words is great). The password is the only
lock on the door.

---

## Project structure

```
index.html                 page shell: canvas + HUD/touch roots
src/
  main.js                  bootstrap, loading screen, game loop
  game/                    one module per system (see ARCHITECTURE.md)
    environment.js         sky, sun/moon, day-night cycle, shadows, post-processing
    town.js                streets, houses, shops, park, props, colliders
    character.js           procedural cartoon people (hero + townsfolk)
    input.js               keyboard, gamepad and touch controls
    player.js              character controller: walk, run, double-jump
    camera.js              third-person follow camera + title-screen orbit
    npcs.js                townsfolk, birds and butterflies
    collectibles.js        spinning coins
    fx.js                  dust, sparkles, confetti
    audio.js               WebAudio-synthesised sound effects and music
    palette.js materials.js colliders.js events.js    shared helpers
  ui/                      HUD (hotbar, minimap, menus, toasts) + CSS
public/favicon.svg
server/
  server.js                Express: login, sessions, security headers, static files
  login.html               the "invite-only" page (self-contained)
tools/
  precompress.mjs          writes .br/.gz files after `vite build`
  smoke-run.mjs            headless smoke test (Babylon NullEngine)
  shot.sh                  headless-Chrome screenshot of any page
  preview/                 per-module visual test pages
Dockerfile                 two-stage build -> small non-root runtime image
docker-compose.yml         hardened service definition
.env.example               every setting, documented
ARCHITECTURE.md            module contracts, events, key map, perf budget
```

## Under the hood

- **Babylon.js 9** (`@babylonjs/core` + `@babylonjs/materials`): WebGL2
  rendering, shadow maps, post-processing (bloom and vignette that deepen at
  night so lamps, windows and string lights glow, MSAA/FXAA; SSAO is available
  as an opt-in), thin instances.
- **Procedural everything:** meshes from `MeshBuilder`/`VertexData`, textures
  and shop signs drawn into `DynamicTexture`s, characters animated in code, and
  sounds and music synthesised with WebAudio. The only bundled asset is the
  Fredoka font (via `@fontsource`). There are no network requests at runtime.
- **Vite 8** bundles the client into `dist/`. `tools/precompress.mjs` then adds
  Brotli (quality 11) and gzip (level 9) copies.
- **Express 5** serves `dist/` behind the password page (`server/server.js`).
  Its only runtime dependency is Express.
- **Quality levels** (`low`/`medium`/`high`) scale resolution, shadows and
  effects. Phones and tablets start on `low`.

## Debug URL parameters

| Parameter | Effect |
|---|---|
| `?quality=low` \| `medium` \| `high` | Force a quality level |
| `?autostart=1` | Skip the title screen (the camera starts right behind Pip) |
| `?time=21` | Start at a given hour (e.g. `21.5` = 9:30 pm) |
| `?touch=1` \| `0` | Force the on-screen touch controls on / off |
| `?demo=1` | Autopilot: Pip walks around the fountain, jumping and double-jumping |
| `?ff=2.5` | Fast-forward: simulate that many seconds right after start (for screenshots) |

Combine them: `http://localhost:5173/?autostart=1&time=19&quality=high`

Headless Chrome (`tools/shot.sh`) only renders about one gameplay frame, however
long the virtual-time budget, so use `ff` to capture a moment of play, e.g.
`tools/shot.sh "/?autostart=1&demo=1&ff=2.45" /tmp/flip.png 60000` (mid double-jump
somersault). For a true phone layout (headless windows can't be narrower than
~500 px) frame the game in `tools/preview/controls-phone.html?src=/&autostart=1&quality=low`
with a 500x900 window.

## Testing tools

```bash
npm run smoke                              # headless build + ~10 s of simulated play; must print SMOKE OK
npm run smoke -- --only town,player        # test specific modules, stub the rest
npx vite build                             # bundling / import check
tools/shot.sh "/?autostart=1&time=21" /tmp/night.png 60000   # WebGL screenshot (needs `npm run dev`)
```

Software WebGL compiles shaders slowly while headless virtual time keeps
running, so give the game page a generous budget (60-90 s) and run captures one
at a time; a shot that still shows the loading bar just needs a bigger budget.

`tools/shot.sh <path-or-url> <out.png> [virtual_ms] [WxH]` drives headless
Chrome with software WebGL and prints the page's console output, which is handy
for catching errors. It also accepts a full URL, e.g.
`tools/shot.sh http://localhost:8080/login /tmp/login.png`.

## Troubleshooting

- **"GAME_PASSWORD is not set"**: create `.env` from `.env.example` and fill it in.
- **Everyone got logged out after a restart**: set `SESSION_SECRET` in `.env`.
- **Login works over HTTP but not HTTPS (or the other way round)**: make sure
  the proxy sends `X-Forwarded-Proto` (Caddy does this automatically) and runs
  on the same machine or a private network (see `TRUST_PROXY`).
- **Black screen / "The town didn't load"**: the browser needs WebGL. Enable
  hardware acceleration, or try `?quality=low`.
- **"exec format error" on the server**: the image was built for the wrong CPU
  type. Rebuild with `--platform linux/amd64` (or `linux/arm64`).
