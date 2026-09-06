# PR #10 — WebAi V0.4 Transaction, Snapshot & Rollback

## Goal

Make every approved Native Worker execution reversible and auditable before expanding WebAi into diff evidence, multi-gate verification, or automatic repair loops.

Core rule:

> WebAi Native Worker must not mutate the workspace unless a server-side snapshot exists and can be verified.

## Architecture boundary

PR #10 applies only to **Host B — WebAi Core / Worker Host**.

- Host A (`server/index.mjs`) remains OpenTyphoon Secret Proxy only.
- Host A must not gain workspace, snapshot, task-state, worker, or verification code.
- Snapshot storage must live outside `WEBAI_WORKSPACE`.
- Browser receives metadata only; original snapshot contents never leave Host B.

## Execution transaction

```text
Approve
  ↓
Acquire workspace lock
  ↓
Generate + validate Native Worker manifest
  ↓
Create executionId
  ↓
Snapshot all target files
  ↓
Record before SHA-256 / existed / mode
  ↓
Apply manifest
  ↓
Record after SHA-256
  ↓
Persist execution evidence
  ↓
Release lock
  ↓
Verification
  ├─ PASS → verified
  └─ FAIL → rollback available
```

## New server module

`server/snapshot-store.mjs`

Responsibilities:

- create durable snapshots outside workspace;
- hash before/after content with SHA-256;
- preserve whether a file existed and its mode;
- never follow symlinks;
- reject traversal, hidden paths, credentials, key/certificate files;
- record metadata with restrictive permissions where supported;
- rollback only when current file hashes still match the execution's recorded after hashes;
- verify restored hashes after rollback;
- return only bounded metadata, never raw snapshot content.

## Storage layout

```text
WEBAI_CORE_SNAPSHOT_DIR/
└─ owner-hash/
   └─ task-hash/
      └─ execution-hash/
         └─ snapshot-id/
            ├─ manifest.json
            └─ files/
               ├─ 000.bin
               ├─ 001.bin
               └─ ...
```

All path components derived from owner/task/execution identifiers are hashed before being used as filesystem names.

## Environment

Host B gains:

```text
WEBAI_CORE_SNAPSHOT_DIR=/srv/webai-worker/state/snapshots
```

Do not add this to Host A runtime.

## Task / execution state

Target execution record:

```json
{
  "executionId": "exec-...",
  "snapshotId": "snap-...",
  "status": "applied",
  "startedAt": "...",
  "completedAt": "...",
  "files": [
    {
      "path": "src/app.js",
      "existed": true,
      "beforeSha256": "...",
      "afterSha256": "...",
      "created": false,
      "changed": true,
      "bytes": 1234
    }
  ],
  "rollback": null
}
```

Raw file content must never be placed in task state.

## Rollback rules

Rollback may be requested only for the latest applicable execution in states such as:

- `awaiting_verification`
- `verification_failed`
- selected `failed` executions that have a completed snapshot

`completed` tasks are not rolled back through this endpoint. Reverting a verified task should become a new task later so audit history is preserved.

### Drift protection

Before rollback, every current target must match the recorded post-execution state.

```text
current SHA-256 == execution.afterSha256
```

If any target differs, rollback must abort before mutating any file:

```json
{
  "error": "rollback_conflict",
  "files": ["src/app.js"]
}
```

This prevents an old execution from overwriting a newer change.

## Proposed API

```text
POST /api/tasks/:taskId/rollback
x-webai-session: <signed owner session>
```

Owner/session rules from PR #9 remain authoritative. Owner B must not be able to rollback Owner A tasks.

## Workspace lock

PR #10 introduces an in-process workspace lock on Host B.

V0.4 behavior:

```text
Execution A → owns lock
Execution B → waits/rejects as busy
Execution A finishes → release lock
Execution B → may proceed
```

The lock interface should be designed so it can later become a lease/distributed lock in V1.0.

## UI scope

PR #10 should expose only transaction status, not a full diff viewer.

Example:

```text
EXECUTION
EXEC-0001
Snapshot       ✓ Safe
Files changed  3
Rollback       Available

[ View files ] [ Rollback ]
```

After rollback:

```text
ROLLED BACK
3/3 files restored
Snapshot verification PASS
```

## Acceptance tests

PR #10 must not merge until all are green:

1. existing file → modify → rollback restores exact bytes;
2. new file → rollback deletes it;
3. multi-file snapshot/rollback;
4. write failure mid-operation leaves workspace recoverable;
5. Core restart can still load snapshot and rollback;
6. Owner B cannot rollback Owner A task;
7. traversal snapshot target denied;
8. symlink target denied;
9. `.env` / credential / key path denied;
10. file changed after execution → `rollback_conflict` and zero files mutated;
11. rollback verifies final SHA-256 against snapshot;
12. completed task rollback denied;
13. concurrent execution is serialized;
14. snapshot raw content never appears in task/API responses;
15. Host A Secret Proxy remains free of snapshot/workspace/task code.

## CI target

```text
Proxy Smoke           PASS
Agent Lifecycle       PASS
Native Worker         PASS
Owner Isolation       PASS
Snapshot / Rollback   PASS
Core End-to-End       PASS
```

## Deliberately out of scope

PR #10 does not implement:

- full diff viewer;
- multi-gate verification;
- automatic repair loop;
- ECC;
- verified memory;
- Harpoon/benchmarking.

Those follow only after reversible execution is proven.
