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
const snapshotDir = join(root, "snapshots");
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
    WEBAI_CORE_SNAPSHOT_DIR: snapshotDir,
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

async function coreRequest(path, sessionToken, method = "GET", body) {
  const headers = { "Content-Type": "application/json", "x-webai-session": sessionToken, Origin: "https://nustanakritwithai.github.io" };
  const response = await fetch(`http://127.0.0.1:${corePort}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}

async function createAndApprove(sessionToken, goal) {
  const created = await coreRequest("/api/tasks", sessionToken, "POST", { goal });
  if (created.response.status !== 201 || created.data.task?.status !== "awaiting_approval") throw new Error("task planning failed");
  const taskId = created.data.task.id;
  const approved = await coreRequest(`/api/tasks/${encodeURIComponent(taskId)}/approve`, sessionToken, "POST");
  if (approved.response.status !== 200 || approved.data.task?.status !== "awaiting_verification") throw new Error("native worker approval failed");
  const execution = approved.data.task?.executions?.at?.(-1) || approved.data.task?.executions?.[approved.data.task.executions.length - 1];
  if (!execution?.executionId || !execution?.snapshotId || execution.status !== "applied" || !execution.files?.length) {
    throw new Error("transaction evidence missing after approval");
  }
  const file = execution.files[0];
  if (file.path !== "src/app.js"
    || typeof file.beforeSha256 !== "string" || file.beforeSha256.length !== 64
    || typeof file.afterSha256 !== "string" || file.afterSha256.length !== 64
    || typeof file.diffKind !== "string"
    || typeof file.diffExact !== "boolean"
    || !(file.additions === null || Number.isInteger(file.additions))
    || !(file.deletions === null || Number.isInteger(file.deletions))) {
    throw new Error("bounded file diff evidence missing after approval");
  }
  return { taskId, approved: approved.data.task };
}

try {
  const health = await waitForHealth();
  if (!health.ok
    || health.service !== "webai-core"
    || health.capabilities?.nativeWorker?.configured !== true
    || health.capabilities?.snapshotStore?.configured !== true
    || health.capabilities?.sessionAuth?.configured !== true) {
    throw new Error("core health contract failed");
  }

  const unauth = await fetch(`http://127.0.0.1:${corePort}/api/tasks`);
  if (unauth.status !== 401 || (await unauth.json()).error !== "session_required") throw new Error("task API is not session protected");

  const denied = await openSession("client_owner_000000000001", "wrong-token");
  if (denied.response.status !== 401 || denied.data.error !== "pairing_denied") throw new Error("pairing token rejection failed");

  const ownerA = await openSession("client_owner_000000000001");
  if (ownerA.response.status !== 201 || !ownerA.data.sessionToken) throw new Error("owner A session failed");
  const ownerB = await openSession("client_owner_000000000002");
  if (ownerB.response.status !== 201 || !ownerB.data.sessionToken) throw new Error("owner B session failed");

  // Transaction 1: apply, expose exact diff evidence, then roll back successfully.
  const first = await createAndApprove(ownerA.data.sessionToken, "Update fixture safely, then allow rollback");
  const firstFile = first.approved.executions.at(-1).files[0];
  if (firstFile.changed !== true || firstFile.additions !== 1 || firstFile.deletions !== 1 || firstFile.diffExact !== true || firstFile.diffKind !== "line-exact") {
    throw new Error("exact line diff evidence failed for modified text file");
  }
  if (readFileSync(join(workspace, "src", "app.js"), "utf8") !== "export const value = 'new';\n") throw new Error("native worker did not change workspace");

  const crossOwnerRead = await coreRequest(`/api/tasks/${encodeURIComponent(first.taskId)}`, ownerB.data.sessionToken);
  if (crossOwnerRead.response.status !== 404 || crossOwnerRead.data.error !== "task_not_found") throw new Error("owner isolation failed");
  const crossOwnerRollback = await coreRequest(`/api/tasks/${encodeURIComponent(first.taskId)}/rollback`, ownerB.data.sessionToken, "POST");
  if (crossOwnerRollback.response.status !== 404 || crossOwnerRollback.data.error !== "task_not_found") throw new Error("cross-owner rollback was not denied");

  const rolledBack = await coreRequest(`/api/tasks/${encodeURIComponent(first.taskId)}/rollback`, ownerA.data.sessionToken, "POST");
  if (rolledBack.response.status !== 200
    || rolledBack.data.task?.status !== "rolled_back"
    || rolledBack.data.task?.rollback?.verified !== true
    || rolledBack.data.task?.executions?.at(-1)?.files?.[0]?.additions !== 1) {
    throw new Error("rollback did not preserve verified transaction evidence");
  }
  if (readFileSync(join(workspace, "src", "app.js"), "utf8") !== "export const value = 'old';\n") throw new Error("rollback did not restore original workspace bytes");

  // Transaction 2: verified/completed work cannot use rollback endpoint.
  const second = await createAndApprove(ownerA.data.sessionToken, "Update fixture and verify it");
  const verified = await coreRequest(`/api/tasks/${encodeURIComponent(second.taskId)}/verify`, ownerA.data.sessionToken, "POST");
  if (verified.response.status !== 200 || verified.data.task?.status !== "completed" || verified.data.task?.verification?.ok !== true) {
    throw new Error("verification gate failed");
  }
  const completedRollback = await coreRequest(`/api/tasks/${encodeURIComponent(second.taskId)}/rollback`, ownerA.data.sessionToken, "POST");
  if (completedRollback.response.status !== 409 || completedRollback.data.error !== "completed_task_not_rollbackable") {
    throw new Error("completed task rollback was not denied");
  }

  // Transaction 3: post-execution drift must cause conflict before any restore.
  const third = await createAndApprove(ownerA.data.sessionToken, "Update fixture for drift conflict test");
  writeFileSync(join(workspace, "src", "app.js"), "export const value = 'external-drift';\n");
  const driftRollback = await coreRequest(`/api/tasks/${encodeURIComponent(third.taskId)}/rollback`, ownerA.data.sessionToken, "POST");
  if (driftRollback.response.status !== 409
    || driftRollback.data.error !== "rollback_conflict"
    || !Array.isArray(driftRollback.data.files)
    || !driftRollback.data.files.includes("src/app.js")) {
    throw new Error("rollback drift protection failed");
  }
  if (readFileSync(join(workspace, "src", "app.js"), "utf8") !== "export const value = 'external-drift';\n") {
    throw new Error("conflicted rollback mutated the workspace");
  }

  const listedA = await coreRequest("/api/tasks", ownerA.data.sessionToken);
  const listedB = await coreRequest("/api/tasks", ownerB.data.sessionToken);
  if (listedA.data.tasks?.length !== 3 || listedB.data.tasks?.length !== 0) throw new Error("owner-scoped task listing failed");

  console.log("CORE SMOKE PASS: sessions, owner isolation, diff evidence, snapshot transaction, rollback, completed denial, drift conflict, verification");
} finally {
  core.kill("SIGTERM");
  await new Promise((resolve) => fakeProxy.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
