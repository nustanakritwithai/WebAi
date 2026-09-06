import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const GATE_TIMEOUT_MS = 120_000;
const MAX_SECURITY_FILE_BYTES = 256_000;
const MAX_POLICY_ARGS = 12;
const MAX_ARG_CHARS = 240;

export const VERIFICATION_GATE_ORDER = Object.freeze([
  "file_safety",
  "security",
  "build",
  "unit",
  "integration",
  "regression",
]);

const LABELS = Object.freeze({
  file_safety: "File Safety",
  security: "Security",
  build: "Build",
  unit: "Unit Tests",
  integration: "Integration",
  regression: "Regression",
});

const SCRIPT_CANDIDATES = Object.freeze({
  build: ["build"],
  unit: ["test:unit", "unit"],
  integration: ["test:integration", "integration"],
  regression: ["test:regression", "regression", "test"],
});

function httpError(message, status = 500) {
  return Object.assign(new Error(message), { status });
}

function latestAppliedExecution(task) {
  if (!Array.isArray(task?.executions)) return null;
  return [...task.executions].reverse().find((execution) => execution?.status === "applied" && execution?.snapshotId && execution?.executionId) || null;
}

function safeChildEnvironment() {
  const allowed = ["PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"];
  return Object.fromEntries(allowed
    .filter((name) => typeof process.env[name] === "string" && process.env[name])
    .map((name) => [name, process.env[name]]));
}

function safeRelativePath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || isAbsolute(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return null;
  if (parts.some((part) => ["node_modules", "secret", "secrets", "credential", "credentials"].includes(part.toLowerCase()))) return null;
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(normalized)) return null;
  return normalized;
}

function workspaceTarget(root, relativePath) {
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}

function normalizePolicyArg(value) {
  if (typeof value !== "string") return null;
  const arg = value.trim();
  if (!arg || arg.length > MAX_ARG_CHARS || arg.includes("\0")) return null;
  return arg;
}

function normalizePolicyCommand(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_POLICY_ARGS) return null;
  const args = value.map(normalizePolicyArg);
  if (args.some((arg) => !arg)) return null;
  return args;
}

function pickScript(scripts, candidates) {
  return candidates.find((name) => typeof scripts?.[name] === "string" && scripts[name].trim()) || null;
}

function npmCommand(scriptName) {
  return scriptName === "test" ? ["npm", "test"] : ["npm", "run", scriptName];
}

function commandLabel(argv) {
  return argv.map((value) => (/^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value))).join(" ").slice(0, 320);
}

export function buildVerificationPlan({ scripts = {}, trustedPolicy = null, packageChanged = false } = {}) {
  const policyGates = trustedPolicy?.gates && typeof trustedPolicy.gates === "object" ? trustedPolicy.gates : null;
  const gates = [];
  for (const id of ["build", "unit", "integration", "regression"]) {
    let argv = policyGates ? normalizePolicyCommand(policyGates[id]) : null;
    let source = argv ? "trusted-policy" : null;
    if (!argv && !policyGates) {
      const script = pickScript(scripts, SCRIPT_CANDIDATES[id]);
      if (script) {
        argv = npmCommand(script);
        source = "package-script";
      }
    }
    const packageControlled = argv?.[0]?.toLowerCase() === "npm";
    const blockedByPolicyChange = packageChanged && packageControlled;
    gates.push({
      id,
      label: LABELS[id],
      required: Boolean(argv),
      argv,
      source,
      blockedByPolicyChange,
    });
  }
  return gates;
}

async function loadVerificationPolicy(workspace, task) {
  let root;
  try {
    root = await realpath(workspace);
  } catch {
    throw httpError("workspace_not_configured", 503);
  }

  const execution = latestAppliedExecution(task);
  const packageChanged = Boolean(execution?.files?.some((file) => file?.path === "package.json" && file?.changed === true));

  let trustedPolicy = null;
  try {
    const raw = await readFile(resolve(root, ".webai", "verification.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed?.gates && typeof parsed.gates === "object") trustedPolicy = parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") trustedPolicy = { invalid: true, gates: {} };
  }

  let scripts = {};
  try {
    const parsed = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    scripts = {};
  }

  return {
    root,
    execution,
    packageChanged,
    trustedPolicy,
    commands: buildVerificationPlan({ scripts, trustedPolicy: trustedPolicy?.invalid ? null : trustedPolicy, packageChanged }),
    policyInvalid: trustedPolicy?.invalid === true,
  };
}

function passedGate(id, extra = {}) {
  return { id, label: LABELS[id], required: true, status: "passed", ...extra };
}

function failedGate(id, error, extra = {}) {
  return { id, label: LABELS[id], required: true, status: "failed", error, ...extra };
}

function skippedGate(plan) {
  return { id: plan.id, label: plan.label, required: false, status: "skipped", reason: "not_configured" };
}

function blockedGate(plan, reason) {
  return { id: plan.id, label: plan.label, required: true, status: "blocked", error: reason, command: plan.argv ? commandLabel(plan.argv) : undefined };
}

async function runFileSafety({ task, ownerId, snapshotStore }) {
  const execution = latestAppliedExecution(task);
  if (!execution) return failedGate("file_safety", "execution_snapshot_missing");
  const changed = Array.isArray(execution.files) ? execution.files.filter((file) => file?.changed === true) : [];
  if (!changed.length) return failedGate("file_safety", "no_effective_change", { trackedFiles: execution.files?.length || 0 });
  try {
    const validation = await snapshotStore.validateApplied({ ownerId, taskId: task.id, executionId: execution.executionId, snapshotId: execution.snapshotId });
    if (!validation?.ok) return failedGate("file_safety", "workspace_drift", { conflicts: Array.isArray(validation?.conflicts) ? validation.conflicts.slice(0, 16) : [] });
    return passedGate("file_safety", { trackedFiles: execution.files?.length || 0, changedFiles: changed.length });
  } catch (error) {
    return failedGate("file_safety", /^[a-z0-9_]+$/i.test(String(error?.message || "")) ? error.message : "file_safety_failed");
  }
}

const SECRET_PATTERNS = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["openai_like_key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["browserpod_key", /\bbp\d+_[A-Za-z0-9_-]{20,}\b/],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["bearer_token", /\bBearer\s+[A-Za-z0-9._~+\/-]{24,}\b/i],
];

async function runSecurity({ root, task, policyInvalid, commands }) {
  const execution = latestAppliedExecution(task);
  if (!execution) return failedGate("security", "execution_snapshot_missing");
  if (policyInvalid) return failedGate("security", "verification_policy_invalid");
  if (commands.some((gate) => gate.blockedByPolicyChange)) return failedGate("security", "verification_command_source_changed");

  const findings = [];
  let scannedFiles = 0;
  const files = Array.isArray(execution.files) ? execution.files.filter((file) => file?.changed === true) : [];
  for (const file of files.slice(0, 32)) {
    const relativePath = safeRelativePath(file?.path);
    if (!relativePath) {
      findings.push({ path: String(file?.path || "").slice(0, 240), code: "unsafe_path" });
      continue;
    }
    const target = workspaceTarget(root, relativePath);
    if (!target) {
      findings.push({ path: relativePath, code: "path_escape" });
      continue;
    }
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) {
        findings.push({ path: relativePath, code: "symlink" });
        continue;
      }
      if (!info.isFile()) continue;
      if (info.size > MAX_SECURITY_FILE_BYTES) {
        findings.push({ path: relativePath, code: "security_scan_too_large" });
        continue;
      }
      const content = await readFile(target);
      scannedFiles += 1;
      if (content.includes(0)) continue;
      const text = content.toString("utf8");
      for (const [code, pattern] of SECRET_PATTERNS) {
        if (pattern.test(text)) findings.push({ path: relativePath, code });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") findings.push({ path: relativePath, code: "security_scan_failed" });
    }
  }

  if (findings.length) return failedGate("security", "security_findings", { findings: findings.slice(0, 16), scannedFiles });
  return passedGate("security", { scannedFiles });
}

function defaultCommandRunner({ workspace, argv, timeoutMs = GATE_TIMEOUT_MS }) {
  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    const executable = process.platform === "win32" && argv[0].toLowerCase() === "npm" ? "npm.cmd" : argv[0];
    const args = argv.slice(1);
    let outputBytes = 0;
    let outputCaptured = false;
    const digest = createHash("sha256");
    let settled = false;

    let child;
    try {
      child = spawn(executable, args, {
        cwd: workspace,
        env: safeChildEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch {
      resolveResult({ ok: false, exitCode: null, durationMs: Date.now() - startedAt, outputCaptured: false, outputBytes: 0, outputSha256: null, error: "verification_spawn_failed" });
      return;
    }

    const append = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputCaptured = outputCaptured || buffer.length > 0;
      outputBytes += buffer.length;
      digest.update(buffer);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({
        ...result,
        durationMs: Date.now() - startedAt,
        outputCaptured,
        outputBytes: Math.min(outputBytes, 10_000_000),
        outputSha256: outputCaptured ? digest.digest("hex") : null,
      });
    };

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish({ ok: false, exitCode: null, error: "verification_timeout" });
    }, timeoutMs);

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", () => finish({ ok: false, exitCode: null, error: "verification_spawn_failed" }));
    child.on("close", (code) => finish({ ok: code === 0, exitCode: Number.isInteger(code) ? code : null, ...(code === 0 ? {} : { error: "command_failed" }) }));
  });
}

async function runCommandGate(plan, { workspace, commandRunner, timeoutMs }) {
  if (!plan.argv) return skippedGate(plan);
  if (plan.blockedByPolicyChange) return blockedGate(plan, "verification_command_source_changed");
  const result = await commandRunner({ workspace, argv: plan.argv, timeoutMs });
  return {
    id: plan.id,
    label: plan.label,
    required: true,
    status: result?.ok === true ? "passed" : "failed",
    command: commandLabel(plan.argv),
    source: plan.source,
    ...(Number.isInteger(result?.exitCode) ? { exitCode: result.exitCode } : {}),
    ...(Number.isInteger(result?.durationMs) ? { durationMs: Math.max(0, result.durationMs) } : {}),
    ...(typeof result?.outputSha256 === "string" ? { outputSha256: result.outputSha256.slice(0, 64) } : {}),
    ...(result?.outputCaptured === true ? { outputCaptured: true } : {}),
    ...(Number.isInteger(result?.outputBytes) ? { outputBytes: Math.max(0, result.outputBytes) } : {}),
    ...(result?.ok === true ? {} : { error: /^[a-z0-9_]+$/i.test(String(result?.error || "")) ? result.error : "command_failed" }),
  };
}

export function createVerificationEngine({ workspace, snapshotStore, commandRunner = defaultCommandRunner, gateTimeoutMs = GATE_TIMEOUT_MS } = {}) {
  if (!snapshotStore || typeof snapshotStore.validateApplied !== "function") throw new TypeError("snapshotStore with validateApplied is required");

  async function verify({ task, ownerId }) {
    if (!task?.id || !ownerId) throw httpError("verification_context_missing", 500);
    const policy = await loadVerificationPolicy(workspace, task);
    const gates = [];

    const fileSafety = await runFileSafety({ task, ownerId, snapshotStore });
    gates.push(fileSafety);

    let security;
    if (fileSafety.status !== "passed") {
      security = blockedGate({ id: "security", label: LABELS.security, argv: null }, "file_safety_failed");
    } else {
      security = await runSecurity({ root: policy.root, task, policyInvalid: policy.policyInvalid, commands: policy.commands });
    }
    gates.push(security);

    const preflightOk = fileSafety.status === "passed" && security.status === "passed";
    for (const plan of policy.commands) {
      if (!plan.argv) {
        gates.push(skippedGate(plan));
      } else if (!preflightOk) {
        gates.push(blockedGate(plan, security.status !== "passed" ? "security_failed" : "file_safety_failed"));
      } else {
        gates.push(await runCommandGate(plan, { workspace: policy.root, commandRunner, timeoutMs: gateTimeoutMs }));
      }
    }

    const ordered = VERIFICATION_GATE_ORDER.map((id) => gates.find((gate) => gate.id === id)).filter(Boolean);
    const required = ordered.filter((gate) => gate.required === true);
    const passedRequired = required.filter((gate) => gate.status === "passed").length;
    const failedRequired = required.length - passedRequired;
    return {
      ok: failedRequired === 0,
      profile: "multi-gate-v0.5",
      requiredGates: required.length,
      passedRequired,
      failedRequired,
      gates: ordered,
    };
  }

  return { verify };
}
