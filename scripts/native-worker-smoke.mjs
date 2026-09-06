import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    assert.equal(result.worker, "webai-native-v0.1");
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

await testWritesAndContextBoundary();
await testTraversalDenied();
await testSecretPathDenied();
await testGithubWorkflowDenied();
await testManifestLimits();
await testMalformedManifest();
await testNoOutsideFileCreated();

console.log("NATIVE WORKER SMOKE PASS: writes, context boundary, traversal, secret paths, workflow paths, manifest limits");
