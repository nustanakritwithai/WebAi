import http from "node:http";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { URL } from "node:url";
import { createAgentService } from "./agent.mjs";
import { createSnapshotStore } from "./snapshot-store.mjs";

const PORT = Number(process.env.CORE_PORT || "8790");
const WORKSPACE = process.env.WEBAI_WORKSPACE || "";
const STATE_DIR = process.env.WEBAI_CORE_STATE_DIR || resolve(process.cwd(), ".webai", "owners");
const SNAPSHOT_DIR = process.env.WEBAI_CORE_SNAPSHOT_DIR || resolve(STATE_DIR, "..", "snapshots");
const PROXY_BASE = (process.env.TYPHOON_PROXY_BASE_URL || "").replace(/\/+$/, "");
const PROXY_TOKEN = process.env.TYPHOON_PROXY_TOKEN || "";
const PAIRING_TOKEN = process.env.WEBAI_CORE_PAIRING_TOKEN || "";
const SESSION_SECRET = process.env.WEBAI_CORE_SESSION_SECRET || "";
const SESSION_TTL_SECONDS = Math.min(Math.max(Number(process.env.WEBAI_CORE_SESSION_TTL_SECONDS || "43200"), 900), 604800);
const VERIFICATION_TIMEOUT_MS = 180_000;
const VERIFICATION_OUTPUT_CHARS = 12_000;
const REQUESTS_PER_MINUTE = 90;
const MAX_BODY_BYTES = 64 * 1024;
const services = new Map();
const buckets = new Map();
let workspaceQueue = Promise.resolve();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) throw new Error("CORE_PORT must be an integer between 1 and 65535");

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

const NATIVE_ENABLED = envBool("WEBAI_NATIVE_WORKER_ENABLED", true);
const snapshotStore = createSnapshotStore({ workspace: WORKSPACE, snapshotRoot: SNAPSHOT_DIR });

function withWorkspaceLock(operation) {
  const run = workspaceQueue.then(operation, operation);
  workspaceQueue = run.then(() => undefined, () => undefined);
  return run;
}

function validProxyBase() {
  if (!PROXY_BASE) return false;
  try {
    const url = new URL(PROXY_BASE);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

const SAFE_ORIGINS = new Set(["https://nustanakritwithai.github.io"]);
const configuredOrigins = (process.env.CORE_ALLOWED_ORIGINS || "https://nustanakritwithai.github.io")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

function allowedOrigin(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, "");
  if (!configuredOrigins.includes(normalized)) return false;
  if (SAFE_ORIGINS.has(normalized)) return true;
  try {
    const url = new URL(normalized);
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
    "Access-Control-Allow-Headers": "content-type,x-webai-session",
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

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("body_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) throw Object.assign(new Error("invalid_json"), { status: 400 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

function clientIp(req) {
  const remote = req.socket.remoteAddress || "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if ((remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") && typeof forwarded === "string") {
    return forwarded.split(",")[0].trim().slice(0, 64) || remote;
  }
  return remote;
}

function withinRateLimit(req) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `${clientIp(req)}:${minute}`;
  const count = (buckets.get(key) || 0) + 1;
  buckets.set(key, count);
  if (buckets.size > 5_000) {
    for (const bucketKey of buckets.keys()) if (!bucketKey.endsWith(`:${minute}`)) buckets.delete(bucketKey);
  }
  return count <= REQUESTS_PER_MINUTE;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function signSession(payload) {
  const encoded = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySession(token) {
  if (!SESSION_SECRET || typeof token !== "string") return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload?.v !== 1 || typeof payload.ownerId !== "string" || !Number.isInteger(payload.exp)) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function ownerSession(req) {
  const token = req.headers["x-webai-session"];
  const payload = verifySession(typeof token === "string" ? token : "");
  if (!payload) throw Object.assign(new Error("session_required"), { status: 401 });
  return payload;
}

function validClientId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value);
}

function ownerStatePath(ownerId) {
  const digest = createHash("sha256").update(ownerId).digest("hex");
  return join(STATE_DIR, `${digest}.json`);
}

function safeChildEnvironment() {
  const allowed = ["PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"];
  return Object.fromEntries(allowed
    .filter((name) => typeof process.env[name] === "string" && process.env[name])
    .map((name) => [name, process.env[name]]));
}

async function requestModel(chat) {
  if (!validProxyBase()) throw Object.assign(new Error("proxy_not_configured"), { status: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65_000);
  try {
    const headers = { "Content-Type": "application/json" };
    if (PROXY_TOKEN) headers["x-webai-token"] = PROXY_TOKEN;
    const response = await fetch(`${PROXY_BASE}/api/typhoon/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(chat),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Object.assign(new Error("proxy_invalid_response"), { status: 502 });
    }
    if (!response.ok) throw Object.assign(new Error(data?.error || "proxy_error"), { status: response.status === 429 ? 429 : 502 });
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("proxy_timeout"), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function runVerification() {
  if (!WORKSPACE || !existsSync(WORKSPACE)) throw Object.assign(new Error("workspace_not_configured"), { status: 503 });
  return new Promise((resolveResult, reject) => {
    const command = process.platform === "win32"
      ? (process.env.ComSpec || process.env.COMSPEC || "cmd.exe")
      : "npm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd test"]
      : ["test"];
    const child = spawn(command, args, {
      cwd: WORKSPACE,
      env: safeChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    const append = (chunk) => {
      if (output.length < VERIFICATION_OUTPUT_CHARS) output += String(chunk).slice(0, VERIFICATION_OUTPUT_CHARS - output.length);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(Object.assign(new Error("verification_timeout"), { status: 504 }));
    }, VERIFICATION_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", () => fail(Object.assign(new Error("verification_spawn_failed"), { status: 503 })));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ ok: code === 0, command: "npm test", exitCode: code, output });
    });
  });
}

async function unavailableWorker() {
  throw Object.assign(new Error("native_worker_disabled"), { status: 503 });
}

function serviceForOwner(ownerId) {
  if (services.has(ownerId)) return services.get(ownerId);
  const service = createAgentService({
    requestModel,
    runWorker: unavailableWorker,
    runVerification,
    statePath: ownerStatePath(ownerId),
    ownerId,
    snapshotStore,
    withWorkspaceLock,
  });
  services.set(ownerId, service);
  if (services.size > 100) services.delete(services.keys().next().value);
  return service;
}

function coreCapabilities() {
  const workspaceReady = Boolean(WORKSPACE) && existsSync(WORKSPACE);
  const authReady = Boolean(PAIRING_TOKEN) && Boolean(SESSION_SECRET);
  return {
    webaiCore: { enabled: true, configured: validProxyBase() && authReady, lifecycle: "supervised" },
    nativeWorker: { enabled: NATIVE_ENABLED, configured: NATIVE_ENABLED && workspaceReady, mode: "guarded-file-worker" },
    snapshotStore: { enabled: true, configured: workspaceReady && Boolean(SNAPSHOT_DIR), mode: "durable-transaction" },
    verification: { enabled: true, configured: workspaceReady, command: "npm test" },
    taskStore: { enabled: true, configured: Boolean(STATE_DIR), ownership: "signed-session" },
    sessionAuth: { enabled: true, configured: authReady, ttlSeconds: SESSION_TTL_SECONDS },
  };
}

await mkdir(STATE_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigin(origin)) return send(req, res, 403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (!withinRateLimit(req)) return send(req, res, 429, { error: "rate_limited" }, { "Retry-After": "60" });

  const url = new URL(req.url || "/", "http://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const capabilities = coreCapabilities();
      return send(req, res, 200, {
        ok: true,
        service: "webai-core",
        version: "0.6.0",
        configured: capabilities.webaiCore.configured,
        nativeWorkerConfigured: capabilities.nativeWorker.configured,
        snapshotConfigured: capabilities.snapshotStore.configured,
        authConfigured: capabilities.sessionAuth.configured,
        capabilities,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/session") {
      if (!PAIRING_TOKEN || !SESSION_SECRET) return send(req, res, 503, { error: "core_auth_not_configured" });
      const body = await readJson(req);
      if (!safeEqual(body?.pairingToken, PAIRING_TOKEN)) return send(req, res, 401, { error: "pairing_denied" });
      if (!validClientId(body?.clientId)) return send(req, res, 400, { error: "invalid_client_id" });
      const now = Math.floor(Date.now() / 1000);
      const exp = now + SESSION_TTL_SECONDS;
      const payload = { v: 1, ownerId: body.clientId, iat: now, exp, sid: randomUUID() };
      return send(req, res, 201, {
        sessionToken: signSession(payload),
        ownerId: payload.ownerId,
        expiresAt: new Date(exp * 1000).toISOString(),
      });
    }

    const session = ownerSession(req);
    const service = serviceForOwner(session.ownerId);
    const isCollection = url.pathname === "/api/tasks";
    const match = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(approve|verify|rollback))?$/);

    if (isCollection && req.method === "POST") {
      return send(req, res, 201, { task: await service.createTask(await readJson(req)) });
    }
    if (isCollection && req.method === "GET") {
      return send(req, res, 200, { tasks: service.listTasks() });
    }
    if (match) {
      const taskId = decodeURIComponent(match[1]);
      const action = match[2];
      if (req.method === "GET" && !action) return send(req, res, 200, { task: service.getTask(taskId) });
      if (req.method === "POST" && action === "approve") return send(req, res, 200, { task: await service.approveAndExecute(taskId) });
      if (req.method === "POST" && action === "verify") return send(req, res, 200, { task: await service.verify(taskId) });
      if (req.method === "POST" && action === "rollback") return send(req, res, 200, { task: await service.rollback(taskId) });
      return send(req, res, 405, { error: "method_not_allowed" });
    }

    return send(req, res, 404, { error: "not_found" });
  } catch (error) {
    return send(req, res, Number(error?.status) || 500, {
      error: error?.message || "core_error",
      ...(Array.isArray(error?.files) ? { files: error.files.slice(0, 16) } : {}),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const caps = coreCapabilities();
  console.log(`WebAi Core listening on 127.0.0.1:${PORT}`);
  console.log(`Proxy: ${validProxyBase()} | NativeWorker: ${caps.nativeWorker.configured} | Snapshot: ${caps.snapshotStore.configured} | SessionAuth: ${caps.sessionAuth.configured}`);
});
