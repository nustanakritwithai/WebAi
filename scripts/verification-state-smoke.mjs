import assert from "node:assert/strict";
import { createAgentService } from "../server/agent.mjs";

const secret = "STATE-SHOULD-NOT-KEEP-THIS-RAW-OUTPUT";
delete process.env.WEBAI_NATIVE_WORKER_ENABLED;

const service = createAgentService({
  requestModel: async () => ({
    choices: [{ message: { content: JSON.stringify({
      summary: "Verify gate evidence",
      steps: [{ title: "Update fixture", acceptance: "Verification passes" }],
      risks: [],
    }) } }],
  }),
  runWorker: async () => ({ worker: "stub-worker", content: "done", changedFiles: [{ path: "src/app.js", changed: true, bytes: 12 }] }),
  runVerification: async () => ({
    ok: true,
    profile: "multi-gate-v0.5",
    requiredGates: 3,
    passedRequired: 3,
    failedRequired: 0,
    gates: [
      { id: "file_safety", label: "File Safety", required: true, status: "passed", changedFiles: 1 },
      { id: "security", label: "Security", required: true, status: "passed", scannedFiles: 1 },
      { id: "build", label: "Build", required: false, status: "skipped", reason: "not_configured" },
      { id: "unit", label: "Unit Tests", required: false, status: "skipped", reason: "not_configured" },
      { id: "integration", label: "Integration", required: false, status: "skipped", reason: "not_configured" },
      {
        id: "regression",
        label: "Regression",
        required: true,
        status: "passed",
        command: "npm test",
        exitCode: 0,
        durationMs: 15,
        outputCaptured: true,
        outputBytes: 42,
        outputSha256: "c".repeat(64),
        output: secret,
      },
    ],
  }),
});

const created = await service.createTask({ goal: "Exercise gate evidence persistence." });
await service.approveAndExecute(created.id);
const verified = await service.verify(created.id);
assert.equal(verified.status, "completed");
assert.equal(verified.verification?.profile, "multi-gate-v0.5");
assert.equal(verified.verification?.requiredGates, 3);
assert.equal(verified.verification?.passedRequired, 3);
assert.equal(verified.verification?.gates?.length, 6);
const regression = verified.verification.gates.find((gate) => gate.id === "regression");
assert.equal(regression?.command, "npm test");
assert.equal(regression?.outputSha256, "c".repeat(64));
assert.equal(regression?.outputCaptured, true);
assert.equal("output" in regression, false, "raw gate output must not enter task state");
assert.equal(JSON.stringify(verified).includes(secret), false, "raw verification output must not leak into task state");
console.log("VERIFICATION STATE SMOKE PASS: bounded gate metadata persists without raw output");
