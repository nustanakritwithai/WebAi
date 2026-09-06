import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_GOAL_CHARS = 12_000;
const MAX_TASKS = 200;
const TERMINAL_STATES = new Set(["completed", "failed", "verification_failed"]);
export const TASK_STATES = Object.freeze([
  "planning",
  "awaiting_approval",
  "executing",
  "awaiting_verification",
  "verifying",
  "completed",
  "verification_failed",
  "failed",
]);

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
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

export function createAgentService({ requestModel, runWorker, runVerification, statePath = "" }) {
  const tasks = new Map();

  if (typeof requestModel !== "function") throw new TypeError("requestModel must be a function");
  if (typeof runWorker !== "function") throw new TypeError("runWorker must be a function");
  if (typeof runVerification !== "function") throw new TypeError("runVerification must be a function");

  function persist() {
    if (!statePath) return;
    const snapshot = JSON.stringify({ version: 1, tasks: [...tasks.values()] }, null, 2);
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
      verification: null,
      events: [{ at: now(), type: "task_created" }],
    };
    tasks.set(task.id, task);
    if (tasks.size > MAX_TASKS) tasks.delete(tasks.keys().next().value);
    persist();
    try {
      const response = await requestModel({
        messages: [
          { role: "system", content: "You are the planner in a supervised software engineering agent. Return only JSON: {summary:string,steps:[{title:string,acceptance:string}],risks:string[]}. Keep the plan concise. Never claim a change was made." },
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

  async function approveAndExecute(id) {
    const task = getMutable(id);
    if (task.status !== "awaiting_approval") throw httpError("task_not_awaiting_approval", 409);
    if (!task.plan?.steps?.length) throw httpError("task_plan_missing", 409);
    task.approval = { approvedAt: now() };
    task.status = "executing";
    record(task, "execution_approved");
    const planText = task.plan.steps.map((step, index) => `${index + 1}. ${step.title}${step.acceptance ? ` Acceptance: ${step.acceptance}` : ""}`).join("\n");
    try {
      const result = await runWorker(`You are an implementation worker. Work only in the configured workspace. Goal: ${task.goal}\n\nApproved plan:\n${planText}\n\nDo not claim completion without reporting changed files and commands run.`);
      task.worker = {
        completedAt: now(),
        worker: boundedText(result?.worker || "worker", 100),
        outputCaptured: typeof result?.content === "string" && result.content.length > 0,
      };
      task.status = "awaiting_verification";
      record(task, "worker_finished");
      return taskView(task);
    } catch (error) {
      task.status = "failed";
      task.error = "worker_failed";
      record(task, "worker_failed", { error: task.error });
      throw httpError(task.error, Number(error?.status) || 502);
    }
  }

  async function verify(id) {
    const task = getMutable(id);
    if (task.status !== "awaiting_verification") throw httpError("task_not_awaiting_verification", 409);
    task.status = "verifying";
    record(task, "verification_started");
    try {
      const evidence = await runVerification(task);
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

  restore();
  return {
    status: () => ({ enabled: true, persistenceConfigured: Boolean(statePath), taskCount: tasks.size }),
    createTask,
    approveAndExecute,
    verify,
    getTask: (id) => taskView(getMutable(id)),
    listTasks: () => [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(taskView),
    terminalStates: TERMINAL_STATES,
  };
}
