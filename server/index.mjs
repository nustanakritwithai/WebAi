import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || "8787");
const DEFAULT_BASE_URL = "https://api.opentyphoon.ai/v1";
const DEFAULT_MODEL = "typhoon-v2.5-30b-a3b-instruct";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 12_000;
const REQUESTS_PER_MINUTE = 30;
const UPSTREAM_TIMEOUT_MS = 60_000;
const ALLOWED_ORIGIN = "https://nustanakritwithai.github.io";
const buckets = new Map();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

function configuredBaseUrl() {
  const configured = (process.env.TYPHOON_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("TYPHOON_BASE_URL is invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== "api.opentyphoon.ai" || url.pathname !== "/v1") {
    throw new Error("TYPHOON_BASE_URL must be https://api.opentyphoon.ai/v1");
  }
  return url.toString().replace(/\/$/, "");
}

const TYPHOON_BASE_URL = configuredBaseUrl();
const TYPHOON_MODEL = process.env.TYPHOON_MODEL || DEFAULT_MODEL;
const TYPHOON_API_KEY = process.env.TYPHOON_API_KEY || "";

function allowedOrigin(origin) {
  if (origin === ALLOWED_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function send(req, res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(req),
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  const remote = req.socket.remoteAddress || "unknown";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (!loopback) return remote;
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string") return remote;
  return forwarded.split(",")[0].trim().slice(0, 64) || remote;
}

function withinRateLimit(req) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `${clientIp(req)}:${minute}`;
  const count = (buckets.get(key) || 0) + 1;
  buckets.set(key, count);
  if (buckets.size > 5_000) {
    for (const bucketKey of buckets.keys()) {
      if (!bucketKey.endsWith(`:${minute}`)) buckets.delete(bucketKey);
    }
  }
  return count <= REQUESTS_PER_MINUTE;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("body_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) throw Object.assign(new Error("invalid_json"), { status: 400 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

function validateChat(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("invalid_request"), { status: 400 });
  }
  if ("authorization" in body || "apiKey" in body || "api_key" in body || "provider" in body || "model" in body || "baseUrl" in body || "base_url" in body) {
    throw Object.assign(new Error("server_controlled_field_not_allowed"), { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > MAX_MESSAGES) {
    throw Object.assign(new Error("invalid_messages"), { status: 400 });
  }
  const messages = body.messages.map((message) => {
    if (!message || typeof message !== "object" || !["system", "user", "assistant"].includes(message.role)
      || typeof message.content !== "string" || !message.content.trim() || message.content.length > MAX_CONTENT_CHARS) {
      throw Object.assign(new Error("invalid_messages"), { status: 400 });
    }
    return { role: message.role, content: message.content };
  });
  const temperature = body.temperature === undefined ? 0.2 : body.temperature;
  const maxTokens = body.max_tokens === undefined ? 4096 : body.max_tokens;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw Object.assign(new Error("invalid_temperature"), { status: 400 });
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) {
    throw Object.assign(new Error("invalid_max_tokens"), { status: 400 });
  }
  return { messages, temperature, max_tokens: maxTokens };
}

async function requestTyphoon(chat) {
  if (!TYPHOON_API_KEY) throw Object.assign(new Error("service_unavailable"), { status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${TYPHOON_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TYPHOON_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: TYPHOON_MODEL, ...chat }),
      signal: controller.signal,
    });
    const responseText = await upstream.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      throw Object.assign(new Error("invalid_upstream_response"), { status: 502 });
    }
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      const retryAfter = upstream.status === 429 && /^\d{1,4}$/.test(upstream.headers.get("retry-after") || "")
        ? { "Retry-After": upstream.headers.get("retry-after") }
        : {};
      throw Object.assign(new Error("upstream_error"), { status, retryAfter });
    }
    return responseJson;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("upstream_timeout"), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigin(origin)) {
    return send(req, res, 403, { error: "origin_not_allowed" });
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(req, res, 200, { ok: true, provider: "opentyphoon", keyConfigured: Boolean(TYPHOON_API_KEY) });
  }
  if (url.pathname === "/api/typhoon/chat" && req.method !== "POST") {
    return send(req, res, 405, { error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });
  }
  if (req.method !== "POST" || url.pathname !== "/api/typhoon/chat") {
    return send(req, res, 404, { error: "not_found" });
  }
  if (req.headers.authorization || req.headers["x-api-key"]) {
    return send(req, res, 400, { error: "client_authorization_not_allowed" });
  }
  if (!withinRateLimit(req)) {
    return send(req, res, 429, { error: "rate_limited" }, { "Retry-After": "60" });
  }
  try {
    const chat = validateChat(await readJson(req));
    return send(req, res, 200, await requestTyphoon(chat));
  } catch (error) {
    const status = Number(error?.status) || 502;
    return send(req, res, status, { error: error?.message || "upstream_error" }, error?.retryAfter || {});
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`WebAi Typhoon proxy listening on 127.0.0.1:${PORT}`);
});
