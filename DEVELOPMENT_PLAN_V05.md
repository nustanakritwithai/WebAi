# WebAi V0.5+ Development Plan

## Purpose

WebAi now has a split architecture: Host A is an OpenTyphoon Secret Proxy and Host B is the isolated WebAi Core/Native Worker. V0.4 added a durable snapshot-store foundation. This plan turns that foundation into a safe, auditable agent before expanding autonomy.

The operating rule remains:

> No workspace mutation without an approved task, a durable snapshot, and deterministic verification.

## Current baseline

| Area | Current state | Constraint |
| --- | --- | --- |
| Host A | OpenTyphoon secret proxy | Must never receive workspace, task, worker, or snapshot logic |
| Host B | signed sessions, owner-isolated task state, Native Worker | Has no provider API key; uses Host A only |
| Execution | bounded create/replace manifests | No shell commands or unrestricted deletion |
| Snapshot store | durable files, hashes, exact restore primitives | Not yet wired into an execution transaction |
| Verification | deterministic `npm test` path | Needs explicit gates and evidence |

## V0.5 — Reversible execution transaction

### Outcome

Every Native Worker execution is a persisted transaction. A failed verification can be rolled back safely by its owner without overwriting newer workspace changes.

### Build order

1. Add a workspace lock in `server/core.mjs`.
   - Reject a concurrent execution with `workspace_busy`; do not queue silently.
   - Release the lock in `finally` on success, failure, timeout, and disconnect.
   - Keep the interface compatible with a future lease/distributed lock.

2. Wire `server/snapshot-store.mjs` into the approved execution path.
   - Validate the Native Worker manifest before touching the workspace.
   - Create an `executionId` and durable pre-change snapshot before applying any write.
   - Persist only metadata: snapshot id, hashes, file paths, byte counts, timestamps, and state.
   - Capture post-write hashes before releasing the lock.

3. Add rollback API and UI state.
   - `POST /api/tasks/:taskId/rollback` is owner-scoped and works only for the newest eligible execution.
   - Allow from `awaiting_verification`, `verification_failed`, and selected failed execution states.
   - Deny rollback for completed tasks.
   - Check every post-write hash before the first restore; if any differs, return `rollback_conflict` and mutate nothing.
   - Show transaction status, changed-file count, snapshot availability, and rollback result in the UI. Do not expose snapshot contents.

### Acceptance gates

- Modify existing file and rollback restores exact bytes and mode.
- Create file and rollback removes it.
- Multi-file write is all-or-recoverable.
- Core restart can load a prior snapshot and complete rollback.
- Owner B cannot read or rollback Owner A's transaction.
- Traversal, symlink, hidden, credential, key, and certificate paths are denied.
- Drift yields `rollback_conflict` with zero mutations.
- Host A contract test proves it still contains no workspace/task/worker/snapshot code.

## V0.6 — Evidence and verification gates

### Outcome

An agent run produces machine-checkable evidence rather than a worker narrative, and a task becomes completed only when all configured gates pass.

### Build order

1. Introduce a verification runner registry on Host B.
   - Fixed operator-configured commands only; never execute a model-supplied command.
   - Initial gates: syntax, unit, integration, security contract, and regression smoke.
   - Each gate has timeout, exit code, bounded/redacted output, and timestamp.

2. Persist structured evidence per execution.
   - Store gate status, command identifier, duration, exit code, artifact hashes, and bounded output.
   - Store file diff metadata only: path, before/after hash, size, operation, and line-count summary when safe.
   - Never return raw secret-bearing source or logs in list/task summaries.

3. Add a review-facing UI.
   - Timeline: plan → approved → snapshot → execution → each verification gate → completed/failed/rolled back.
   - A failed gate offers rollback; a passed task offers no direct rollback.
   - Add an explicit "open evidence" view with redaction notices.

### Acceptance gates

- A missing or failed required gate keeps the task out of `completed`.
- Gate logs are bounded and redact configured secret patterns.
- Retrying verification does not rerun the worker or create a new snapshot.
- Evidence remains readable after Core restart and owner isolation remains intact.

## V0.7 — Supervised repair loop

### Outcome

The agent can propose a bounded repair after verification failure, but every new workspace mutation remains separately approved and reversible.

### Build order

1. Convert failed evidence into a repair proposal, not an automatic write.
   - Include only redacted, bounded failure evidence and affected-file metadata in the model context.
   - Limit one proposed repair manifest per attempt.

2. Add repair policy.
   - Max repair attempts per task, per owner, and per hour.
   - A repair creates a new `executionId`, snapshot, approval record, and verification record.
   - Prevent repair after rollback conflict until the user starts a fresh task.

3. Add operator controls.
   - Approve, reject, or rollback each proposed repair.
   - Make budget/attempt limits visible before approval.

### Acceptance gates

- Failure does not trigger an unapproved write.
- Every repair has a distinct transaction and complete evidence chain.
- Attempt limits fail closed.
- A repair cannot overwrite a drifted workspace.

## V0.8 — Engineering policy and verified memory

### Outcome

Agent behavior becomes consistent across tasks without allowing unverified model output to become long-term instruction.

### Build order

1. Add ECC policy packs selected by repository type and task class.
   - Policies define allowed paths, required gates, max file count, and forbidden operations.
   - Policy version and selected rules are recorded in task evidence.

2. Add verified memory.
   - Write memory only from completed, verified tasks or explicit operator annotations.
   - Index summaries, constraints, test commands, and known regressions—not raw source, credentials, or unverified chat.
   - Memory retrieval is advisory and must cite its evidence source inside the task record.

### Acceptance gates

- A policy can deny an otherwise valid manifest before snapshot creation.
- Unverified/rolled-back task output cannot enter memory.
- Memory reads respect owner/repository isolation.

## V0.9 — Measurement, deployment, and scale readiness

### Outcome

WebAi has measurable quality/cost/performance evidence and can be operated on a real isolated worker host safely.

### Build order

1. Add Harpoon-style metrics.
   - Track task duration, plan/repair count, files changed, gate pass rate, rollback rate, token usage when available, and cost estimate.
   - Compare before/after benchmark outcomes with stable fixtures.

2. Production hardening.
   - Rotate Core session secret and pairing token.
   - Add audit retention, state/snapshot backup policy, disk quota, and cleanup jobs.
   - Add health/readiness endpoints for both hosts and alert on failed verification, workspace lock saturation, storage exhaustion, or token failures.

3. Release gates.
   - A held-out benchmark suite must show no regression against the supervised baseline.
   - Publish an operator runbook for incident response, rollback conflict, Core recovery, and secret rotation.

## Non-negotiable guardrails

- Host A owns `TYPHOON_API_KEY` only; Host B must never receive it.
- Browser tokens are short-lived; pairing tokens are one-time and never persisted.
- CORS is not authorization; every Core task action requires signed owner session authorization.
- Model output is data, never executable shell input.
- No task is DONE solely because a model says so.
- Snapshot content, raw credentials, and unbounded logs must not leave Host B.
- New autonomy is introduced only after the prior milestone's regression and security gates are green.

## Delivery sequence

| Release | Merge condition | User-visible capability |
| --- | --- | --- |
| V0.5 | transaction + rollback acceptance suite green | Safe rollback after failed execution |
| V0.6 | all verification gates produce persisted evidence | Explainable pass/fail decision |
| V0.7 | repair proposal/approval limits green | Supervised repair attempts |
| V0.8 | ECC + verified-memory isolation green | Consistent repository-aware behavior |
| V0.9 | benchmark, operations, and recovery runbook green | Measurable production-ready agent |
