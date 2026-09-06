import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentService } from "../server/agent.mjs";

const findings = [];
const secret = "AGENT-SMOKE-SENTINEL-DO-NOT-LEAK";

function finding(message) {
  findings.push(message);
  console.warn(`KNOWN FINDING: ${message}`);
}

async function rejectsWithStatus(operation, status, label) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.status, status, `${label}: unexpected status`);
    return true;
  }, label);
}

function createHarness({ worker, verification, modelContent } = {}) {
  const calls = { model: [], worker: [], verification: [] };
  const service = createAgentService({
    requestModel: async (request) => {
      calls.model.push(request);
      return {
        choices: [{ message: { content: modelContent || JSON.stringify({
          summary: "Inspect and verify the requested change.",
          steps: [{ title: "Inspect the workspace", acceptance: "Evidence is recorded." }],
          risks: [],
        }) } }],
      };
    },
    runWorker: async (prompt) => {
      calls.worker.push(prompt);
      if (worker) return worker(prompt);
      return { worker: "stub-worker", content: "stub worker completed", verification: null };
    },
    runVerification: async (task) => {
      calls.verification.push(task);
      if (verification) return verification(task);
      return { ok: true, summary: "stub verification passed" };
    },
  });
  return { calls, service };
}

async function testInvalidTaskInput() {
  const { service } = createHarness();
  for (const goal of [undefined, null, "", "   "]) {
    await rejectsWithStatus(() => service.createTask({ goal }), 400, `invalid goal ${String(goal)}`);
  }

  // These are security probes rather than required behavior of the current implementation.
  // A task goal is a string contract; accepting coercible values can bypass validation.
  for (const goal of [123, true, {}, ["coerced goal"]]) {
    try {
      await service.createTask({ goal });
      finding(`createTask accepts non-string goal input (${Object.prototype.toString.call(goal)}).`);
    } catch (error) {
      assert.equal(error?.status, 400, "typed invalid goal should be rejected with HTTP 400");
    }
  }
}

async function testLifecycleAndGates() {
  const { calls, service } = createHarness();
  const created = await service.createTask({ goal: "Inspect the agent transition safely." });
  assert.equal(created.status, "awaiting_approval");
  assert.equal(calls.worker.length, 0, "creating a task must not execute a worker");
  assert.equal(calls.verification.length, 0, "creating a task must not verify a task");

  await rejectsWithStatus(() => service.verify(created.id), 409, "verify before worker");
  const executing = await service.approveAndExecute(created.id);
  assert.equal(executing.status, "awaiting_verification");
  assert.equal(calls.worker.length, 1, "approval should execute exactly one worker");
  await rejectsWithStatus(() => service.approveAndExecute(created.id), 409, "approve twice");

  const completed = await service.verify(created.id);
  assert.equal(completed.status, "completed");
  assert.equal(calls.verification.length, 1, "verification should run exactly once");
  await rejectsWithStatus(() => service.verify(created.id), 409, "verify twice");
  await rejectsWithStatus(() => service.approveAndExecute(created.id), 409, "approve completed task");
}

async function testFailureTransitions() {
  const workerFailure = createHarness({
    worker: async () => { throw new Error("worker failed in smoke test"); },
  });
  const workerTask = await workerFailure.service.createTask({ goal: "Exercise worker failure." });
  await assert.rejects(() => workerFailure.service.approveAndExecute(workerTask.id));
  assert.equal(workerFailure.service.getTask(workerTask.id).status, "failed");
  await rejectsWithStatus(() => workerFailure.service.verify(workerTask.id), 409, "verify failed worker");

  const verificationFailure = createHarness({ verification: async () => ({ ok: false, summary: "checks failed" }) });
  const verificationTask = await verificationFailure.service.createTask({ goal: "Exercise verification failure." });
  await verificationFailure.service.approveAndExecute(verificationTask.id);
  const failed = await verificationFailure.service.verify(verificationTask.id);
  assert.equal(failed.status, "verification_failed");
  await rejectsWithStatus(() => verificationFailure.service.verify(verificationTask.id), 409, "verify failed verification");
}

async function testSecretBoundaries() {
  const modelSecret = createHarness({ modelContent: `${secret}\n${JSON.stringify({
    summary: "safe summary",
    steps: [{ title: "safe step", acceptance: "safe evidence" }],
    risks: [],
  })}` });
  const task = await modelSecret.service.createTask({ goal: "Do not expose model internals." });
  assert.equal(JSON.stringify(task).includes(secret), false, "raw model output must not be copied into a task");
  assert.equal(modelSecret.calls.model[0].messages.some((message) => message.content.includes(secret)), false);

  const workerSecret = createHarness({
    worker: async () => ({ worker: "stub-worker", content: `worker output ${secret}` }),
  });
  const workerTask = await workerSecret.service.createTask({ goal: "Exercise worker output handling." });
  const workerResult = await workerSecret.service.approveAndExecute(workerTask.id);
  if (JSON.stringify(workerResult).includes(secret)) {
    finding("worker result content is stored and returned without secret redaction.");
  }

  const errorSecret = createHarness({
    worker: async () => { throw new Error(`worker failure ${secret}`); },
  });
  const errorTask = await errorSecret.service.createTask({ goal: "Exercise worker error handling." });
  await assert.rejects(() => errorSecret.service.approveAndExecute(errorTask.id));
  if (JSON.stringify(errorSecret.service.getTask(errorTask.id)).includes(secret)) {
    finding("worker error messages are stored and returned without secret redaction.");
  }
}

async function testPersistence() {
  const directory = mkdtempSync(join(tmpdir(), "webai-agent-smoke-"));
  const statePath = join(directory, "agent-state.json");
  try {
    const first = createAgentService({
      requestModel: async () => ({ choices: [{ message: { content: "{}" } }] }),
      runWorker: async () => ({ content: "persisted worker" }),
      runVerification: async () => ({ ok: true }),
      statePath,
    });
    const task = await first.createTask({ goal: "Persist a task safely." });
    assert.equal(first.getTask(task.id).status, "awaiting_approval");

    const restored = createAgentService({
      requestModel: async () => ({ choices: [{ message: { content: "{}" } }] }),
      runWorker: async () => ({ content: "persisted worker" }),
      runVerification: async () => ({ ok: true }),
      statePath,
    });
    assert.equal(restored.getTask(task.id).status, "awaiting_approval");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await testInvalidTaskInput();
await testLifecycleAndGates();
await testFailureTransitions();
await testSecretBoundaries();
await testPersistence();

if (findings.length) {
  console.error(`AGENT SMOKE FAILED: ${findings.length} unresolved hardening finding(s)`);
  process.exitCode = 1;
} else {
  console.log("AGENT SMOKE PASS: input validation, lifecycle gates, failure transitions, secret boundaries, and persistence");
}
