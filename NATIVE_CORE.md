# WebAi Native Core

WebAi continues from PR #6 (`feat: add supervised agent workflow`) but now separates the OpenTyphoon secret proxy from task execution completely.

## Architecture lock

```text
GitHub Pages / WebAi UI
   │
   ├── HTTPS → Host A: Secret Proxy (`server/index.mjs`)
   │             ├─ owns TYPHOON_API_KEY
   │             ├─ /api/health
   │             ├─ /api/typhoon/chat
   │             ├─ /api/chat
   │             └─ /api/plan
   │
   └── HTTPS → Host B: WebAi Core (`server/core.mjs`)
                 ├─ signed owner sessions
                 ├─ per-owner task state
                 ├─ PR #6 supervised lifecycle
                 ├─ WebAi Native Worker
                 ├─ workspace
                 └─ deterministic verification
```

Host A must not contain a workspace, task database, Native Worker, verification process, or task endpoints. Host B must not contain the OpenTyphoon provider API key; it reaches OpenTyphoon only through Host A.

## Supervised lifecycle

```text
Goal
 ↓
OpenTyphoon plan via Secret Proxy
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
PASS → DONE
FAIL → not DONE
```

The lifecycle, persistence, approval gate, and verification gate come from PR #6.

## Owner/session authorization

Task APIs are not protected by CORS alone. `server/core.mjs` requires a signed `x-webai-session` for all task operations.

1. The browser keeps a stable random `clientId`.
2. The user provides `WEBAI_CORE_PAIRING_TOKEN` only when pairing.
3. `/api/session` exchanges it for a short-lived HMAC-signed session token.
4. The pairing token is not stored by the WebAi UI.
5. Each owner gets a separate persisted task-state file derived from a SHA-256 hash of the owner id.
6. A valid session for owner B cannot read, approve, verify, or list owner A's tasks.

`WEBAI_CORE_SESSION_SECRET` must be a strong random secret stored only on the Core/Worker host.

## Native Worker V0.1

`server/native-worker.mjs` is WebAi's own guarded file execution engine. It is intentionally narrower than a general shell agent:

- uses OpenTyphoon through the configured proxy to produce a structured file manifest;
- reads only bounded text context from the configured workspace;
- ignores hidden directories, `.git`, `.github`, `.webai`, `node_modules`, build outputs, and large files;
- redacts common API-key patterns before context is sent to the model;
- accepts only create/replace text-file operations;
- rejects path traversal, hidden paths, credential-like paths, key/certificate files, symlinks, duplicate writes, oversized files, and oversized manifests;
- writes atomically and performs best-effort rollback if a multi-file write fails;
- never accepts model-provided shell commands or delete operations in V0.1.

Task state stores only bounded worker metadata such as worker name and changed-file metadata. Raw model output and raw file contents are not persisted in task state.

## Starting each service

Secret Proxy host:

```text
npm run start:proxy
```

WebAi Core / isolated worker host:

```text
npm run start:core
```

See `.env.example` for the two separate environment surfaces. Do not copy Core workspace/task environment variables onto the VPS Secret Proxy.

## Next milestones

1. Add workspace snapshot + rollback before every approved execution.
2. Add file-level diff evidence without leaking secret content.
3. Split Verification into build / unit / integration / security / regression gates.
4. Add retry/fix loop that preserves approval history.
5. Add ECC policy selection before execution.
6. Add Hermes-style memory only from verified outcomes.
7. Add Harpoon performance evidence and before/after regression metrics.
