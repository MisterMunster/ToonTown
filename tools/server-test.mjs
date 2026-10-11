/**
 * Security regression tests for server/server.js (login gate, cookies,
 * redirects, rate limiting, proxy trust, static serving, headers, timeouts).
 *
 *   node tools/server-test.mjs
 *
 * No dependencies beyond Node (node:test). Uses a throwaway fixture dist/ in
 * the OS temp dir, so it never touches the real build. Exit code != 0 on failure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  createApp,
  createHttpServer,
  createLoginLimiter,
  loadConfig,
  safeNext,
} from "../server/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = "purple otter bakes pies";
const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const SECRET_TEXT = "TOPSECRET-outside-dist";
const HIDDEN_TEXT = "HIDDEN-dotfile";

// ---------------------------------------------------------------------------
// Fixture dist/ with traps: symlinks out of dist, dotfiles, a sibling dir
// whose name starts with "dist", precompressed variants.
// ---------------------------------------------------------------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), "toon-server-test-"));
const dist = path.join(tmp, "dist");
mkdirSync(path.join(dist, "assets"), { recursive: true });
mkdirSync(path.join(dist, "sub"), { recursive: true });
mkdirSync(path.join(tmp, "dist-sibling"), { recursive: true });
writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>game</title>INDEX-PAGE");
writeFileSync(path.join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
writeFileSync(path.join(dist, "assets", "app.js"), "console.log('identity')");
writeFileSync(path.join(dist, "assets", "app.js.br"), "BROTLI-BYTES");
writeFileSync(path.join(dist, "assets", "app.js.gz"), "GZIP-BYTES");
writeFileSync(path.join(dist, "assets", "style.css"), "body{}");
writeFileSync(path.join(dist, "assets", "evil.js"), "console.log('evil identity')");
writeFileSync(path.join(dist, ".hidden"), HIDDEN_TEXT);
writeFileSync(path.join(dist, "sub", "x.txt"), "sub file");
writeFileSync(path.join(tmp, "secret.txt"), SECRET_TEXT);
writeFileSync(path.join(tmp, "dist-sibling", "secret2.txt"), SECRET_TEXT);
symlinkSync(path.join(tmp, "secret.txt"), path.join(dist, "link.txt"));
symlinkSync(path.join(tmp, "secret.txt"), path.join(dist, "assets", "evil.js.br"));
symlinkSync(path.join(dist, "sub", "x.txt"), path.join(dist, "inner-link.txt")); // stays inside: allowed

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const servers = [];

/** Starts an app on an ephemeral port; returns { base, logs, app }. */
async function start(overrides = {}) {
  const logs = [];
  const app = createApp({
    password: PASSWORD,
    sessionSecret: SECRET,
    distDir: dist,
    log: (m) => logs.push(m),
    ...overrides,
  });
  const server = createHttpServer(app, overrides.serverOptions);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({ server, app });
  return { port: server.address().port, logs, app, server };
}

/**
 * Raw HTTP request (the path is sent exactly as given: no URL normalisation).
 * @returns {Promise<{ status: number, headers: Record<string, any>, body: string }>}
 */
function request(port, method, rawPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: rawPath, headers: { host: `localhost:${port}`, ...headers }, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const form = (fields) => new URLSearchParams(fields).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };

/** Logs in and returns the session cookie value ("name=value"). */
async function login(port, extraHeaders = {}) {
  const r = await request(port, "POST", "/login", { headers: { ...FORM, ...extraHeaders }, body: form({ password: PASSWORD }) });
  assert.equal(r.status, 303, `login should succeed, got ${r.status}`);
  const setCookie = r.headers["set-cookie"]?.[0] ?? "";
  return setCookie.split(";")[0];
}

/** Same derivation as server.js, for crafting tokens with chosen payloads. */
function forge(payloadObj, { secret = SECRET, password = PASSWORD } = {}) {
  const key = createHmac("sha256", secret)
    .update("toon-town:session:v1:")
    .update(createHash("sha256").update(password, "utf8").digest())
    .digest();
  const payload = Buffer.from(typeof payloadObj === "string" ? payloadObj : JSON.stringify(payloadObj)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const cookie = (token) => ({ cookie: `toontown_session=${token}` });

/** A redirect target is safe if a browser resolves it to our own origin. */
function assertSameOrigin(location, label) {
  assert.ok(typeof location === "string" && location.length > 0, `${label}: no Location`);
  assert.ok(location.startsWith("/") && !location.startsWith("//") && !location.startsWith("/\\"), `${label}: unsafe Location ${location}`);
  assert.ok(!/[\u0000-\u001f\\]/.test(location), `${label}: control char/backslash in Location ${JSON.stringify(location)}`);
  const base = "https://game.example/";
  assert.equal(new URL(location, base).origin, "https://game.example", `${label}: ${location} leaves the site`);
}

const NO_LEAK = /node_modules|\bat .+\.m?js:\d+:\d+|\b[A-Z]\w*Error: |[Ee]xpress|ENOENT|EACCES|EISDIR/;

test.after(() => {
  for (const { server, app } of servers) {
    app.locals.close();
    server.closeAllConnections();
    server.close();
  }
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
test("config: production refuses to start without a password; bad values rejected", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: "production", GAME_PASSWORD: "   " }), ConfigError);
  assert.throws(() => loadConfig({ GAME_PASSWORD: "x", PORT: "0" }), ConfigError);
  assert.throws(() => loadConfig({ GAME_PASSWORD: "x", SESSION_DAYS: "-1" }), ConfigError);
  assert.throws(() => loadConfig({ GAME_PASSWORD: "x", SESSION_DAYS: "abc" }), ConfigError);
  const dev = loadConfig({});
  assert.equal(dev.generatedPassword, true);
  assert.ok(dev.password.length >= 12);
  assert.equal(loadConfig({ GAME_PASSWORD: "x", TRUST_PROXY: "false" }).trustProxy, false);
  assert.equal(loadConfig({ GAME_PASSWORD: "x", TRUST_PROXY: "1" }).trustProxy, 1);
});

test("trust proxy default: Docker bridge / private nets trusted, public + CGNAT not", async () => {
  const { app } = await start();
  const trust = app.get("trust proxy fn");
  for (const ip of ["127.0.0.1", "::1", "172.17.0.2", "172.18.0.3", "172.31.255.1", "192.168.65.1", "10.0.0.5", "fd00::5"]) {
    assert.equal(trust(ip, 0), true, `${ip} should be trusted`);
  }
  for (const ip of ["8.8.8.8", "203.0.113.5", "100.64.0.1", "172.32.0.1", "2001:db8::1"]) {
    assert.equal(trust(ip, 0), false, `${ip} must not be trusted`);
  }
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------
test("everything but the public routes needs a login", async () => {
  const { port } = await start();
  const r = await request(port, "GET", "/", { headers: { accept: "text/html" } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, "/login?next=%2F");
  assert.equal(r.headers["cache-control"], "no-store");

  for (const p of ["/index.html", "/assets/app.js", "/sub/x.txt", "/inner-link.txt", "/%2e%2e/secret.txt"]) {
    const a = await request(port, "GET", p, { headers: { accept: "application/json" } });
    assert.equal(a.status, 401, p);
    assert.ok(!a.body.includes("INDEX-PAGE") && !a.body.includes("identity"), p);
  }
  for (const m of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"]) {
    const a = await request(port, m, "/", { headers: { accept: "text/html" } });
    assert.equal(a.status, 401, m);
    assert.equal(a.headers.allow, undefined, `${m} must not advertise routes`);
  }
  const head = await request(port, "HEAD", "/assets/app.js", { headers: { accept: "text/html" } });
  assert.equal(head.status, 302);

  // Public routes.
  assert.equal((await request(port, "GET", "/healthz")).body, "ok");
  assert.match((await request(port, "GET", "/robots.txt")).body, /Disallow: \//);
  assert.equal((await request(port, "GET", "/favicon.svg")).status, 200);
  // The public favicon route must not become a back door into dist/.
  for (const p of ["/favicon.svg/", "/FAVICON.SVG", "/favicon.svg/..%2findex.html", "/favicon.svg%2f..%2findex.html"]) {
    const f = await request(port, "GET", p, { headers: { accept: "text/html" } });
    assert.ok(!f.body.includes("INDEX-PAGE"), `${p} leaked index.html`);
  }
});

test("security headers on every kind of response; no banners", async () => {
  const { port } = await start();
  const c = await login(port);
  const cases = [
    ["GET", "/login", {}],
    ["GET", "/healthz", {}],
    ["GET", "/", { accept: "text/html" }],
    ["GET", "/", { ...cookie(c.split("=")[1]) }],
    ["GET", "/nope", { accept: "text/html", ...cookie(c.split("=")[1]) }],
    ["GET", "/%E0%A4%A", { ...cookie(c.split("=")[1]) }],
    ["POST", "/login", { ...FORM }],
  ];
  for (const [m, p, h] of cases) {
    const r = await request(port, m, p, { headers: h, body: m === "POST" ? "x".repeat(9000) : undefined });
    const label = `${m} ${p} (${r.status})`;
    assert.match(r.headers["content-security-policy"] ?? "", /default-src 'self'/, label);
    assert.match(r.headers["content-security-policy"], /script-src 'self'(;|$)/, label);
    assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/, label);
    assert.match(r.headers["content-security-policy"], /object-src 'none'/, label);
    assert.match(r.headers["content-security-policy"], /form-action 'self'/, label);
    assert.ok(!/unsafe-eval|\*/.test(r.headers["content-security-policy"]), label);
    assert.equal(r.headers["x-content-type-options"], "nosniff", label);
    assert.equal(r.headers["x-frame-options"], "DENY", label);
    assert.equal(r.headers["referrer-policy"], "same-origin", label);
    assert.match(r.headers["permissions-policy"] ?? "", /camera=\(\)/, label);
    assert.equal(r.headers["x-powered-by"], undefined, label);
    assert.equal(r.headers.server, undefined, label);
    assert.equal(r.headers["strict-transport-security"], undefined, `${label}: no HSTS over plain HTTP`);
    assert.ok(!NO_LEAK.test(r.body), `${label}: body leaks internals: ${r.body.slice(0, 200)}`);
  }
});

// ---------------------------------------------------------------------------
// Login + cookie
// ---------------------------------------------------------------------------
test("login: wrong password -> 401, no cookie; right one -> HttpOnly SameSite cookie", async () => {
  const { port, logs } = await start();
  const bad = await request(port, "POST", "/login", { headers: FORM, body: form({ password: "nope" }) });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers["set-cookie"], undefined);
  assert.match(bad.body, /not the secret password/);
  assert.equal(bad.headers["cache-control"], "no-store");

  // Arrays / missing fields don't crash and don't log in.
  for (const body of ["password=a&password=b", "", "next=/", `password[]=${encodeURIComponent(PASSWORD)}`]) {
    const r = await request(port, "POST", "/login", { headers: FORM, body });
    assert.equal(r.status, 401, body);
  }
  // Non-form bodies are just wrong passwords.
  const json = await request(port, "POST", "/login", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(json.status, 401);

  const ok = await request(port, "POST", "/login", { headers: FORM, body: form({ password: `  ${PASSWORD} ` }) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.location, "/");
  const sc = ok.headers["set-cookie"][0];
  assert.match(sc, /^toontown_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43};/);
  assert.match(sc, /; HttpOnly/);
  assert.match(sc, /; SameSite=Lax/);
  assert.match(sc, /; Path=\//);
  assert.match(sc, /; Max-Age=2592000/);
  assert.ok(!/; Secure/.test(sc), "no Secure flag over plain HTTP (the browser would drop the cookie)");
  assert.ok(!/Domain=/i.test(sc));

  const token = sc.split(";")[0].split("=")[1];
  const page = await request(port, "GET", "/", { headers: cookie(token) });
  assert.equal(page.status, 200);
  assert.match(page.body, /INDEX-PAGE/);

  // Nothing secret in the logs.
  const all = logs.join("\n");
  assert.ok(!all.includes(PASSWORD) && !all.includes(token), "password or token logged");
  assert.match(all, /login failed ip=/);
  assert.match(all, /login ok ip=/);
});

test("cookie: Secure + HSTS only when a trusted proxy says HTTPS", async () => {
  // Loopback is trusted by default (Caddy/nginx on the host, or a container on a private net).
  const trusted = await start();
  const viaProxy = await request(trusted.port, "POST", "/login", {
    headers: { ...FORM, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" },
    body: form({ password: PASSWORD }),
  });
  assert.match(viaProxy.headers["set-cookie"][0], /; Secure/);
  assert.match(viaProxy.headers["strict-transport-security"] ?? "", /max-age=\d{7,}/);
  assert.match(trusted.logs.join("\n"), /login ok ip=203\.0\.113\.9/);

  // A client that is NOT a trusted proxy cannot claim HTTPS or another IP.
  const strict = await start({ trustProxy: "uniquelocal" }); // loopback no longer trusted
  const spoof = await request(strict.port, "POST", "/login", {
    headers: { ...FORM, "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.7" },
    body: form({ password: PASSWORD }),
  });
  assert.equal(spoof.status, 303);
  assert.ok(!/; Secure/.test(spoof.headers["set-cookie"][0]));
  assert.equal(spoof.headers["strict-transport-security"], undefined);
  const logText = strict.logs.join("\n");
  assert.match(logText, /login ok ip=127\.0\.0\.1/);
  assert.ok(!logText.includes("198.51.100.7 "), "spoofed XFF must not become the client IP");
  assert.match(logText, /not a trusted proxy/, "misconfigured proxy is reported");
  assert.equal(logText.match(/not a trusted proxy/g).length, 1, "reported once, not per request");
});

test("cookie verification rejects tampered, truncated, oversized, expired and foreign tokens", async () => {
  const { port } = await start();
  const good = (await login(port)).split("=")[1];
  const isIn = async (token) => (await request(port, "GET", "/", { headers: { ...cookie(token), accept: "text/html" } })).status === 200;
  assert.equal(await isIn(good), true);
  assert.equal(await isIn(forge({ exp: nowSec() + 3600 })), true, "forge helper matches the server");

  const [payload, sig] = good.split(".");
  const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // Same decoded bytes, different text: the last char's low 2 bits are padding.
  const last = b64.indexOf(sig.at(-1));
  const nonCanonical = sig.slice(0, -1) + b64[last ^ 1];
  const flipped = sig.slice(0, 5) + (sig[5] === "A" ? "B" : "A") + sig.slice(6);
  const otherPayload = Buffer.from(JSON.stringify({ exp: nowSec() + 999 })).toString("base64url");
  const bad = {
    empty: "",
    "no dot": payload + sig,
    "dot only": ".",
    "missing sig": `${payload}.`,
    "missing payload": `.${sig}`,
    "truncated sig": `${payload}.${sig.slice(0, -2)}`,
    "flipped sig bit": `${payload}.${flipped}`,
    "non-canonical sig": `${payload}.${nonCanonical}`,
    "padded sig": `${payload}.${sig}=`,
    "sig + junk": `${payload}.${sig}!!`,
    "swapped payload": `${otherPayload}.${sig}`,
    "oversized": `${payload}${"A".repeat(600)}.${sig}`,
    "expired": forge({ exp: nowSec() - 5 }),
    "beyond SESSION_DAYS": forge({ exp: nowSec() + 400 * 86400 }),
    "exp as string": forge({ exp: String(nowSec() + 3600) }),
    "exp missing": forge({}),
    "exp Infinity": forge('{"exp":1e999}'),
    "payload not JSON": forge("not json"),
    "wrong secret": forge({ exp: nowSec() + 3600 }, { secret: "other-secret" }),
    "old password": forge({ exp: nowSec() + 3600 }, { password: "old password" }),
    quoted: `"${good}"`,
  };
  for (const [label, token] of Object.entries(bad)) {
    assert.equal(await isIn(token), false, `accepted a bad token: ${label}`);
  }

  // A junk duplicate cookie doesn't hide a valid one; many junk cookies are fine.
  const junk = Array.from({ length: 300 }, (_, i) => `toontown_session=a${i}.b`).join("; ");
  const dup = await request(port, "GET", "/", { headers: { cookie: `${junk}; toontown_session=${good}` } });
  assert.equal(dup.status, 200);

  // Changing the password signs everybody out.
  const other = await start({ password: "a brand new password" });
  const r = await request(other.port, "GET", "/", { headers: { ...cookie(good), accept: "text/html" } });
  assert.equal(r.status, 302);
});

test("logout clears the cookie with matching attributes", async () => {
  const { port } = await start();
  const r = await request(port, "GET", "/logout", { headers: { "x-forwarded-proto": "https" } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, "/login?bye=1");
  const sc = r.headers["set-cookie"][0];
  assert.match(sc, /^toontown_session=;/);
  assert.match(sc, /Expires=Thu, 01 Jan 1970/);
  assert.match(sc, /; Path=\//);
  assert.match(sc, /; Secure/);
  assert.match(sc, /; HttpOnly/);
  const page = await request(port, "GET", "/login?bye=1");
  assert.match(page.body, /left town/);
});

// ---------------------------------------------------------------------------
// Open redirects
// ---------------------------------------------------------------------------
const EVIL_NEXT = [
  "//evil.com",
  "//evil.com/path",
  "///evil.com",
  "/\\evil.com",
  "\\\\evil.com",
  "/\\/evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r/evil.com",
  "/ /evil.com",
  " //evil.com",
  "https://evil.com",
  "http:/evil.com",
  "http:evil.com",
  "javascript:alert(1)",
  "data:text/html,hi",
  "evil.com",
  "%2F%2Fevil.com",
  "/%2F%2Fevil.com",
  "/%5Cevil.com",
  "/%5C%5Cevil.com",
  "/%09/evil.com",
  "/.//evil.com",
  "/./\\evil.com",
  "/。/evil.com",
  "/／／evil.com",
  "/ /evil.com",
  "/\u0000/evil.com",
  "/login",
  "/LOGIN?next=//evil.com",
  "/logout",
  "/" + "a".repeat(3000),
];

test("safeNext: only same-site paths survive", () => {
  for (const v of EVIL_NEXT) assertSameOrigin(safeNext(v), JSON.stringify(v));
  for (const v of ["//evil.com", "/\\evil.com", "https://evil.com", "/\t/evil.com", "/login", "/logout?x=1", "", null, ["/a"], 42]) {
    assert.equal(safeNext(v), "/", JSON.stringify(v));
  }
  assert.equal(safeNext("/?quality=low&time=21"), "/?quality=low&time=21");
  assert.equal(safeNext("/assets/x.js#frag"), "/assets/x.js#frag");
});

test("open redirect: POST /login, GET /login (logged in) and the unauthenticated bounce", async () => {
  const { port } = await start();
  const token = (await login(port)).split("=")[1];
  for (const v of EVIL_NEXT) {
    const label = JSON.stringify(v);
    const p = await request(port, "POST", "/login", { headers: FORM, body: form({ password: PASSWORD, next: v }) });
    assert.equal(p.status, 303, label);
    assertSameOrigin(p.headers.location, `POST ${label}`);

    const g = await request(port, "GET", `/login?next=${encodeURIComponent(v)}`, { headers: cookie(token) });
    assert.equal(g.status, 302, label);
    assertSameOrigin(g.headers.location, `GET ${label}`);

    // Logged out: the value lands in the form, HTML-escaped.
    const f = await request(port, "GET", `/login?next=${encodeURIComponent(v)}`);
    const hidden = /name="next" value="([^"]*)"/.exec(f.body)?.[1];
    assert.ok(hidden !== undefined, label);
    assertSameOrigin(hidden.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'"), `form ${label}`);
  }
  // Raw (unencoded / double-encoded) query strings.
  for (const q of ["//evil.com", "%2F%2Fevil.com", "/%2F%2Fevil.com", "%252F%252Fevil.com", "/%252F%252Fevil.com", "%5C%5Cevil.com", "/%5Cevil.com", "/%09/evil.com", "https:%2F%2Fevil.com", "/%0d%0aSet-Cookie:x=1"]) {
    const g = await request(port, "GET", `/login?next=${q}`, { headers: cookie(token) });
    assertSameOrigin(g.headers.location, `raw ${q}`);
    assert.equal(g.headers["set-cookie"], undefined, `header injection via ${q}`);
  }
  // Attribute injection into the hidden field is escaped.
  const xss = await request(port, "GET", `/login?next=${encodeURIComponent('/"><script>alert(1)</script>')}`);
  assert.ok(!xss.body.includes("<script>alert(1)"));
  assert.ok(xss.body.includes("&quot;&gt;&lt;script&gt;"));

  // Unauthenticated deep links remember only safe paths.
  for (const [raw, expected] of [
    ["//evil.com/x", "/login?next=%2F"],
    ["/\\evil.com", "/login?next=%2F"],
    ["/?time=21&quality=low", "/login?next=%2F%3Ftime%3D21%26quality%3Dlow"],
  ]) {
    const r = await request(port, "GET", raw, { headers: { accept: "text/html" } });
    assert.equal(r.status, 302, raw);
    assert.equal(r.headers.location, expected, raw);
  }
});

// ---------------------------------------------------------------------------
// CSRF / cross-site login attempts
// ---------------------------------------------------------------------------
test("POST /login from another site is refused and not counted", async () => {
  const { port } = await start({ loginLimit: { max: 2 } });
  const tryLogin = (headers, password = PASSWORD) =>
    request(port, "POST", "/login", { headers: { ...FORM, ...headers }, body: form({ password }) });

  for (const h of [
    { origin: "https://evil.example" },
    { origin: "null" },
    { origin: "garbage" },
    { origin: "https://localhost.evil.example" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site", origin: "https://other.localhost" },
    { "sec-fetch-site": "cross-site", origin: `http://localhost:${port}` },
  ]) {
    const r = await tryLogin(h);
    assert.equal(r.status, 403, JSON.stringify(h));
    assert.equal(r.headers["set-cookie"], undefined, JSON.stringify(h));
    assert.match(r.body, /another website/);
  }
  // Those did not use up the rate limit (max 2): two wrong + one right still work.
  assert.equal((await tryLogin({}, "wrong")).status, 401);
  assert.equal((await tryLogin({ origin: `http://localhost:${port}`, "sec-fetch-site": "same-origin" }, "wrong")).status, 401);
  assert.equal((await tryLogin({})).status, 429);

  // The real login form (same origin; any port the proxy may have dropped) works.
  const fresh = await start();
  for (const h of [
    { origin: `http://localhost:${fresh.port}`, "sec-fetch-site": "same-origin" },
    { origin: "https://LOCALHOST" },
    { "sec-fetch-site": "none" },
    {},
  ]) {
    const r = await request(fresh.port, "POST", "/login", { headers: { ...FORM, ...h }, body: form({ password: PASSWORD }) });
    assert.equal(r.status, 303, JSON.stringify(h));
  }
  // Behind a trusted proxy the forwarded host counts.
  const r = await request(fresh.port, "POST", "/login", {
    headers: { ...FORM, origin: "https://game.example", "x-forwarded-host": "game.example", host: "toon-town:8080" },
    body: form({ password: PASSWORD }),
  });
  assert.equal(r.status, 303);
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
test("rate limit: 10 failures per client (as reported by the proxy), then 429", async () => {
  const { port, logs } = await start();
  const attempt = (ip, password = "wrong") =>
    request(port, "POST", "/login", { headers: { ...FORM, "x-forwarded-for": ip }, body: form({ password }) });

  for (let i = 1; i <= 10; i++) assert.equal((await attempt("203.0.113.5")).status, 401, `try ${i}`);
  const blocked = await attempt("203.0.113.5");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["retry-after"]) > 800);
  assert.match(blocked.body, /too many tries/);
  // Even the right password is refused while blocked (no oracle).
  const right = await attempt("203.0.113.5", PASSWORD);
  assert.equal(right.status, 429);
  assert.equal(right.headers["set-cookie"], undefined);
  // IPv4-mapped IPv6 is the same client.
  assert.equal((await attempt("::ffff:203.0.113.5")).status, 429);
  // Somebody else is not affected (each friend has their own budget).
  assert.equal((await attempt("203.0.113.6", PASSWORD)).status, 303);
  // Logged once per block, not per request.
  assert.equal(logs.filter((l) => l.includes("login blocked")).length, 1);

  // IPv6: one /64 is one client.
  for (let i = 0; i < 10; i++) await attempt("2001:db8:1:2::1");
  assert.equal((await attempt("2001:db8:1:2:abcd:ef01:2345:6789")).status, 429);
  assert.equal((await attempt("2001:0db8:0001:0002::ffff")).status, 429);
  assert.equal((await attempt("2001:db8:1:3::1")).status, 401);

  // Proxy chain: only the address our proxy saw counts, not what the client claimed.
  for (let i = 0; i < 10; i++) await attempt(`10.9.9.${i}, 198.51.100.20`);
  assert.equal((await attempt("1.1.1.1, 198.51.100.20")).status, 429);
});

test("rate limit: spoofed X-Forwarded-For from an untrusted client doesn't reset the budget", async () => {
  const { port } = await start({ trustProxy: false });
  for (let i = 0; i < 10; i++) {
    await request(port, "POST", "/login", { headers: { ...FORM, "x-forwarded-for": `198.51.100.${i}` }, body: form({ password: "x" }) });
  }
  const r = await request(port, "POST", "/login", { headers: { ...FORM, "x-forwarded-for": "198.51.100.99" }, body: form({ password: PASSWORD }) });
  assert.equal(r.status, 429);
});

test("rate limit: window expires; memory stays bounded", async () => {
  const { port } = await start({ loginLimit: { max: 2, windowMs: 300 } });
  const attempt = () => request(port, "POST", "/login", { headers: FORM, body: form({ password: "x" }) });
  await attempt();
  await attempt();
  assert.equal((await attempt()).status, 429);
  await new Promise((r) => setTimeout(r, 350));
  assert.equal((await attempt()).status, 401);

  const limiter = createLoginLimiter({ max: 3, windowMs: 60_000, maxEntries: 50 });
  for (let i = 0; i < 5000; i++) limiter.fail(`k${i}`);
  assert.ok(limiter.size <= 50, `limiter grew to ${limiter.size}`);
  limiter.stop();
});

// ---------------------------------------------------------------------------
// Request size
// ---------------------------------------------------------------------------
test("oversized / odd login bodies are rejected cleanly", async () => {
  const { port } = await start();
  const big = await request(port, "POST", "/login", { headers: FORM, body: form({ password: "x".repeat(9000) }) });
  assert.equal(big.status, 413);
  assert.equal(big.body, "Request too large\n");
  const many = await request(port, "POST", "/login", {
    headers: FORM,
    body: Array.from({ length: 30 }, (_, i) => `f${i}=1`).join("&"),
  });
  assert.equal(many.status, 413);
  const charset = await request(port, "POST", "/login", {
    headers: { "content-type": "application/x-www-form-urlencoded; charset=ibm500" },
    body: "password=x",
  });
  assert.equal(charset.status, 415);
  assert.equal(charset.body, "Bad request\n");
  const brokenEnc = await request(port, "POST", "/login", { headers: FORM, body: "password=%E0%A4%A&next=%" });
  assert.equal(brokenEnc.status, 401);
  // Gzip-encoded bodies are not inflated for us.
  const gz = await request(port, "POST", "/login", { headers: { ...FORM, "content-encoding": "gzip" }, body: "junk" });
  assert.ok([400, 415].includes(gz.status), `gzip body -> ${gz.status}`);
  for (const r of [big, many, charset, gz]) assert.ok(!NO_LEAK.test(r.body), r.body);
});

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
test("static: path traversal, encodings, dotfiles, symlinks, directories", async () => {
  const { port } = await start();
  const token = (await login(port)).split("=")[1];
  const get = (p, h = {}) => request(port, "GET", p, { headers: { ...cookie(token), ...h } });

  const attacks = [
    "/../secret.txt",
    "/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/%2E%2E%2Fsecret.txt",
    "/..%2fsecret.txt",
    "/..%2Fsecret.txt",
    "/..%5csecret.txt",
    "/%5c..%5csecret.txt",
    "/%252e%252e/secret.txt",
    "/%252e%252e%252fsecret.txt",
    "/assets/%2e%2e/%2e%2e/secret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/%c0%ae%c0%ae/secret.txt",
    "/.%2e/secret.txt",
    "/../dist-sibling/secret2.txt",
    "/%2e%2e/dist-sibling/secret2.txt",
    "/link.txt",
    "/.hidden",
    "/%2ehidden",
    "/sub/../.hidden",
    "/index.html%00.txt",
    "/%00",
    "/sub",
    "/sub/",
    "/assets",
    "/assets/",
    "/.git/config",
    "/../server/server.js",
  ];
  for (const p of attacks) {
    const r = await get(p);
    assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.includes(SECRET_TEXT) && !r.body.includes(HIDDEN_TEXT) && !r.body.includes("sub file"), `${p} leaked a file`);
    assert.ok(!NO_LEAK.test(r.body), `${p} leaks internals`);
  }
  const bad = await get("/%E0%A4%A");
  assert.equal(bad.status, 400);
  assert.equal(bad.body, "Bad request\n");

  // A symlinked precompressed variant that points outside dist is ignored.
  const evil = await get("/assets/evil.js", { "accept-encoding": "br, gzip" });
  assert.equal(evil.status, 200);
  assert.equal(evil.headers["content-encoding"], undefined);
  assert.equal(evil.body, "console.log('evil identity')");
  // Symlinks that stay inside dist are fine.
  assert.equal((await get("/inner-link.txt")).body, "sub file");

  // 404 page (HTML for browsers, text otherwise).
  const nf = await get("/nope", { accept: "text/html" });
  assert.equal(nf.status, 404);
  assert.match(nf.body, /Wrong turn/);
  assert.equal((await get("/nope", { accept: "application/json" })).body, "Not found\n");
});

test("static: precompressed variants, content types, caching, HEAD, ranges", async () => {
  const { port } = await start();
  const token = (await login(port)).split("=")[1];
  const get = (p, h = {}, m = "GET") => request(port, m, p, { headers: { ...cookie(token), ...h } });

  const br = await get("/assets/app.js", { "accept-encoding": "gzip, deflate, br, zstd" });
  assert.equal(br.headers["content-encoding"], "br");
  assert.equal(br.body, "BROTLI-BYTES");
  assert.match(br.headers["content-type"], /javascript/);
  assert.match(br.headers.vary ?? "", /Accept-Encoding/i);
  assert.equal(br.headers["cache-control"], "private, max-age=31536000, immutable");

  const gz = await get("/assets/app.js", { "accept-encoding": "br;q=0, gzip" });
  assert.equal(gz.headers["content-encoding"], "gzip");
  const id = await get("/assets/app.js", { "accept-encoding": "identity" });
  assert.equal(id.headers["content-encoding"], undefined);
  assert.equal(id.body, "console.log('identity')");
  const star0 = await get("/assets/app.js", { "accept-encoding": "*;q=0" });
  assert.equal(star0.headers["content-encoding"], undefined);

  // Ranges only for identity responses (a range of a .br file is meaningless).
  const rangeBr = await get("/assets/app.js", { "accept-encoding": "br", range: "bytes=0-3" });
  assert.equal(rangeBr.status, 200);
  const rangeId = await get("/assets/app.js", { "accept-encoding": "identity", range: "bytes=0-3" });
  assert.equal(rangeId.status, 206);
  assert.equal(rangeId.body, "cons");

  const index = await get("/");
  assert.equal(index.headers["cache-control"], "private, no-cache");
  assert.match(index.headers["content-type"], /text\/html/);
  const css = await get("/assets/style.css");
  assert.match(css.headers["content-type"], /text\/css/);

  const head = await get("/assets/app.js", { "accept-encoding": "br" }, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-encoding"], "br");

  // Conditional GET.
  const etag = id.headers.etag;
  assert.ok(etag);
  assert.equal((await get("/assets/app.js", { "accept-encoding": "identity", "if-none-match": etag })).status, 304);

  // Logged-in OPTIONS doesn't advertise anything either.
  const opt = await get("/", {}, "OPTIONS");
  assert.equal(opt.status, 404);
  assert.equal(opt.headers.allow, undefined);
});

// ---------------------------------------------------------------------------
// Timeouts and the real process
// ---------------------------------------------------------------------------
test("slowloris: a client dribbling headers is cut off", async () => {
  const defaults = createHttpServer(createApp({ password: "x", distDir: dist, log: () => {} }));
  assert.ok(defaults.headersTimeout > 0 && defaults.headersTimeout <= 20_000);
  assert.ok(defaults.requestTimeout > 0 && defaults.requestTimeout <= 30_000);
  assert.ok(defaults.timeout > 0);

  const { port } = await start({
    serverOptions: { headersTimeout: 600, requestTimeout: 800, connectionsCheckingInterval: 100 },
  });
  const t0 = Date.now();
  const closedAfter = await new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write("GET / HTTP/1.1\r\nHost: x\r\n");
      const drip = setInterval(() => !sock.destroyed && sock.write("X-A: b\r\n"), 100);
      sock.on("close", () => {
        clearInterval(drip);
        resolve(Date.now() - t0);
      });
    });
    sock.resume();
    sock.on("error", () => {}); // a reset is just as good as a close
    setTimeout(() => reject(new Error("socket still open after 5 s")), 5000).unref();
  });
  assert.ok(closedAfter < 3000, `closed after ${closedAfter} ms`);
});

/** Picks a free TCP port. */
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function runServer(env) {
  const child = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, exited, output: () => out };
}

test("process: refuses to start in production without a password", async () => {
  const { exited, output } = runServer({ NODE_ENV: "production", DIST_DIR: dist });
  assert.equal(await exited, 1);
  assert.match(output(), /GAME_PASSWORD is not set/);
});

test("process: serves, never prints the password, shuts down on SIGTERM", async () => {
  const port = await freePort();
  const { child, exited, output } = runServer({
    NODE_ENV: "production",
    GAME_PASSWORD: PASSWORD,
    SESSION_SECRET: SECRET,
    PORT: String(port),
    DIST_DIR: dist,
  });
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 100));
    up = await request(port, "GET", "/healthz").then((r) => r.body === "ok", () => false);
  }
  assert.ok(up, `server did not come up:\n${output()}`);
  await login(port);
  // An idle keep-alive connection (how a reverse proxy pools them) must not hold up shutdown.
  const idle = net.connect(port, "127.0.0.1");
  idle.on("error", () => {});
  idle.resume();
  await new Promise((r) => idle.on("connect", r));
  idle.write("GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n");
  await new Promise((r) => idle.once("data", r));
  const t0 = Date.now();
  child.kill("SIGTERM");
  assert.equal(await exited, 0);
  assert.ok(Date.now() - t0 < 3000, "shutdown took too long");
  idle.destroy();
  assert.match(output(), /SIGTERM received/);
  assert.ok(!output().includes(PASSWORD), "password printed to the log");
});
