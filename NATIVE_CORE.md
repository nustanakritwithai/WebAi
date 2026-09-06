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

`server/native-worker.mjs` is our own execution engine. It is intentionally narrower than a general shell agent:

- uses OpenTyphoon to produce a structured file manifest;
- reads only bounded text context from the configured workspace;
- ignores hidden directories, `.git`, `.github`, `.webai`, `node_modules`, build outputs, and large files;
- redacts common API-key patterns before context is sent to the model;
- accepts only create/replace text-file operations;
- rejects path traversal, hidden paths, credential-like paths, key/certificate files, symlinks, duplicate writes, oversized files, and oversized manifests;
- writes atomically and performs best-effort rollback if a multi-file write fails;
- never accepts model-provided shell commands or delete operations in V0.1.

## Production selection

Set:

```text
WEBAI_NATIVE_WORKER_ENABLED=true
WEBAI_WORKSPACE=/absolute/path/to/workspace
```

When enabled, the PR #6 supervised service routes `Approve & Run Core` to `WebAi Native Worker V0.1`. The old worker dependency remains only as a disabled fallback path while migration is completed. The browser UI no longer exposes OMP or BrowserPod.

Worker evidence stored in task state is bounded to safe metadata: worker name, summary, changed file paths, created/changed flags, and byte counts. Raw model output and raw file contents are not copied into task state.

## Next milestone

1. Expose a first-class `nativeWorker` capability in `/api/health`.
2. Remove the legacy OMP execution endpoint and OMP code from `server/index.mjs` after native acceptance passes.
3. Add a dedicated workspace snapshot / rollback checkpoint before every execution.
4. Add retry-from-verification-failure without bypassing approval history.
5. Expand verification from one `npm test` command into build / unit / integration / security / regression gates.
6. Add file-level diff evidence to the UI without exposing secrets or raw environment data.
