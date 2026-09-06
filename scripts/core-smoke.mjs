import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fakeProxyPort = 8891;
const corePort = 8892;
const pairingToken = "pairing-token-for-smoke-only";
const sessionSecret = "session-secret-for-smoke-only-32bytes";
const root = mkdtempSync(join(tmpdir(), "webai-core-smoke-"));
const workspace = join(root, "workspace");
const stateDir = join(root, "state");
mkdirSync(join(workspace, "src"), { recursive: true });
writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "core-smoke", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2));
writeFileSync(join(workspace, "src", "app.js"), "export const value = 'old';\n");

const fakeProxy = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/api/typhoon/chat") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "not_found" }));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const system = body?.messages?.[0]?.content || "";
  const content = system.includes("Native Worker")
    ? JSON.stringify({ summary: "Update fixture", files: [{ path: "src/app.js", content: "export const value = 'new';\n" }] })
    : JSON.stringify({ summary: "Plan fixture update", steps: [{ title: "Update src/app.js", acceptance: "value becomes new" }], risks: [] });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ model: "fake", choices: [{ message: { content } }] }));
});

await new Promise((resolve) => fakeProxy.listen(fakeProxyPort, "127.0.0.1", resolve));

const core = spawn(process.execPath, ["server/core.mjs"], {
  env: {
    ...process.env,
    CORE_PORT: String(corePort),
    TYPHOON_PROXY_BASE_URL: `http://127.0.0.1:${fakeProxyPort}`,
    WEBAI_WORKSPACE: workspace,
    WEBAI_NATIVE_WORKER_ENABLED: "true",
    WEBAI_CORE_STATE_DIR: stateDir,
    WEBAI_CORE_PAIRING_TOKEN: pairingToken,
    WEBAI_CORE_SESSION_SECRET: sessionSecret,
    CORE_ALLOWED_ORIGINS: "https://nustanakritwithai.github.io",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    await wait(100);
    try {
      const response = await fetch(`http://127.0.0.1:${corePort}/api/health`);
      if (response.ok) return response.json();
    } catch {}
  }
  throw new Error("core health did not become ready");
}

async function openSession(clientId, token = pairingToken) {
  const response = await fetch(`http://127.0.0.1:${corePort}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://nustanakritwithai.github.io" },
    body: JSON.stringify({ pairingToken: token, clientId }),
  });
  return { response, data: await response.json() };
}

async function createBootstrap(clientId, token = pairingToken) {
  const response = await fetch(`http://127.0.0.1:${corePort}/api/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://nustanakritwithai.github.io" },
    body: JSON.stringify({ pairingToken: token, clientId }),
  });
  return { response, data: await response.json() };
}

async function exchangeBootstrap(code, clientId) {
  const response = await fetch(`http://127.0.0.1:${corePort}/api/session/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://nustanakritwithai.github.io" },
    body: JSON.stringify({ code, clientId }),
  });
  return { response, data: await response.json() };
}

async function coreRequest(path, sessionToken, method = "GET", body) {
  const headers = { "Content-Type": "application/json", "x-webai-session": sessionToken, Origin: "https://nustanakritwithai.github.io" };
  const response = await fetch(`http://127.0.0.1:${corePort}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}

try {
  const health = await waitForHealth();
  if (!health.ok || health.service !== "webai-core" || health.capabilities?.nativeWorker?.configured !== true || health.capabilities?.sessionAuth?.configured !== true) {
    throw new Error("core health contract failed");
  }

  const unauth = await fetch(`http://127.0.0.1:${corePort}/api/tasks`);
  if (unauth.status !== 401 || (await unauth.json()).error !== "session_required") throw new Error("task API is not session protected");

  const denied = await openSession("client_owner_000000000001", "wrong-token");
  if (denied.response.status !== 401 || denied.data.error !== "pairing_denied") throw new Error("pairing token rejection failed");

  const bootstrapDenied = await createBootstrap("client_bootstrap_00001", "wrong-token");
  if (bootstrapDenied.response.status !== 401 || bootstrapDenied.data.error !== "pairing_denied") throw new Error("bootstrap pairing rejection failed");
  const bootstrap = await createBootstrap("client_bootstrap_00001");
  if (bootstrap.response.status !== 201 || !bootstrap.data.code || !bootstrap.data.expiresAt || JSON.stringify(bootstrap.data).includes(pairingToken)) {
    throw new Error("bootstrap creation failed or leaked pairing token");
  }
  const bootstrapWrongClient = await exchangeBootstrap(bootstrap.data.code, "client_bootstrap_00002");
  if (bootstrapWrongClient.response.status !== 401 || bootstrapWrongClient.data.error !== "bootstrap_denied") throw new Error("bootstrap owner binding failed");
  const bootstrapSession = await exchangeBootstrap(bootstrap.data.code, "client_bootstrap_00001");
  if (bootstrapSession.response.status !== 201 || !bootstrapSession.data.sessionToken) throw new Error("bootstrap exchange failed");
  const bootstrapReuse = await exchangeBootstrap(bootstrap.data.code, "client_bootstrap_00001");
  if (bootstrapReuse.response.status !== 401 || bootstrapReuse.data.error !== "bootstrap_denied") throw new Error("bootstrap was reusable");

  const ownerA = await openSession("client_owner_000000000001");
  if (ownerA.response.status !== 201 || !ownerA.data.sessionToken) throw new Error("owner A session failed");
  const ownerB = await openSession("client_owner_000000000002");
  if (ownerB.response.status !== 201 || !ownerB.data.sessionToken) throw new Error("owner B session failed");

  const created = await coreRequest("/api/tasks", ownerA.data.sessionToken, "POST", { goal: "Update fixture safely" });
  if (created.response.status !== 201 || created.data.task?.status !== "awaiting_approval") throw new Error("task planning failed");
  const taskId = created.data.task.id;

  const crossOwner = await coreRequest(`/api/tasks/${encodeURIComponent(taskId)}`, ownerB.data.sessionToken);
  if (crossOwner.response.status !== 404 || crossOwner.data.error !== "task_not_found") throw new Error("owner isolation failed");

  const approved = await coreRequest(`/api/tasks/${encodeURIComponent(taskId)}/approve`, ownerA.data.sessionToken, "POST");
  if (approved.response.status !== 200 || approved.data.task?.status !== "awaiting_verification") throw new Error("native worker approval failed");
  if (readFileSync(join(workspace, "src", "app.js"), "utf8") !== "export const value = 'new';\n") throw new Error("native worker did not change workspace");

  const verified = await coreRequest(`/api/tasks/${encodeURIComponent(taskId)}/verify`, ownerA.data.sessionToken, "POST");
  if (verified.response.status !== 200 || verified.data.task?.status !== "completed" || verified.data.task?.verification?.ok !== true) {
    throw new Error("verification gate failed");
  }

  const listedA = await coreRequest("/api/tasks", ownerA.data.sessionToken);
  const listedB = await coreRequest("/api/tasks", ownerB.data.sessionToken);
  if (listedA.data.tasks?.length !== 1 || listedB.data.tasks?.length !== 0) throw new Error("owner-scoped task listing failed");

  console.log("CORE SMOKE PASS: signed sessions, one-time bootstrap, owner isolation, proxy planning, native worker, verification");
} finally {
  core.kill("SIGTERM");
  await new Promise((resolve) => fakeProxy.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
