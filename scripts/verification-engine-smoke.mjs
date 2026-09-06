import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVerificationPlan, createVerificationEngine } from "../server/verification-engine.mjs";

function makeTask(files = [{ path: "src/app.js", changed: true }]) {
  return {
    id: "task-v05",
    executions: [{
      executionId: "exec-v05",
      snapshotId: "snap-v05",
      status: "applied",
      files,
    }],
  };
}

function fixture(scripts = {}) {
  const root = mkdtempSync(join(tmpdir(), "webai-verification-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "export const value = 1;\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "verify-fixture", scripts }, null, 2));
  const snapshotStore = {
    validateApplied: async () => ({ ok: true, conflicts: [] }),
  };
  return { root, snapshotStore, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function testPlanDetection() {
  const plan = buildVerificationPlan({ scripts: {
    build: "echo build",
    "test:unit": "echo unit",
    "test:integration": "echo integration",
    test: "echo regression",
  } });
  assert.deepEqual(plan.map((gate) => gate.id), ["build", "unit", "integration", "regression"]);
  assert.deepEqual(plan.map((gate) => gate.argv?.join(" ")), ["npm run build", "npm run test:unit", "npm run test:integration", "npm test"]);
  assert.equal(plan.every((gate) => gate.required), true);
}

async function testAllConfiguredGatesPass() {
  const h = fixture({ build: "x", "test:unit": "x", "test:integration": "x", test: "x" });
  const calls = [];
  try {
    const engine = createVerificationEngine({
      workspace: h.root,
      snapshotStore: h.snapshotStore,
      commandRunner: async ({ argv }) => {
        calls.push(argv.join(" "));
        return { ok: true, exitCode: 0, durationMs: 5, outputCaptured: true, outputBytes: 4, outputSha256: "a".repeat(64) };
      },
    });
    const result = await engine.verify({ task: makeTask(), ownerId: "owner-v05" });
    assert.equal(result.ok, true);
    assert.equal(result.profile, "multi-gate-v0.5");
    assert.equal(result.requiredGates, 6);
    assert.equal(result.passedRequired, 6);
    assert.deepEqual(result.gates.map((gate) => gate.status), ["passed", "passed", "passed", "passed", "passed", "passed"]);
    assert.deepEqual(calls, ["npm run build", "npm run test:unit", "npm run test:integration", "npm test"]);
    assert.equal(JSON.stringify(result).includes("echo build"), false, "script body must never be returned as verification evidence");
  } finally {
    h.cleanup();
  }
}

async function testMissingScriptsAreSkippedNotRequired() {
  const h = fixture({});
  try {
    const engine = createVerificationEngine({ workspace: h.root, snapshotStore: h.snapshotStore, commandRunner: async () => { throw new Error("must not run"); } });
    const result = await engine.verify({ task: makeTask(), ownerId: "owner-v05" });
    assert.equal(result.ok, true);
    assert.equal(result.requiredGates, 2);
    assert.deepEqual(result.gates.slice(2).map((gate) => gate.status), ["skipped", "skipped", "skipped", "skipped"]);
  } finally {
    h.cleanup();
  }
}

async function testCommandFailureFailsWholeGateSet() {
  const h = fixture({ build: "x", test: "x" });
  try {
    const engine = createVerificationEngine({
      workspace: h.root,
      snapshotStore: h.snapshotStore,
      commandRunner: async ({ argv }) => argv.includes("build")
        ? { ok: false, exitCode: 1, durationMs: 7, outputCaptured: true, outputBytes: 5, outputSha256: "b".repeat(64), error: "command_failed" }
        : { ok: true, exitCode: 0, durationMs: 3, outputCaptured: false, outputBytes: 0, outputSha256: null },
    });
    const result = await engine.verify({ task: makeTask(), ownerId: "owner-v05" });
    assert.equal(result.ok, false);
    assert.equal(result.gates.find((gate) => gate.id === "build")?.status, "failed");
    assert.equal(result.gates.find((gate) => gate.id === "regression")?.status, "passed");
  } finally {
    h.cleanup();
  }
}

async function testPackageManifestChangeCannotDefineCommands() {
  const h = fixture({ test: "model-controlled command" });
  try {
    const engine = createVerificationEngine({ workspace: h.root, snapshotStore: h.snapshotStore, commandRunner: async () => { throw new Error("blocked gate must not execute"); } });
    const task = makeTask([{ path: "package.json", changed: true }, { path: "src/app.js", changed: true }]);
    const result = await engine.verify({ task, ownerId: "owner-v05" });
    assert.equal(result.ok, false);
    assert.equal(result.gates.find((gate) => gate.id === "security")?.error, "verification_command_source_changed");
    assert.equal(result.gates.find((gate) => gate.id === "regression")?.status, "blocked");
  } finally {
    h.cleanup();
  }
}

async function testSecretFindingFailsBeforeCommands() {
  const h = fixture({ test: "x" });
  writeFileSync(join(h.root, "src", "app.js"), "const leaked = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';\n");
  try {
    const engine = createVerificationEngine({ workspace: h.root, snapshotStore: h.snapshotStore, commandRunner: async () => { throw new Error("security failure must block commands"); } });
    const result = await engine.verify({ task: makeTask(), ownerId: "owner-v05" });
    const security = result.gates.find((gate) => gate.id === "security");
    assert.equal(result.ok, false);
    assert.equal(security?.status, "failed");
    assert.equal(security?.error, "security_findings");
    assert.equal(security?.findings?.[0]?.path, "src/app.js");
    assert.equal(JSON.stringify(result).includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"), false, "secret value must not leak into evidence");
    assert.equal(result.gates.find((gate) => gate.id === "regression")?.status, "blocked");
  } finally {
    h.cleanup();
  }
}

await testPlanDetection();
await testAllConfiguredGatesPass();
await testMissingScriptsAreSkippedNotRequired();
await testCommandFailureFailsWholeGateSet();
await testPackageManifestChangeCannotDefineCommands();
await testSecretFindingFailsBeforeCommands();
console.log("VERIFICATION ENGINE SMOKE PASS: policy detection, required/skipped gates, command failure, command-source trust, secret-safe preflight");
