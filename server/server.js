/**
 * Toon Town server: serves the static Vite build (dist/) behind a friendly,
 * shared-password login page.
 *
 *   GAME_PASSWORD=secret node server/server.js
 *
 * Environment (see .env.example):
 *   PORT            listen port (default 8080)
 *   GAME_PASSWORD   the shared password (required when NODE_ENV=production;
 *                   in development a random one is generated and printed)
 *   SESSION_SECRET  key for signing login cookies (default: random per boot,
 *                   so everyone has to log in again after a restart)
 *   SESSION_DAYS    how long a login lasts (default 30)
 *   TRUST_PROXY     Express "trust proxy" setting (default
 *                   "loopback, linklocal, uniquelocal" - Caddy/Nginx/Docker)
 *   DIST_DIR        static build directory (default ../dist next to this file)
 *
 * The session cookie is `base64url(JSON {exp}) "." base64url(HMAC-SHA256)`.
 * The HMAC key is derived from SESSION_SECRET *and* the password, so changing
 * GAME_PASSWORD signs everybody out.
 *
 * Regression tests for everything security-related: node tools/server-test.mjs
 */
import express from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_NAME = "toontown_session";
const DEFAULT_TRUST_PROXY = "loopback, linklocal, uniquelocal";
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Extensions that may have precompressed .br / .gz siblings (tools/precompress.mjs). */
const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".html", ".svg", ".json", ".wasm"]);
/** Preferred order when the client accepts several encodings equally. */
const ENCODINGS = [
  { name: "br", suffix: ".br" },
  { name: "gzip", suffix: ".gz" },
];

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const FALLBACK_FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#ffb703"/>' +
  '<path d="M14 40 L32 18 L50 40 Z" fill="#e05d5d"/><rect x="20" y="40" width="24" height="14" rx="2" fill="#fff6e0"/>' +
  '<rect x="29" y="44" width="6" height="10" rx="1" fill="#8a5a3b"/></svg>';

const MESSAGES = {
  wrong: '<p class="msg msg--error" role="alert">Hmm, that&rsquo;s not the secret password. Give it another go!</p>',
  bye: '<p class="msg msg--info" role="status">You&rsquo;ve left town. Come back soon!</p>',
  crossSite:
    '<p class="msg msg--error" role="alert">That knock came from another website. Type the password right here instead!</p>',
  /** @param {number} minutes */
  blocked: (minutes) =>
    `<p class="msg msg--error" role="alert">Whoa, too many tries! Take a breather and try again in ${minutes} minute${minutes === 1 ? "" : "s"}.</p>`,
};

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Toon Town · Lost?</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; box-sizing: border-box;
    font-family: ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif; color: #1d2b3a;
    background: linear-gradient(180deg, #3eaef9, #8fd3ff 55%, #7ccf5b 55%, #5fae45); text-align: center; }
  .card { background: #fffaf0; border: 3px solid #1d2b3a; border-radius: 28px; box-shadow: 0 8px 0 #1d2b3a;
    padding: 28px 26px; max-width: 360px; }
  h1 { margin: 0 0 8px; font-size: 28px; } p { margin: 0 0 20px; color: #4a5a6c; line-height: 1.45; }
  a { display: inline-block; padding: 14px 24px; border: 3px solid #1d2b3a; border-radius: 16px; background: #ffb703;
    color: #1d2b3a; font-weight: 900; text-decoration: none; box-shadow: 0 5px 0 #fb8500, 0 5px 0 3px #1d2b3a; }
</style></head>
<body><div class="card"><h1>Oops! Wrong turn.</h1><p>This street isn&rsquo;t on the map of Toon Town.</p>
<a href="/">Back to town</a></div></body></html>
`;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Thrown for configuration problems that should stop the server with a clear message. */
export class ConfigError extends Error {}

/**
 * Builds the server config from environment variables.
 * @param {Record<string, string | undefined>} env
 * @returns {{ port: number, password: string, generatedPassword: boolean, sessionSecret: string,
 *   generatedSecret: boolean, sessionDays: number, trustProxy: boolean | number | string,
 *   distDir: string, production: boolean }}
 */
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";

  let password = (env.GAME_PASSWORD ?? "").trim();
  const generatedPassword = !password;
  if (!password) {
    if (production) {
      throw new ConfigError(
        "GAME_PASSWORD is not set. Toon Town refuses to start without a password in production.\n" +
          "  Set it in your .env file (cp .env.example .env) or the environment, e.g. GAME_PASSWORD='sunny-otter-42'."
      );
    }
    password = randomBytes(9).toString("base64url");
  }

  const port = env.PORT ? Number(env.PORT) : 8080;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be a number between 1 and 65535 (got "${env.PORT}").`);
  }

  const sessionDays = env.SESSION_DAYS ? Number(env.SESSION_DAYS) : 30;
  if (!Number.isFinite(sessionDays) || sessionDays <= 0 || sessionDays > 400) {
    throw new ConfigError(`SESSION_DAYS must be a number of days between 0 and 400 (got "${env.SESSION_DAYS}").`);
  }

  const sessionSecret = (env.SESSION_SECRET ?? "").trim();

  return {
    port,
    password,
    generatedPassword,
    sessionSecret: sessionSecret || randomBytes(32).toString("hex"),
    generatedSecret: !sessionSecret,
    sessionDays,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    distDir: env.DIST_DIR ? path.resolve(env.DIST_DIR) : path.resolve(HERE, "..", "dist"),
    production,
  };
}

/** "true"/"false"/hop count/comma-separated subnets -> Express "trust proxy" value. */
function parseTrustProxy(value) {
  const v = (value ?? "").trim();
  if (!v) return DEFAULT_TRUST_PROXY;
  if (/^(false|no|off|none)$/i.test(v)) return false;
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Default logger: one timestamped line per event (never passwords or cookies). */
const logLine = (msg) => console.log(`${new Date().toISOString()} [toon-town] ${msg}`);

const sha256 = (text) => createHash("sha256").update(String(text), "utf8").digest();

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Only allow same-site relative redirect targets ("/path?query"). Anything that
 * a browser could read as another origin ("//evil", "/\evil", "/\t/evil",
 * "https://evil") falls back to "/".
 */
export function safeNext(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  if (/^\/(login|logout)(?:[/?#]|$)/i.test(value)) return "/";
  return value;
}

/**
 * True when a request was started by a page on another site (or an opaque
 * "null" origin such as a sandboxed iframe). Used on POST /login so another
 * website can't make its visitors' browsers guess passwords for it (each
 * visitor would bring a fresh IP and a fresh rate-limit budget, and
 * `fetch(..., { redirect: "manual" })` can tell a hit from a miss).
 * Requests without Origin / Sec-Fetch-Site (curl, very old browsers) pass:
 * they come from the sender's own IP and hit the normal rate limit.
 */
export function isCrossSiteRequest(req) {
  const site = req.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    // Hostnames only: a proxy may drop the port from Host (nginx `$host`).
    return new URL(origin).hostname.toLowerCase() !== String(req.hostname ?? "").toLowerCase();
  } catch {
    return true; // "null" or garbage
  }
}

/** All values of a cookie in the raw Cookie header (there can be duplicates). */
function readCookies(req, name) {
  const header = req.headers.cookie;
  if (!header) return [];
  const values = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) values.push(part.slice(eq + 1).trim());
  }
  return values;
}

/** Client address for log lines ("::ffff:1.2.3.4" -> "1.2.3.4"). */
const shownIp = (req) => (req.ip ?? "unknown").replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");

/**
 * Rate-limit key: IPv4 address as-is, IPv6 grouped by /64 (one home or VPS
 * usually owns a whole /64, so per-address limits would be trivial to dodge).
 */
function clientKey(ip) {
  if (!ip) return "unknown";
  if (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7))) return ip.slice(7);
  if (!net.isIPv6(ip)) return ip;
  const [head, tail] = ip.split("%")[0].toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Parses Accept-Encoding and picks the best available precompressed variant.
 * @param {string | undefined} header
 * @param {{ name: string, suffix: string }[]} available  in server preference order
 */
function pickEncoding(header, available) {
  const q = new Map();
  for (const part of String(header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) weight = Number(m[1]);
    }
    q.set(name.trim(), Number.isFinite(weight) ? weight : 0);
  }
  let best = null;
  let bestQ = 0;
  for (const enc of available) {
    const weight = q.get(enc.name) ?? q.get("*") ?? 0;
    if (weight > bestQ) {
      best = enc;
      bestQ = weight;
    }
  }
  return best;
}

async function statFile(file) {
  try {
    const s = await stat(file);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Failed-login counter per client key, fixed window, with periodic cleanup.
 * Memory is bounded: at most `maxEntries` keys (~100 bytes each).
 */
export function createLoginLimiter({ max, windowMs, maxEntries = 10_000 }) {
  const entries = new Map(); // key -> { count, resetAt }
  const sweep = () => {
    const now = Date.now();
    for (const [key, e] of entries) if (e.resetAt <= now) entries.delete(key);
  };
  const timer = setInterval(sweep, 60_000);
  timer.unref();

  return {
    /** Milliseconds until this client may try again (0 = not blocked). */
    retryAfter(key) {
      const e = entries.get(key);
      if (!e) return 0;
      const left = e.resetAt - Date.now();
      if (left <= 0) {
        entries.delete(key);
        return 0;
      }
      return e.count >= max ? left : 0;
    },
    /** Records a failure; returns the failure count in the current window. */
    fail(key) {
      const now = Date.now();
      let e = entries.get(key);
      if (!e || e.resetAt <= now) {
        if (entries.size >= maxEntries) {
          sweep();
          // Still full (lots of distinct attackers): forget the oldest entry.
          if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        }
        e = { count: 0, resetAt: now + windowMs };
        entries.set(key, e);
      }
      e.count += 1;
      return e.count;
    },
    /** True the first time it is called for a blocked window (log once, not per request). */
    firstBlockNotice(key) {
      const e = entries.get(key);
      if (!e || e.noticed) return false;
      e.noticed = true;
      return true;
    },
    reset(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

/** Signs and verifies the stateless session cookie. */
function createSessions(secret, password, days) {
  // Binding the key to the password means a password change logs everyone out.
  const key = createHmac("sha256", secret).update("toon-town:session:v1:").update(sha256(password)).digest();
  const maxAgeSec = Math.round(days * 86_400);
  const sign = (payload) => createHmac("sha256", key).update(payload).digest();
  const nowSec = () => Math.floor(Date.now() / 1000);

  return {
    maxAgeMs: maxAgeSec * 1000,
    issue() {
      const payload = Buffer.from(JSON.stringify({ exp: nowSec() + maxAgeSec })).toString("base64url");
      return `${payload}.${sign(payload).toString("base64url")}`;
    },
    /** @param {string} token */
    verify(token) {
      if (typeof token !== "string" || token.length > 512) return false;
      const dot = token.indexOf(".");
      if (dot <= 0) return false;
      const payload = token.slice(0, dot);
      const sigText = token.slice(dot + 1);
      const sig = Buffer.from(sigText, "base64url");
      const expected = sign(payload);
      // Buffer.from(…, "base64url") skips junk characters, so also require a canonical encoding.
      if (sig.length !== expected.length || sig.toString("base64url") !== sigText) return false;
      if (!timingSafeEqual(sig, expected)) return false;
      try {
        const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const now = nowSec();
        // Upper bound: a cookie issued under a longer SESSION_DAYS doesn't outlive a shorter setting.
        return Number.isFinite(exp) && exp > now && exp <= now + maxAgeSec + 60;
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/**
 * Creates the Express app (does not listen). Call `app.locals.close()` when
 * done to stop the rate limiter's cleanup timer.
 *
 * @param {object} config
 * @param {string} config.password             shared game password (required)
 * @param {string} [config.sessionSecret]      cookie signing secret (random if omitted)
 * @param {number} [config.sessionDays=30]
 * @param {boolean|number|string} [config.trustProxy="loopback, linklocal, uniquelocal"]
 * @param {string} [config.distDir]            defaults to ../dist
 * @param {{ max?: number, windowMs?: number }} [config.loginLimit]  failed-login rate limit
 * @param {(msg: string) => void} [config.log] logger (default: timestamped console.log)
 * @returns {import("express").Express}
 */
export function createApp(config) {
  const password = String(config?.password ?? "").trim();
  if (!password) throw new ConfigError("createApp: a non-empty password is required");

  const distDir = path.resolve(config.distDir ?? path.resolve(HERE, "..", "dist"));
  const log = config.log ?? logLine;
  const sessions = createSessions(
    config.sessionSecret || randomBytes(32).toString("hex"),
    password,
    config.sessionDays ?? 30
  );
  const maxFailures = config.loginLimit?.max ?? LOGIN_MAX_FAILURES;
  const limiter = createLoginLimiter({
    max: maxFailures,
    windowMs: config.loginLimit?.windowMs ?? LOGIN_WINDOW_MS,
  });
  const passwordDigest = sha256(password);
  const loginTemplate = readFileSync(path.join(HERE, "login.html"), "utf8");

  const passwordMatches = (given) => timingSafeEqual(sha256(String(given).trim()), passwordDigest);
  const isLoggedIn = (req) => readCookies(req, COOKIE_NAME).some((v) => sessions.verify(v));
  const cookieOptions = (req) => ({ httpOnly: true, sameSite: "lax", path: "/", secure: req.secure });

  /** Renders login.html with the given status, redirect target and message. */
  function renderLogin(res, { status = 200, next = "/", message = "", state = "" } = {}) {
    const vars = { next: escapeHtml(next), message, state };
    const html = loginTemplate.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
    res.status(status).set("Cache-Control", "no-store").type("html").send(html);
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ?? DEFAULT_TRUST_PROXY);
  app.locals.close = () => limiter.stop();

  // A proxy that isn't trusted makes everyone share its IP (one bad guess
  // streak locks out all friends) and hides HTTPS (no Secure cookie, no HSTS).
  // Say so once instead of failing silently.
  let warnedUntrustedProxy = false;
  app.use((req, res, next) => {
    if (!warnedUntrustedProxy && (req.headers["x-forwarded-for"] || req.headers["x-forwarded-proto"])) {
      const addr = req.socket.remoteAddress;
      if (addr && !app.get("trust proxy fn")(addr, 0)) {
        warnedUntrustedProxy = true;
        log(`note: ignoring X-Forwarded-* headers from ${addr} (not a trusted proxy). If this is your reverse proxy, set TRUST_PROXY.`);
      }
    }
    next();
  });

  // ---- security headers on every response ---------------------------------
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "gamepad=(self), camera=(), microphone=(), geolocation=()",
      "X-Robots-Tag": "noindex, nofollow",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000");
    next();
  });

  // ---- public routes ------------------------------------------------------
  app.get("/healthz", (req, res) => {
    res.set("Cache-Control", "no-store").type("text").send("ok");
  });

  app.get("/robots.txt", (req, res) => {
    res.set("Cache-Control", "public, max-age=86400").type("text").send("User-agent: *\nDisallow: /\n");
  });

  app.get("/favicon.svg", (req, res, next) => serveStatic(req, res, next), (req, res) => {
    res.set("Cache-Control", "public, max-age=86400").type("svg").send(FALLBACK_FAVICON);
  });

  app.get("/login", (req, res) => {
    const next = safeNext(req.query.next);
    if (isLoggedIn(req)) return res.set("Cache-Control", "no-store").redirect(302, next);
    renderLogin(res, { next, message: req.query.bye !== undefined ? MESSAGES.bye : "" });
  });

  app.post(
    "/login",
    express.urlencoded({ extended: false, limit: "8kb", parameterLimit: 20 }),
    (req, res) => {
      const next = safeNext(req.body?.next);
      const key = clientKey(req.ip);

      // Not counted as a failure: the visitor whose browser sent it did nothing wrong.
      if (isCrossSiteRequest(req)) {
        return renderLogin(res, { status: 403, next, message: MESSAGES.crossSite, state: "is-error" });
      }

      const waitMs = limiter.retryAfter(key);
      if (waitMs > 0) {
        if (limiter.firstBlockNotice(key)) log(`login blocked ip=${shownIp(req)} (too many failures; further attempts not logged)`);
        const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
        res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
        return renderLogin(res, { status: 429, next, message: MESSAGES.blocked(minutes), state: "is-error" });
      }

      const given = typeof req.body?.password === "string" ? req.body.password : "";
      if (!passwordMatches(given)) {
        const failures = limiter.fail(key);
        log(`login failed ip=${shownIp(req)} (${failures}/${maxFailures})`);
        return renderLogin(res, { status: 401, next, message: MESSAGES.wrong, state: "is-error" });
      }

      limiter.reset(key);
      res.cookie(COOKIE_NAME, sessions.issue(), { ...cookieOptions(req), maxAge: sessions.maxAgeMs });
      log(`login ok ip=${shownIp(req)}`);
      res.set("Cache-Control", "no-store").redirect(303, next);
    }
  );

  app.get("/logout", (req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions(req));
    res.set("Cache-Control", "no-store").redirect(302, "/login?bye=1");
  });

  // ---- everything below needs a valid session ------------------------------
  app.use((req, res, next) => {
    if (isLoggedIn(req)) return next();
    res.set("Cache-Control", "no-store");
    if ((req.method === "GET" || req.method === "HEAD") && req.accepts("html")) {
      return res.redirect(302, `/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
    }
    res.status(401).type("text").send("Unauthorized - log in first.\n");
  });

  app.use(serveStatic);

  // ---- 404 + errors --------------------------------------------------------
  app.use((req, res) => {
    res.status(404).set("Cache-Control", "no-store");
    if (req.accepts("html")) return res.type("html").send(NOT_FOUND_HTML);
    res.type("text").send("Not found\n");
  });

  // Express recognises error handlers by their four parameters.
  app.use((err, req, res, next) => {
    let status = Number(err?.status || err?.statusCode);
    if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
    if (status >= 500) console.error(`${new Date().toISOString()} [toon-town] error ${req.method} ${req.path}:`, err);
    if (res.headersSent) return next(err);
    const text = status === 413 ? "Request too large" : status < 500 ? "Bad request" : "Something went wrong";
    res.status(status).set("Cache-Control", "no-store").type("text").send(`${text}\n`);
  });

  /** True when `file` exists and, after resolving symlinks, still lives inside distDir. */
  let distRoot = null;
  async function insideDist(file) {
    try {
      distRoot ??= await realpath(distDir);
      const real = await realpath(file);
      return real.startsWith(distRoot + path.sep);
    } catch {
      return false;
    }
  }

  /**
   * Serves a file from distDir, preferring a precompressed .br/.gz sibling
   * when the client accepts it. Falls through (next()) when nothing matches.
   */
  async function serveStatic(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let rel;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return res.status(400).type("text").send("Bad request\n");
    }
    if (rel.includes("\0") || rel.includes("\\")) return next();
    if (rel.endsWith("/")) rel += "index.html";
    rel = path.posix.normalize(rel); // always starts with "/", so ".." can't climb above it
    if (rel.split("/").some((seg) => seg.startsWith("."))) return next(); // dotfiles / leftovers

    const file = path.join(distDir, rel);
    if (!file.startsWith(distDir + path.sep)) return next();
    // Symlinks must not lead out of dist/ (send() would follow them).
    if (!(await statFile(file)) || !(await insideDist(file))) return next();

    const ext = path.extname(file).toLowerCase();
    let servePath = file;
    let encoding = null;
    if (COMPRESSIBLE.has(ext)) {
      const available = [];
      for (const enc of ENCODINGS) {
        const variant = file + enc.suffix;
        if ((await statFile(variant)) && (await insideDist(variant))) available.push(enc);
      }
      if (available.length) {
        res.vary("Accept-Encoding");
        encoding = pickEncoding(req.get("accept-encoding"), available);
        if (encoding) servePath = file + encoding.suffix;
      }
    }

    // Content-Type of the *original* file (send() keeps a type that is already set).
    res.type(ext || "application/octet-stream");
    if (encoding) res.set("Content-Encoding", encoding.name);
    // "private": these responses are behind the login, so a shared cache (a CDN
    // someone adds later) must not hand them to visitors without a cookie.
    res.set(
      "Cache-Control",
      rel.startsWith("/assets/") ? "private, max-age=31536000, immutable" : "private, no-cache"
    );

    const options = { root: distDir, cacheControl: false, acceptRanges: !encoding, dotfiles: "deny" };
    res.sendFile(path.relative(distDir, servePath), options, (err) => {
      if (!err || res.headersSent) return; // aborted mid-stream: nothing left to do
      res.removeHeader("Content-Encoding");
      res.removeHeader("Content-Type");
      res.removeHeader("Cache-Control");
      next(err.status === 404 ? undefined : err);
    });
  }

  return app;
}

/**
 * Wraps the app in an HTTP server with tighter timeouts than Node's defaults,
 * so slow-drip clients (slowloris) can't pin connections for minutes.
 * `options` are passed to http.createServer (tests use short values).
 * @param {import("express").Express} app
 * @param {import("node:http").ServerOptions & { socketTimeout?: number }} [options]
 */
export function createHttpServer(app, { socketTimeout = 120_000, ...options } = {}) {
  const server = http.createServer(
    {
      headersTimeout: 20_000, // the whole header block must arrive within 20 s
      requestTimeout: 30_000, // ... and the whole request (headers + body) within 30 s
      connectionsCheckingInterval: 5_000, // how often those two are enforced (Node default: 30 s)
      ...options,
    },
    app
  );
  // Socket with no traffic at all (e.g. a stalled download) - responses can take as long as they need.
  server.setTimeout(socketTimeout);
  return server;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function isRunDirectly() {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main() {
  const say = logLine;

  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`[toon-town] ERROR: ${err.message}`);
    process.exit(1);
  }

  const app = createApp(cfg);
  const server = createHttpServer(app);

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") console.error(`[toon-town] ERROR: port ${cfg.port} is already in use.`);
    else console.error("[toon-town] ERROR:", err);
    process.exit(1);
  });

  server.listen(cfg.port, () => {
    say(`Toon Town is open at http://localhost:${cfg.port}  (${cfg.production ? "production" : "development"})`);
    say(`serving ${cfg.distDir}`);
    if (!existsSync(path.join(cfg.distDir, "index.html"))) {
      say(`WARNING: ${path.join(cfg.distDir, "index.html")} not found - run "npm run build" first.`);
    }
    if (cfg.generatedPassword) say(`GAME_PASSWORD not set - development password for this run: ${cfg.password}`);
    else if (cfg.password.length < 8) say("WARNING: GAME_PASSWORD is short; a longer passphrase is much harder to guess.");
    if (cfg.generatedSecret) say("SESSION_SECRET not set - logins reset whenever the server restarts.");
    // With a guessable secret, one captured cookie allows offline password guessing.
    else if (cfg.sessionSecret.length < 32) say("WARNING: SESSION_SECRET is short; use the output of `openssl rand -hex 32`.");
  });

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    say(`${signal} received, closing...`);
    app.locals.close();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    // Don't let a slow download hold up `docker stop` (which kills after 10 s).
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 8000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (isRunDirectly()) main();
