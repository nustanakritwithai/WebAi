import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { createAgentService } from "./agent.mjs";

const PORT = Number(process.env.PORT || "8787");
const DEFAULT_BASE_URL = "https://api.opentyphoon.ai/v1";
const DEFAULT_MODEL = "typhoon-v2.5-30b-a3b-instruct";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 12_000;
const REQUESTS_PER_MINUTE = 30;
const UPSTREAM_TIMEOUT_MS = 60_000;
const VERIFICATION_TIMEOUT_MS = 180_000;
const VERIFICATION_OUTPUT_CHARS = 12_000;
const buckets = new Map();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
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
const WEB_AUTH_TOKEN = process.env.WEB_AUTH_TOKEN || "";
const WEBAI_WORKSPACE = process.env.WEBAI_WORKSPACE || "";
const WEBAI_NATIVE_WORKER_ENABLED = envBool("WEBAI_NATIVE_WORKER_ENABLED");
const AGENT_STATE_PATH = process.env.AGENT_STATE_PATH || resolve(process.cwd(), ".webai", "agent-state.json");

const ECC_ENABLED = envBool("ECC_ENABLED");
const ECC_ROOT = process.env.ECC_ROOT || "";
const HERMES_ENABLED = envBool("HERMES_ENABLED");
const HERMES_HOME = process.env.HERMES_HOME || "";
const OPENCLAW_ENABLED = envBool("OPENCLAW_ENABLED");
const OPENCLAW_URL = process.env.OPENCLAW_URL || "";
const HARPOON_ENABLED = envBool("HARPOON_ENABLED");
const HARPOON_URL = process.env.HARPOON_URL || "";
const PREVIEW_ENABLED = envBool("PREVIEW_ENABLED");
const PREVIEW_BASE_URL = process.env.PREVIEW_BASE_URL || "";

const SAFE_ORIGINS = new Set(["https://nustanakritwithai.github.io"]);
const configuredOrigins = (process.env.ALLOWED_ORIGINS || "https://nustanakritwithai.github.io")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

for (const origin of configuredOrigins) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("ALLOWED_ORIGINS contains an invalid origin");
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    && ["http:", "https:"].includes(url.protocol);
  if (!SAFE_ORIGINS.has(origin) && !isLocal) {
    throw new Error("ALLOWED_ORIGINS contains an unsupported origin");
  }
}

function allowedOrigin(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, "");
  if (configuredOrigins.includes(normalized)) {
    if (SAFE_ORIGINS.has(normalized)) return true;
    try {
      const url = new URL(normalized);
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        && ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }
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
    "Access-Control-Allow-Headers": "content-type,x-webai-token",
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

function authOk(req) {
  return !WEB_AUTH_TOKEN || req.headers["x-webai-token"] === WEB_AUTH_TOKEN;
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

function workspaceConfigured() {
  return Boolean(WEBAI_WORKSPACE) && existsSync(WEBAI_WORKSPACE);
}

function capabilityRegistry() {
  const workspaceReady = workspaceConfigured();
  const nativeReady = WEBAI_NATIVE_WORKER_ENABLED && workspaceReady;
  return {
    typhoon: {
      enabled: true,
      configured: Boolean(TYPHOON_API_KEY),
      model: TYPHOON_MODEL,
    },
    webaiCore: {
      enabled: true,
      configured: Boolean(TYPHOON_API_KEY),
      lifecycle: "supervised",
    },
    nativeWorker: {
      enabled: WEBAI_NATIVE_WORKER_ENABLED,
      configured: nativeReady,
      mode: "guarded-file-worker",
    },
    ecc: {
      enabled: ECC_ENABLED,
      configured: ECC_ENABLED && Boolean(ECC_ROOT),
    },
    hermes: {
      enabled: HERMES_ENABLED,
      configured: HERMES_ENABLED && Boolean(HERMES_HOME),
    },
    openclaw: {
      enabled: OPENCLAW_ENABLED,
      configured: OPENCLAW_ENABLED && Boolean(OPENCLAW_URL),
    },
    harpoon: {
      enabled: HARPOON_ENABLED,
      configured: HARPOON_ENABLED && Boolean(HARPOON_URL),
    },
    preview: {
      enabled: PREVIEW_ENABLED,
      configured: PREVIEW_ENABLED && Boolean(PREVIEW_BASE_URL),
    },
  };
}

function safeChildEnvironment() {
  const allowedNames = ["PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  return Object.fromEntries(allowedNames
    .filter((name) => typeof process.env[name] === "string" && process.env[name])
    .map((name) => [name, process.env[name]]));
}

async function unavailableLegacyWorker() {
  throw Object.assign(new Error("native_worker_disabled"), { status: 503 });
}

function runVerification() {
  if (!workspaceConfigured()) {
    throw Object.assign(new Error("workspace_not_configured"), { status: 503 });
  }

  return new Promise((resolveResult, reject) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(command, ["test"], {
      cwd: WEBAI_WORKSPACE,
      env: safeChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const append = (chunk) => {
      if (output.length < VERIFICATION_OUTPUT_CHARS) output += String(chunk).slice(0, VERIFICATION_OUTPUT_CHARS - output.length);
    };
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finishError(Object.assign(new Error("verification_timeout"), { status: 504 }));
    }, VERIFICATION_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", () => finishError(Object.assign(new Error("verification_spawn_failed"), { status: 503 })));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({ ok: code === 0, command: "npm test", exitCode: code, output });
    });
  });
}

const agentService = createAgentService({
  requestModel: requestTyphoon,
  runWorker: unavailableLegacyWorker,
  runVerification,
  statePath: AGENT_STATE_PATH,
});

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
    const capabilities = capabilityRegistry();
    return send(req, res, 200, {
      ok: true,
      version: "0.4.0",
      provider: "opentyphoon",
      model: TYPHOON_MODEL,
      keyConfigured: capabilities.typhoon.configured,
      typhoonConfigured: capabilities.typhoon.configured,
      workspaceConfigured: workspaceConfigured(),
      nativeWorkerEnabled: capabilities.nativeWorker.enabled,
      nativeWorkerConfigured: capabilities.nativeWorker.configured,
      authEnabled: Boolean(WEB_AUTH_TOKEN),
      core: agentService.status(),
      agent: agentService.status(),
      capabilities,
    });
  }

  if (req.method === "GET" && url.pathname === "/") {
    return send(req, res, 200, { name: "WebAi Core API", version: "0.4.0", health: "/api/health" });
  }

  if (!withinRateLimit(req)) {
    return send(req, res, 429, { error: "rate_limited" }, { "Retry-After": "60" });
  }
  if (!authOk(req)) {
    return send(req, res, 401, { error: "unauthorized" });
  }

  try {
    if (req.method === "POST" && url.pathname === "/api/typhoon/chat") {
      if (req.headers.authorization || req.headers["x-api-key"]) {
        return send(req, res, 400, { error: "client_authorization_not_allowed" });
      }
      const chat = validateChat(await readJson(req));
      return send(req, res, 200, await requestTyphoon(chat));
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const chat = validateChat(await readJson(req));
      const raw = await requestTyphoon(chat);
      return send(req, res, 200, {
        provider: "opentyphoon",
        model: raw.model || TYPHOON_MODEL,
        content: raw?.choices?.[0]?.message?.content || "",
        usage: raw.usage || null,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/plan") {
      const body = await readJson(req);
      const goal = String(body.goal || "").trim();
      if (!goal) return send(req, res, 400, { error: "goal_required" });
      const raw = await requestTyphoon({
        messages: [
          { role: "system", content: "Create a concise software implementation plan with acceptance criteria. Respond in the user's language." },
          { role: "user", content: goal.slice(0, MAX_CONTENT_CHARS) },
        ],
        temperature: 0.2,
        max_tokens: 4096,
      });
      return send(req, res, 200, {
        provider: "opentyphoon",
        model: raw.model || TYPHOON_MODEL,
        plan: raw?.choices?.[0]?.message?.content || "",
      });
    }

    const isTaskCollection = url.pathname === "/api/tasks" || url.pathname === "/api/agent/tasks";
    const taskMatch = url.pathname.match(/^\/api\/(?:agent\/)?tasks\/([^/]+)(?:\/(approve|verify))?$/);
    if (isTaskCollection && req.method === "POST") {
      const task = await agentService.createTask(await readJson(req));
      return send(req, res, 201, { task });
    }
    if (isTaskCollection && req.method === "GET") {
      return send(req, res, 200, { tasks: agentService.listTasks() });
    }
    if (taskMatch) {
      const taskId = decodeURIComponent(taskMatch[1]);
      const action = taskMatch[2];
      if (req.method === "GET" && !action) {
        return send(req, res, 200, { task: agentService.getTask(taskId) });
      }
      if (req.method === "POST" && action === "approve") {
        return send(req, res, 200, { task: await agentService.approveAndExecute(taskId) });
      }
      if (req.method === "POST" && action === "verify") {
        return send(req, res, 200, { task: await agentService.verify(taskId) });
      }
      return send(req, res, 405, { error: "method_not_allowed" }, { Allow: "GET, POST, OPTIONS" });
    }

    if (url.pathname === "/api/typhoon/chat" || url.pathname === "/api/chat" || url.pathname === "/api/plan" || isTaskCollection) {
      return send(req, res, 405, { error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });
    }

    return send(req, res, 404, { error: "not_found" });
  } catch (error) {
    const status = Number(error?.status) || (error?.name === "AbortError" ? 504 : 502);
    return send(req, res, status, { error: error?.message || "upstream_error" }, error?.retryAfter || {});
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const caps = capabilityRegistry();
  console.log(`WebAi Core API listening on 127.0.0.1:${PORT}`);
  console.log(`Typhoon configured: ${caps.typhoon.configured} | NativeWorker: ${caps.nativeWorker.enabled}/${caps.nativeWorker.configured}`);
});
