import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverOwnerState } from "../server/core-recovery.mjs";
import { createSnapshotStore } from "../server/snapshot-store.mjs";

const root = mkdtempSync(join(tmpdir(), "webai-recovery-smoke-"));
const workspace = join(root, "workspace");
const snapshots = join(root, "snapshots");
const statePath = join(root, "state", "owner.json");
const ownerId = "recovery_owner_000000000001";
mkdirSync(join(workspace, "src"), { recursive: true });

const store = createSnapshotStore({ workspace, snapshotRoot: snapshots });
const unlocked = async (operation) => operation();

function stateTask({ id, executionId, snapshotId, status = "executing" }) {
  return {
    id,
    goal: `Recover ${id}`,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: { summary: "fixture", steps: [{ id: "step-1", title: "fixture", acceptance: "fixture" }], risks: [] },
    approval: { approvedAt: new Date().toISOString() },
    worker: null,
    executions: [{
      executionId,
      status: "snapshotted",
      startedAt: new Date().toISOString(),
      completedAt: null,
      snapshotId,
      files: [],
      rollback: null,
    }],
    rollback: null,
    verification: null,
    events: [{ at: new Date().toISOString(), type: "snapshot_captured" }],
  };
}

function writeState(tasks) {
  mkdirSync(join(root, "state"), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ version: 2, tasks }, null, 2));
}

function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

try {
  // Case 1: post-state was durably recorded; restart should resume at verification.
  writeFileSync(join(workspace, "src", "applied.js"), "export const value = 'before';\n");
  const appliedExecution = "exec-applied-recovery";
  const appliedCapture = await store.createSnapshot({
    ownerId,
    taskId: "task-applied",
    executionId: appliedExecution,
    files: ["src/applied.js"],
  });
  writeFileSync(join(workspace, "src", "applied.js"), "export const value = 'after';\n");
  await store.recordAfter(appliedCapture.ref);
  writeState([stateTask({ id: "task-applied", executionId: appliedExecution, snapshotId: appliedCapture.ref.snapshotId })]);

  const appliedRecovery = await recoverOwnerState({ ownerId, statePath, snapshotStore: store, withWorkspaceLock: unlocked });
  assert.equal(appliedRecovery.recovered, 1);
  let state = readState();
  assert.equal(state.tasks[0].status, "awaiting_verification");
  assert.equal(state.tasks[0].executions[0].status, "applied");
  assert.equal(readFileSync(join(workspace, "src", "applied.js"), "utf8"), "export const value = 'after';\n");

  // Case 2: snapshot existed but after-state was never committed; fail-safe restore before-state.
  writeFileSync(join(workspace, "src", "captured.js"), "export const value = 'safe-before';\n");
  const capturedExecution = "exec-captured-recovery";
  const captured = await store.createSnapshot({
    ownerId,
    taskId: "task-captured",
    executionId: capturedExecution,
    files: ["src/captured.js"],
  });
  writeFileSync(join(workspace, "src", "captured.js"), "export const value = 'partial-write';\n");
  writeState([stateTask({ id: "task-captured", executionId: capturedExecution, snapshotId: captured.ref.snapshotId })]);

  const capturedRecovery = await recoverOwnerState({ ownerId, statePath, snapshotStore: store, withWorkspaceLock: unlocked });
  assert.equal(capturedRecovery.recovered, 1);
  state = readState();
  assert.equal(state.tasks[0].status, "failed");
  assert.equal(state.tasks[0].error, "execution_interrupted_restored");
  assert.equal(state.tasks[0].rollback?.verified, true);
  assert.equal(readFileSync(join(workspace, "src", "captured.js"), "utf8"), "export const value = 'safe-before';\n");

  // Case 3: durable applied snapshot no longer matches workspace; recovery must not overwrite drift.
  writeFileSync(join(workspace, "src", "drift.js"), "export const value = 'before';\n");
  const driftExecution = "exec-drift-recovery";
  const drift = await store.createSnapshot({
    ownerId,
    taskId: "task-drift",
    executionId: driftExecution,
    files: ["src/drift.js"],
  });
  writeFileSync(join(workspace, "src", "drift.js"), "export const value = 'after';\n");
  await store.recordAfter(drift.ref);
  writeFileSync(join(workspace, "src", "drift.js"), "export const value = 'external-drift';\n");
  writeState([stateTask({ id: "task-drift", executionId: driftExecution, snapshotId: drift.ref.snapshotId })]);

  const driftRecovery = await recoverOwnerState({ ownerId, statePath, snapshotStore: store, withWorkspaceLock: unlocked });
  assert.equal(driftRecovery.failed, 1);
  state = readState();
  assert.equal(state.tasks[0].status, "failed");
  assert.equal(state.tasks[0].error, "execution_recovery_conflict");
  assert.deepEqual(state.tasks[0].rollback?.conflicts, ["src/drift.js"]);
  assert.equal(readFileSync(join(workspace, "src", "drift.js"), "utf8"), "export const value = 'external-drift';\n");

  console.log("RECOVERY SMOKE PASS: applied resume, captured fail-safe restore, drift conflict without mutation");
} finally {
  rmSync(root, { recursive: true, force: true });
}
