#!/usr/bin/env bash
# Ship Toon Town to the production VPS and (re)start it behind Caddy/HTTPS.
#
#   deploy/deploy.sh
#
# Overridable: DEPLOY_HOST (default root@31.220.20.232), SSH_KEY (default
# ~/.ssh/claude_code), DEPLOY_DIR (default /opt/toon-town).
#
# The server keeps its own $DEPLOY_DIR/.env (password, secrets, domain). This
# script never sends, prints or overwrites it; it only checks that the required
# settings are there. The image is built on the server. Safe to re-run: every
# run uploads the current code and converges the containers. Any failure stops
# the script with a non-zero exit code.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@31.220.20.232}"
KEY="${SSH_KEY:-$HOME/.ssh/claude_code}"
DIR="${DEPLOY_DIR:-/opt/toon-town}"

die() {
  echo "deploy: ERROR: $*" >&2
  exit 1
}

# HOST and DIR end up inside remote shell commands: only allow plain values.
[[ "$DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$DIR" != *..* ]] || die "DEPLOY_DIR must be a plain absolute path (got '$DIR')"
[[ "$HOST" =~ ^[A-Za-z0-9._@:-]+$ && "$HOST" != -* ]] || die "DEPLOY_HOST looks wrong (got '$HOST')"
[[ -r "$KEY" ]] || die "SSH key not found: $KEY (set SSH_KEY)"

SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20)
COMPOSE="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"

cd "$(dirname "$0")/.."

# Same allowlist as .dockerignore, plus the compose/deploy files.
FILES=(package.json package-lock.json index.html vite.config.js Dockerfile
       docker-compose.yml .dockerignore public src server tools/precompress.mjs deploy)
for f in "${FILES[@]}"; do [[ -e "$f" ]] || die "missing $f - run this from a complete checkout"; done

echo "==> Checking $HOST:$DIR/.env"
# The check runs remotely and only reports which settings are missing.
"${SSH[@]}" "$HOST" "cd '$DIR' && bash -s" <<'REMOTE' || die "the server is not ready (see above); nothing was changed"
set -u
fail=0
has() { grep -Eq "^[[:space:]]*$1[[:space:]]*=[[:space:]]*[^[:space:]]" .env; }
if [ ! -f .env ]; then
  echo "  $PWD/.env is missing: copy .env.example there and fill it in" >&2
  exit 1
fi
has GAME_PASSWORD || { echo "  .env: GAME_PASSWORD is empty" >&2; fail=1; }
has SITE_DOMAIN || { echo "  .env: SITE_DOMAIN is empty (e.g. SITE_DOMAIN=game.example.com)" >&2; fail=1; }
# Docker-published ports bypass the host firewall: the plain-HTTP app port
# must stay on loopback (Caddy reaches the app over the compose network).
grep -Eq "^[[:space:]]*PUBLISH[[:space:]]*=[[:space:]]*[\"']?(127\.0\.0\.1|\[::1\]):[0-9]+[\"']?[[:space:]]*$" .env || {
  echo "  .env: PUBLISH must be a loopback address, e.g. PUBLISH=127.0.0.1:8080" >&2
  fail=1
}
has SESSION_SECRET || echo "  warning: .env has no SESSION_SECRET - everyone is logged out on every deploy" >&2
docker compose version >/dev/null 2>&1 || { echo "  docker compose is not installed on the server" >&2; fail=1; }
exit $fail
REMOTE

echo "==> Uploading code to $HOST:$DIR"
# Unpacked into a staging folder first, so a broken upload never leaves the
# server with half a checkout. Secrets / junk are excluded even inside the
# allowed folders; COPYFILE_DISABLE + --no-xattrs keep macOS metadata out.
COPYFILE_DISABLE=1 tar -czf - --no-xattrs \
    --exclude='.DS_Store' --exclude='._*' --exclude='.env' --exclude='.env.*' \
    --exclude='*.pem' --exclude='*.key' --exclude='node_modules' --exclude='*.log' \
    "${FILES[@]}" |
  "${SSH[@]}" "$HOST" "set -e; cd '$DIR'; rm -rf .deploy-new; mkdir .deploy-new
    tar -xzf - -C .deploy-new --no-same-owner
    test -f .deploy-new/deploy/compose.prod.yml
    rm -rf public src server deploy tools
    cp -R .deploy-new/. .
    rm -rf .deploy-new"

echo "==> Building and starting containers"
"${SSH[@]}" "$HOST" "set -e; cd '$DIR'; $COMPOSE up -d --build --remove-orphans; docker image prune -f >/dev/null; $COMPOSE ps"

DOMAIN="$("${SSH[@]}" "$HOST" "sed -n 's/^[[:space:]]*SITE_DOMAIN[[:space:]]*=[[:space:]]*//p' '$DIR/.env' | head -n 1" | tr -d "\"' \r")"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "could not read SITE_DOMAIN from $DIR/.env"

echo "==> Checking https://$DOMAIN/healthz"
# A first deploy may still be fetching its certificate: retry for ~1 minute.
curl -fsS --max-time 10 --retry 12 --retry-delay 5 --retry-all-errors -o /dev/null "https://$DOMAIN/healthz" ||
  die "https://$DOMAIN/healthz does not answer. Logs: ssh $HOST 'cd $DIR && $COMPOSE logs --tail 50'"
echo "==> Live at https://$DOMAIN"
