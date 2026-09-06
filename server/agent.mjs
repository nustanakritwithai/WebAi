import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createNativeWorker } from "./native-worker.mjs";

const MAX_GOAL_CHARS = 12_000;
const MAX_TASKS = 200;
const TERMINAL_STATES = new Set(["completed", "failed", "verification_failed", "rolled_back"]);
export const TASK_STATES = Object.freeze([
  "planning",
  "awaiting_approval",
  "executing",
  "awaiting_verification",
  "verifying",
  "rolling_back",
  "rolled_back",
  "completed",
  "verification_failed",
  "failed",
]);

function httpError(message, status, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function now() {
  return new Date().toISOString();
}

function boundedText(value, limit = 8_000) {
  return String(value || "").trim().slice(0, limit);
}

function boundedList(value, limit, itemLimit) {
  return Array.isArray(value) ? value.slice(0, limit).map((item) => boundedText(item, itemLimit)).filter(Boolean) : [];
}

function envEnabled(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ""));
}

function normalizeChangedFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((item) => ({
    path: boundedText(item?.path, 240),
    created: item?.created === true,
    changed: item?.changed !== false,
    ...(Number.isInteger(item?.bytes) && item.bytes >= 0 ? { bytes: Math.min(item.bytes, 500_000) } : {}),
  })).filter((item) => item.path);
}

function normalizeSnapshotFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map((item) => ({
    path: boundedText(item?.path, 240),
    existed: item?.existed === true,
    beforeSha256: typeof item?.beforeSha256 === "string" ? item.beforeSha256.slice(0, 64) : null,
    afterSha256: typeof item?.afterSha256 === "string" ? item.afterSha256.slice(0, 64) : null,
    changed: item?.changed === true,
    additions: Number.isInteger(item?.additions) && item.additions >= 0 ? Math.min(item.additions, 1_000_000) : null,
    deletions: Number.isInteger(item?.deletions) && item.deletions >= 0 ? Math.min(item.deletions, 1_000_000) : null,
    diffExact: item?.diffExact === true,
    diffKind: typeof item?.diffKind === "string" ? boundedText(item.diffKind, 40) : null,
    ...(Number.isInteger(item?.bytesBefore) ? { bytesBefore: Math.max(0, item.bytesBefore) } : {}),
    ...(Number.isInteger(item?.bytesAfter) ? { bytesAfter: Math.max(0, item.bytesAfter) } : {}),
  })).filter((item) => item.path);
}

function taskView(task) {
  return structuredClone(task);
}

function parsePlan(raw, goal) {
  const content = boundedText(raw, 20_000);
  const candidate = content.match(/\{[\s\S]*\}/)?.[0];
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed.steps) && parsed.steps.length) {
        return {
          summary: boundedText(parsed.summary, 1_200) || goal,
          steps: parsed.steps.slice(0, 12).map((step, index) => ({
            id: `step-${index + 1}`,
            title: boundedText(typeof step === "string" ? step : step?.title, 500) || `Step ${index + 1}`,
            acceptance: boundedText(typeof step === "object" ? step?.acceptance : "", 800),
          })),
          risks: boundedList(parsed.risks, 8, 400),
        };
      }
    } catch {
      // A model response is advisory; use a safe fallback instead of accepting malformed structure.
    }
  }
  return {
    summary: goal,
    steps: [{ id: "step-1", title: "Inspect the workspace and implement the requested change.", acceptance: "Provide the changed files and test result." }],
    risks: ["The planner did not return structured JSON; review this plan before approval."],
  };
}

export function createAgentService({
  requestModel,
  runWorker,
  runVerification,
  statePath = "",
  ownerId = "",
  snapshotStore = null,
  withWorkspaceLock = null,
}) {
  const tasks = new Map();

  if (typeof requestModel !== "function") throw new TypeError("requestModel must be a function");
  if (typeof runWorker !== "function") throw new TypeError("runWorker must be a function");
  if (typeof runVerification !== "function") throw new TypeError("runVerification must be a function");

  const nativeWorkerEnabled = envEnabled("WEBAI_NATIVE_WORKER_ENABLED");
  const nativeWorker = nativeWorkerEnabled
    ? createNativeWorker({ workspace: process.env.WEBAI_WORKSPACE || "", requestModel })
    : null;
  const executeWorker = nativeWorker ? nativeWorker.run : runWorker;
  const workerName = nativeWorker ? "webai-native-v0.1" : "legacy-worker";

  async function runLocked(operation) {
    return typeof withWorkspaceLock === "function" ? withWorkspaceLock(operation) : operation();
  }

  function persist() {
    if (!statePath) return;
    const snapshot = JSON.stringify({ version: 2, tasks: [...tasks.values()] }, null, 2);
    mkdirSync(dirname(statePath), { recursive: true });
    const temporary = `${statePath}.tmp`;
    writeFileSync(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, statePath);
    try { chmodSync(statePath, 0o600); } catch { /* Windows and read-only stores may not support chmod. */ }
  }

  function restore() {
    if (!statePath || !existsSync(statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(statePath, "utf8"));
      if (!Array.isArray(saved?.tasks)) return;
      for (const task of saved.tasks.slice(-MAX_TASKS)) {
        if (typeof task?.id !== "string" || typeof task?.goal !== "string" || !TASK_STATES.includes(task?.status)) continue;
        tasks.set(task.id, {
          id: task.id,
          goal: boundedText(task.goal, MAX_GOAL_CHARS),
          status: task.status,
          createdAt: typeof task.createdAt === "string" ? task.createdAt : now(),
          updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : now(),
          plan: task.plan && typeof task.plan === "object" ? task.plan : null,
          approval: task.approval && typeof task.approval === "object" ? task.approval : null,
          worker: task.worker && typeof task.worker === "object" ? task.worker : null,
          executions: Array.isArray(task.executions) ? task.executions.slice(-20) : [],
          rollback: task.rollback && typeof task.rollback === "object" ? task.rollback : null,
          verification: task.verification && typeof task.verification === "object" ? task.verification : null,
          error: typeof task.error === "string" ? boundedText(task.error, 300) : undefined,
          events: Array.isArray(task.events) ? task.events.slice(-100) : [{ at: now(), type: "state_restored" }],
        });
      }
    } catch {
      // Never prevent the API from starting because an operator-managed state file is corrupt.
    }
  }

  function getMutable(id) {
    const task = tasks.get(id);
    if (!task) throw httpError("task_not_found", 404);
    return task;
  }

  function record(task, type, detail = {}) {
    task.events.push({ at: now(), type, ...detail });
    task.updatedAt = now();
    persist();
  }

  async function createTask(input) {
    if (typeof input?.goal !== "string") throw httpError("goal_required", 400);
    const goal = boundedText(input?.goal, MAX_GOAL_CHARS);
    if (!goal) throw httpError("goal_required", 400);
    const task = {
      id: randomUUID(),
      goal,
      status: "planning",
      createdAt: now(),
      updatedAt: now(),
      plan: null,
      worker: null,
      executions: [],
      rollback: null,
      verification: null,
      events: [{ at: now(), type: "task_created" }],
    };
    tasks.set(task.id, task);
    if (tasks.size > MAX_TASKS) tasks.delete(tasks.keys().next().value);
    persist();
    try {
      const response = await requestModel({
        messages: [
          { role: "system", content: "You are the planner in the WebAi supervised software engineering core. Return only JSON: {summary:string,steps:[{title:string,acceptance:string}],risks:string[]}. Keep the plan concise. Never claim a change was made." },
          { role: "user", content: goal },
        ],
        temperature: 0.1,
        max_tokens: 2_000,
      });
      task.plan = parsePlan(response?.choices?.[0]?.message?.content, goal);
      task.status = "awaiting_approval";
      record(task, "plan_ready");
      return taskView(task);
    } catch (error) {
      task.status = "failed";
      task.error = "planning_failed";
      record(task, "planning_failed", { error: task.error });
      throw httpError(task.error, Number(error?.status) || 502);
    }
  }

  async function runNativeTransaction(task, execution, prompt) {
    if (!nativeWorker || !snapshotStore) return runLocked(() => executeWorker(prompt));
    if (!ownerId) throw httpError("snapshot_owner_not_configured", 500);

    return runLocked(async () => {
      const prepared = await nativeWorker.prepare(prompt);
      const targets = prepared.manifest.files.map((file) => file.path);
      const captured = await snapshotStore.createSnapshot({
        ownerId,
        taskId: task.id,
        executionId: execution.executionId,
        files: targets,
      });

      execution.snapshotId = captured.snapshot.snapshotId;
      execution.status = "snapshotted";
      execution.files = normalizeSnapshotFiles(captured.snapshot.files);
      record(task, "snapshot_captured", {
        executionId: execution.executionId,
        snapshotId: execution.snapshotId,
        files: execution.files.length,
      });

      let result;
      try {
        result = await nativeWorker.apply(prepared);
      } catch (error) {
        execution.status = "failed";
        execution.completedAt = now();
        throw error;
      }

      let after;
      try {
        after = await snapshotStore.recordAfter(captured.ref);
      } catch (error) {
        try {
          const restored = await snapshotStore.restoreCaptured(captured.ref);
          execution.status = "rolled_back_on_error";
          execution.rollback = restored.rollback;
        } catch {
          execution.status = "recovery_failed";
        }
        execution.completedAt = now();
        throw error;
      }

      execution.status = "applied";
      execution.completedAt = now();
      execution.files = normalizeSnapshotFiles(after.files);
      return result;
    });
  }

  async function approveAndExecute(id) {
    const task = getMutable(id);
    if (task.status !== "awaiting_approval") throw httpError("task_not_awaiting_approval", 409);
    if (!task.plan?.steps?.length) throw httpError("task_plan_missing", 409);
    task.approval = { approvedAt: now() };
    task.status = "executing";
    task.rollback = null;
    const execution = {
      executionId: `exec-${randomUUID()}`,
      status: "running",
      startedAt: now(),
      completedAt: null,
      snapshotId: null,
      files: [],
      rollback: null,
    };
    task.executions.push(execution);
    if (task.executions.length > 20) task.executions.splice(0, task.executions.length - 20);
    record(task, "execution_approved", { worker: workerName, executionId: execution.executionId });
    const planText = task.plan.steps.map((step, index) => `${index + 1}. ${step.title}${step.acceptance ? ` Acceptance: ${step.acceptance}` : ""}`).join("\n");
    const prompt = `Goal: ${task.goal}\n\nApproved plan:\n${planText}\n\nImplement only the approved task inside the configured workspace. Return bounded evidence of changed files. Do not claim DONE; verification is a separate gate.`;
    try {
      const result = await runNativeTransaction(task, execution, prompt);
      if (execution.status === "running") {
        execution.status = "applied";
        execution.completedAt = now();
      }
      task.worker = {
        completedAt: now(),
        worker: boundedText(result?.worker || workerName, 100),
        changedFiles: normalizeChangedFiles(result?.changedFiles),
        outputCaptured: typeof result?.content === "string" && result.content.length > 0,
      };
      task.status = "awaiting_verification";
      record(task, "worker_finished", {
        worker: task.worker.worker,
        changedFiles: task.worker.changedFiles.length,
        executionId: execution.executionId,
        snapshotId: execution.snapshotId,
      });
      return taskView(task);
    } catch (error) {
      if (!["rolled_back_on_error", "recovery_failed"].includes(execution.status)) execution.status = "failed";
      execution.completedAt ||= now();
      task.status = "failed";
      task.error = "worker_failed";
      record(task, "worker_failed", { error: task.error, worker: workerName, executionId: execution.executionId });
      throw httpError(task.error, Number(error?.status) || 502);
    }
  }

  async function verify(id) {
    const task = getMutable(id);
    if (task.status !== "awaiting_verification") throw httpError("task_not_awaiting_verification", 409);
    task.status = "verifying";
    record(task, "verification_started");
    try {
      const evidence = await runLocked(() => runVerification(task));
      const normalizedEvidence = {
        ok: evidence?.ok === true,
        ...(typeof evidence?.command === "string" ? { command: boundedText(evidence.command, 200) } : {}),
        ...(Number.isInteger(evidence?.exitCode) ? { exitCode: evidence.exitCode } : {}),
        ...(typeof evidence?.output === "string" && evidence.output.length > 0 ? { outputCaptured: true } : {}),
        ...(evidence?.ok === false ? { error: "verification_failed" } : {}),
      };
      task.verification = { completedAt: now(), ...normalizedEvidence };
      task.status = normalizedEvidence.ok ? "completed" : "verification_failed";
      record(task, normalizedEvidence.ok ? "verification_passed" : "verification_failed");
      return taskView(task);
    } catch (error) {
      task.status = "verification_failed";
      task.verification = { completedAt: now(), ok: false, error: "verification_failed" };
      record(task, "verification_failed", { error: task.verification.error });
      throw httpError(task.verification.error, Number(error?.status) || 502);
    }
  }

  async function rollback(id) {
    const task = getMutable(id);
    if (task.status === "completed") throw httpError("completed_task_not_rollbackable", 409);
    if (!["awaiting_verification", "verification_failed", "failed"].includes(task.status)) throw httpError("task_not_rollbackable", 409);
    if (!snapshotStore || !ownerId) throw httpError("rollback_not_configured", 503);

    const execution = [...task.executions].reverse().find((item) => item?.snapshotId && item.status === "applied");
    if (!execution) throw httpError("rollback_snapshot_missing", 409);

    const previousStatus = task.status;
    task.status = "rolling_back";
    record(task, "rollback_started", { executionId: execution.executionId, snapshotId: execution.snapshotId });
    try {
      const result = await runLocked(() => snapshotStore.rollback({
        ownerId,
        taskId: task.id,
        executionId: execution.executionId,
        snapshotId: execution.snapshotId,
      }));
      execution.status = "rolled_back";
      execution.rollback = result.rollback;
      task.rollback = {
        completedAt: now(),
        executionId: execution.executionId,
        snapshotId: execution.snapshotId,
        status: "passed",
        restoredFiles: result.rollback?.restoredFiles || 0,
        verified: result.rollback?.verified === true,
      };
      task.status = "rolled_back";
      record(task, "rollback_completed", { executionId: execution.executionId, restoredFiles: task.rollback.restoredFiles });
      return taskView(task);
    } catch (error) {
      task.status = previousStatus;
      task.rollback = {
        completedAt: now(),
        executionId: execution.executionId,
        snapshotId: execution.snapshotId,
        status: "failed",
        error: boundedText(error?.message || "rollback_failed", 120),
        ...(Array.isArray(error?.files) ? { conflicts: error.files.slice(0, 16).map((path) => boundedText(path, 240)) } : {}),
      };
      record(task, "rollback_failed", { executionId: execution.executionId, error: task.rollback.error });
      throw httpError(error?.message || "rollback_failed", Number(error?.status) || 500, Array.isArray(error?.files) ? { files: error.files } : {});
    }
  }

  restore();
  return {
    status: () => ({
      enabled: true,
      persistenceConfigured: Boolean(statePath),
      taskCount: tasks.size,
      worker: workerName,
      nativeWorkerEnabled,
      snapshotConfigured: Boolean(snapshotStore),
    }),
    createTask,
    approveAndExecute,
    verify,
    rollback,
    getTask: (id) => taskView(getMutable(id)),
    listTasks: () => [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(taskView),
    terminalStates: TERMINAL_STATES,
  };
}
