import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentService } from "../server/agent.mjs";
import { createNativeWorker } from "../server/native-worker.mjs";

function harness(manifestFactory) {
  const directory = mkdtempSync(join(tmpdir(), "webai-native-worker-"));
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "echo ok" } }, null, 2));
  writeFileSync(join(directory, "src", "app.js"), "export const greeting = 'old';\n");
  writeFileSync(join(directory, ".env"), "SECRET_SENTINEL=DO_NOT_EXPOSE\n");
  const calls = [];
  const worker = createNativeWorker({
    workspace: directory,
    requestModel: async (request) => {
      calls.push(request);
      const manifest = typeof manifestFactory === "function" ? manifestFactory(request) : manifestFactory;
      return { choices: [{ message: { content: JSON.stringify(manifest) } }] };
    },
  });
  return { calls, directory, worker, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

async function testWritesAndContextBoundary() {
  const h = harness({
    summary: "Update greeting safely.",
    files: [
      { path: "src/app.js", content: "export const greeting = 'new';\n" },
      { path: "src/helper.js", content: "export const helper = true;\n" },
    ],
  });
  try {
    const result = await h.worker.run("Change the greeting and add a helper.");
    assert.equal(result.worker, "webai-omp-runtime-v0.2");
    assert.equal(result.changedFiles.length, 2);
    assert.equal(readFileSync(join(h.directory, "src", "app.js"), "utf8"), "export const greeting = 'new';\n");
    assert.equal(readFileSync(join(h.directory, "src", "helper.js"), "utf8"), "export const helper = true;\n");
    const sent = JSON.stringify(h.calls[0]);
    assert.equal(sent.includes("DO_NOT_EXPOSE"), false, "hidden .env content must not enter model context");
  } finally {
    h.cleanup();
  }
}

async function testTraversalDenied() {
  const h = harness({ summary: "bad", files: [{ path: "../outside.txt", content: "no" }] });
  try {
    await assert.rejects(() => h.worker.run("escape"), (error) => error?.status === 400 || error?.status === 403);
  } finally {
    h.cleanup();
  }
}

async function testSecretPathDenied() {
  const h = harness({ summary: "bad", files: [{ path: ".env", content: "LEAK=1" }] });
  try {
    await assert.rejects(() => h.worker.run("touch env"), (error) => error?.status === 403);
    assert.equal(readFileSync(join(h.directory, ".env"), "utf8"), "SECRET_SENTINEL=DO_NOT_EXPOSE\n");
  } finally {
    h.cleanup();
  }
}

async function testGithubWorkflowDenied() {
  const h = harness({ summary: "bad", files: [{ path: ".github/workflows/pwn.yml", content: "name: bad" }] });
  try {
    await assert.rejects(() => h.worker.run("change workflow"), (error) => error?.status === 403);
  } finally {
    h.cleanup();
  }
}

async function testManifestLimits() {
  const files = Array.from({ length: 9 }, (_, i) => ({ path: `src/f${i}.js`, content: `export default ${i};\n` }));
  const h = harness({ summary: "too many", files });
  try {
    await assert.rejects(() => h.worker.run("write too many"), (error) => error?.status === 422);
  } finally {
    h.cleanup();
  }
}

async function testMalformedManifest() {
  const directory = mkdtempSync(join(tmpdir(), "webai-native-worker-malformed-"));
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(join(directory, "src", "a.js"), "export default 1;\n");
  const worker = createNativeWorker({
    workspace: directory,
    requestModel: async () => ({ choices: [{ message: { content: "not-json" } }] }),
  });
  try {
    await assert.rejects(() => worker.run("change a"), (error) => error?.status === 502);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function testNoOutsideFileCreated() {
  const h = harness({ summary: "bad", files: [{ path: "../../escape.js", content: "bad" }] });
  const outside = join(h.directory, "..", "escape.js");
  try {
    await assert.rejects(() => h.worker.run("escape"));
    assert.equal(existsSync(outside), false);
  } finally {
    h.cleanup();
  }
}

async function testStaleAnchorRejected() {
  const h = harness({ summary: "Update safely.", files: [{ path: "src/app.js", content: "export const greeting = 'new';\n" }] });
  try {
    const prepared = await h.worker.prepare("Change the greeting.");
    writeFileSync(join(h.directory, "src", "app.js"), "export const greeting = 'external-drift';\n");
    await assert.rejects(() => h.worker.apply(prepared), (error) => error?.status === 409 && error?.message === "native_stale_file");
    assert.equal(readFileSync(join(h.directory, "src", "app.js"), "utf8"), "export const greeting = 'external-drift';\n");
  } finally {
    h.cleanup();
  }
}

async function testSupervisedCoreUsesNativeWorker() {
  const directory = mkdtempSync(join(tmpdir(), "webai-native-agent-"));
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(join(directory, "src", "app.js"), "export const value = 1;\n");

  const previousEnabled = process.env.WEBAI_NATIVE_WORKER_ENABLED;
  const previousWorkspace = process.env.WEBAI_WORKSPACE;
  process.env.WEBAI_NATIVE_WORKER_ENABLED = "true";
  process.env.WEBAI_WORKSPACE = directory;
  let fallbackCalls = 0;

  try {
    const service = createAgentService({
      requestModel: async (request) => {
        const system = request?.messages?.[0]?.content || "";
        if (system.includes("planner")) {
          return { choices: [{ message: { content: JSON.stringify({
            summary: "Update value.",
            steps: [{ title: "Update src/app.js", acceptance: "value becomes 2" }],
            risks: [],
          }) } }] };
        }
        return { choices: [{ message: { content: JSON.stringify({
          summary: "Updated value with native worker.",
          files: [{ path: "src/app.js", content: "export const value = 2;\n" }],
        }) } }] };
      },
      runWorker: async () => {
        fallbackCalls += 1;
        throw new Error("legacy worker must not run");
      },
      runVerification: async () => ({ ok: true, command: "fixture verify", exitCode: 0 }),
    });

    assert.equal(service.status().nativeWorkerEnabled, true);
    assert.equal(service.status().worker, "webai-omp-runtime-v0.2");
    const created = await service.createTask({ goal: "Set the value to two." });
    const executed = await service.approveAndExecute(created.id);
    assert.equal(executed.status, "awaiting_verification");
    assert.equal(executed.worker.worker, "webai-omp-runtime-v0.2");
    assert.equal(executed.worker.changedFiles.length, 1);
    assert.equal(fallbackCalls, 0, "legacy worker must not be called when native worker is enabled");
    assert.equal(readFileSync(join(directory, "src", "app.js"), "utf8"), "export const value = 2;\n");
    const completed = await service.verify(created.id);
    assert.equal(completed.status, "completed");
  } finally {
    if (previousEnabled === undefined) delete process.env.WEBAI_NATIVE_WORKER_ENABLED;
    else process.env.WEBAI_NATIVE_WORKER_ENABLED = previousEnabled;
    if (previousWorkspace === undefined) delete process.env.WEBAI_WORKSPACE;
    else process.env.WEBAI_WORKSPACE = previousWorkspace;
    rmSync(directory, { recursive: true, force: true });
  }
}

await testWritesAndContextBoundary();
await testTraversalDenied();
await testSecretPathDenied();
await testGithubWorkflowDenied();
await testManifestLimits();
await testMalformedManifest();
await testNoOutsideFileCreated();
await testStaleAnchorRejected();
await testSupervisedCoreUsesNativeWorker();

console.log("OMP RUNTIME SMOKE PASS: writes, server-issued hash anchors, stale-write rejection, context boundary, path guards, limits, and supervised execution");
