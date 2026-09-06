import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function now() {
  return new Date().toISOString();
}

function bounded(value, limit = 240) {
  return String(value || "").slice(0, limit);
}

function safeErrorCode(error) {
  const message = String(error?.message || "");
  return /^[a-z0-9_]{1,80}$/i.test(message) ? message : "snapshot_recovery_error";
}

function publicFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.slice(0, 32).map((file) => ({
    path: bounded(file?.path, 240),
    existed: file?.existed === true,
    beforeSha256: typeof file?.beforeSha256 === "string" ? file.beforeSha256.slice(0, 64) : null,
    afterSha256: typeof file?.afterSha256 === "string" ? file.afterSha256.slice(0, 64) : null,
    changed: file?.changed === true,
    additions: Number.isInteger(file?.additions) && file.additions >= 0 ? Math.min(file.additions, 1_000_000) : null,
    deletions: Number.isInteger(file?.deletions) && file.deletions >= 0 ? Math.min(file.deletions, 1_000_000) : null,
    diffExact: file?.diffExact === true,
    diffKind: typeof file?.diffKind === "string" ? bounded(file.diffKind, 40) : null,
    ...(Number.isInteger(file?.bytesBefore) ? { bytesBefore: Math.max(0, file.bytesBefore) } : {}),
    ...(Number.isInteger(file?.bytesAfter) ? { bytesAfter: Math.max(0, file.bytesAfter) } : {}),
  })).filter((file) => file.path);
}

async function persistState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.recovery.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, statePath);
}

function addEvent(task, type, detail = {}) {
  if (!Array.isArray(task.events)) task.events = [];
  task.events.push({ at: now(), type, ...detail });
  if (task.events.length > 100) task.events = task.events.slice(-100);
  task.updatedAt = now();
}

function latestSnapshotExecution(task) {
  if (!Array.isArray(task?.executions)) return null;
  return [...task.executions].reverse().find((execution) =>
    execution && typeof execution.executionId === "string" && typeof execution.snapshotId === "string");
}

export async function recoverOwnerState({ ownerId, statePath, snapshotStore, withWorkspaceLock }) {
  if (!ownerId || !statePath || !snapshotStore) return { recovered: 0, failed: 0 };

  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { recovered: 0, failed: 0 };
    return { recovered: 0, failed: 1 };
  }
  if (!state || !Array.isArray(state.tasks)) return { recovered: 0, failed: 0 };

  const runLocked = typeof withWorkspaceLock === "function"
    ? withWorkspaceLock
    : async (operation) => operation();

  let recovered = 0;
  let failed = 0;
  let changed = false;

  await runLocked(async () => {
    for (const task of state.tasks) {
      if (!task || !["executing", "rolling_back"].includes(task.status)) continue;
      changed = true;
      const execution = latestSnapshotExecution(task);
      if (!execution) {
        task.status = "failed";
        task.error = "execution_interrupted_without_snapshot";
        addEvent(task, "recovery_failed", { error: task.error });
        failed += 1;
        continue;
      }

      const ref = {
        ownerId,
        taskId: task.id,
        executionId: execution.executionId,
        snapshotId: execution.snapshotId,
      };

      try {
        const snapshot = await snapshotStore.getSnapshot(ref);
        if (snapshot.status === "captured") {
          const restored = await snapshotStore.restoreCaptured(ref);
          execution.status = "rolled_back_on_recovery";
          execution.completedAt ||= now();
          execution.rollback = restored.rollback;
          execution.files = publicFiles(restored.files);
          task.status = "failed";
          task.error = "execution_interrupted_restored";
          task.rollback = {
            completedAt: now(),
            executionId: execution.executionId,
            snapshotId: execution.snapshotId,
            status: "passed",
            restoredFiles: restored.rollback?.restoredFiles || 0,
            verified: restored.rollback?.verified === true,
            reason: "crash_recovery",
          };
          addEvent(task, "execution_recovered_to_snapshot", {
            executionId: execution.executionId,
            restoredFiles: task.rollback.restoredFiles,
          });
          recovered += 1;
          continue;
        }

        if (snapshot.status === "applied") {
          const validation = await snapshotStore.validateApplied(ref);
          if (!validation.ok) {
            execution.status = "recovery_conflict";
            task.status = "failed";
            task.error = "execution_recovery_conflict";
            task.rollback = {
              completedAt: now(),
              executionId: execution.executionId,
              snapshotId: execution.snapshotId,
              status: "blocked",
              error: "rollback_conflict",
              conflicts: validation.conflicts.slice(0, 16).map((path) => bounded(path, 240)),
            };
            addEvent(task, "recovery_conflict", {
              executionId: execution.executionId,
              files: task.rollback.conflicts.length,
            });
            failed += 1;
            continue;
          }
          execution.status = "applied";
          execution.completedAt ||= snapshot.appliedAt || now();
          execution.files = publicFiles(snapshot.files);
          task.status = "awaiting_verification";
          delete task.error;
          addEvent(task, "execution_recovered_applied", { executionId: execution.executionId });
          recovered += 1;
          continue;
        }

        if (snapshot.status === "rolled_back") {
          execution.status = "rolled_back";
          execution.completedAt ||= snapshot.rolledBackAt || now();
          execution.rollback = snapshot.rollback || null;
          execution.files = publicFiles(snapshot.files);
          task.status = "rolled_back";
          task.rollback = {
            completedAt: snapshot.rolledBackAt || now(),
            executionId: execution.executionId,
            snapshotId: execution.snapshotId,
            status: snapshot.rollback?.status || "passed",
            restoredFiles: snapshot.rollback?.restoredFiles || 0,
            verified: snapshot.rollback?.verified === true,
            reason: "recovered_rollback",
          };
          delete task.error;
          addEvent(task, "rollback_recovered", { executionId: execution.executionId });
          recovered += 1;
          continue;
        }

        task.status = "failed";
        task.error = "execution_recovery_unknown_snapshot_state";
        addEvent(task, "recovery_failed", { error: task.error, executionId: execution.executionId });
        failed += 1;
      } catch (error) {
        task.status = "failed";
        task.error = "execution_recovery_failed";
        addEvent(task, "recovery_failed", {
          error: task.error,
          executionId: execution.executionId,
          snapshotError: safeErrorCode(error),
        });
        failed += 1;
      }
    }
  });

  if (changed) {
    state.version = Math.max(Number(state.version) || 1, 2);
    await persistState(statePath, state);
  }
  return { recovered, failed };
}
