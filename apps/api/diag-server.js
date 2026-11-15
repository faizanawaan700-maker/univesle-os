// Temporary diagnostic server: mirrors the real API's cookie + origin behavior
// so the browser cookie exchange can be observed without the full Nest app.
const http = require("node:http");
const { randomBytes } = require("node:crypto");

const PORT = 4300;
const FRONTEND_ORIGINS = ["http://127.0.0.1:3000", "http://localhost:3000"];
const SESSION_COOKIE = "ubos_session";
const tokens = new Set();
const log = [];

function readCookie(header, name) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": FRONTEND_ORIGINS.includes(origin) ? origin : FRONTEND_ORIGINS[0],
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-Organization-Id, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

function json(req, res, status, body, extra = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(req), ...extra });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.url !== "/diag") {
    log.push({
      method: req.method,
      url: req.url,
      origin: req.headers.origin,
      host: req.headers.host,
      hasCookie: Boolean(req.headers.cookie),
      accept: req.headers.accept,
    });
  }
  if (req.url === "/auth/register" && req.method === "POST") {
    const token = randomBytes(16).toString("base64url");
    tokens.add(token);
    json(req, res, 201, { user: { id: "x" } }, {
      "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(Date.now() + 86400000).toUTCString()}`,
    });
    return;
  }
  if (req.url === "/auth/me") {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token || !tokens.has(token)) {
      json(req, res, 401, { message: "Authentication is required." });
      return;
    }
    json(req, res, 200, { id: "x", email: "a@b.c", name: "A", organizations: [] });
    return;
  }
  if (req.url === "/same-site" && req.method === "POST") {
    json(req, res, 200, { receivedCookie: Boolean(readCookie(req.headers.cookie, SESSION_COOKIE)) });
    return;
  }
  if (req.url === "/diag") {
    json(req, res, 200, log.slice(-30));
    return;
  }
  json(req, res, 404, { message: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`diag server on ${PORT}\n`);
});
