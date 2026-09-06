# WebAi Native Core

This branch continues from PR #6 (`feat: add supervised agent workflow`) and deliberately removes BrowserPod / Browser Linux from the active product path.

## Architecture

```text
User Goal
   ↓
WebAi Core state machine
   ↓
OpenTyphoon Planner
   ↓
AWAITING APPROVAL
   ↓
WebAi Native Worker
   ↓
Workspace changes
   ↓
AWAITING VERIFICATION
   ↓
Deterministic Verification
   ↓
DONE only after PASS
```

The lifecycle, persistence, approval gate, and verification gate come from PR #6. BrowserPod and browser-Linux execution are not part of this architecture.

## Native Worker V0.1

`server/native-worker.mjs` is our own execution engine foundation. It is intentionally narrower than a general shell agent:

- uses OpenTyphoon to produce a structured file manifest;
- reads only bounded text context from the configured workspace;
- ignores hidden directories, `.git`, `.github`, `.webai`, `node_modules`, build outputs, and large files;
- redacts common API-key patterns before context is sent to the model;
- accepts only create/replace text-file operations;
- rejects path traversal, hidden paths, credential-like paths, key/certificate files, symlinks, duplicate writes, oversized files, and oversized manifests;
- writes atomically and performs best-effort rollback if a multi-file write fails;
- never accepts model-provided shell commands or delete operations in V0.1.

## Current gate

The Native Worker library is implemented and regression-tested, but this PR does **not** switch the production approval endpoint from the legacy OMP adapter yet. That switch is the next milestone after the worker guard suite is green in CI.

This staging rule is intentional: a worker must pass deterministic safety tests before it is allowed to mutate a production workspace.

## Next milestone

1. Inject `createNativeWorker(...).run` into the PR #6 supervised service as the production `runWorker`.
2. Expose `nativeWorker` capability in `/api/health`.
3. Remove the legacy OMP execution endpoint and OMP ENV surface.
4. Record `changedFiles` as bounded task evidence.
5. Add rollback/retry controls and a dedicated workspace snapshot before execution.
6. Expand verification from one `npm test` command into build / unit / integration / security / regression gates.
