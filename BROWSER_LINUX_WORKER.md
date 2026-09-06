# WebAi Browser Linux Worker

## Architecture lock

WebAi uses the browser/device for execution and keeps the VPS intentionally narrow.

```text
Browser / device
  ├─ WebAi UI
  ├─ Browser Linux Worker
  │   ├─ bash
  │   ├─ git
  │   ├─ Node.js / Rust-capable sandbox
  │   ├─ project workspace
  │   ├─ build / test runtime
  │   └─ preview portal
  └─ HTTPS → VPS Secret Proxy → OpenTyphoon
```

The VPS is not the coding machine. It stores the OpenTyphoon secret and exposes the secure proxy only.

## Current implementation

`browser-linux-worker.js` adds a client-side worker panel to the existing UI and uses BrowserPod 3.0.1 as the browser sandbox runtime.

Implemented:

- cross-origin isolation bootstrap for GitHub Pages using `coi-sw.js`
- user-supplied BrowserPod key stored only in session storage by default
- optional local-device persistence for that key
- persistent BrowserPod disk via `storageKey`
- real browser-side Linux-like sandbox boot
- bash / git / Node preflight
- clone/sync `nustanakritwithai/WebAi` into `/workspace/WebAi`
- interactive browser terminal
- git diff/stat evidence bridge
- static preview server running inside the browser sandbox
- BrowserPod Portal wired into the existing WebAi Preview tab
- OMP compatibility probe
- AI Team status for Browser Linux

## OMP gate

WebAi must not display OMP as ready unless an `omp` executable actually runs inside the browser worker.

Current upstream OMP releases are native Linux x64/arm64 binaries. BrowserPod currently runs applications compiled for the BrowserPod/Wasm platform and does not directly execute arbitrary prebuilt native npm/Linux binaries. Therefore this branch intentionally reports:

```text
Browser Linux  READY (after successful boot)
Git / Shell    READY (after preflight)
Workspace      READY (after clone/sync)
Preview        READY (after portal starts)
OMP            COMPATIBILITY PENDING
```

This is not a fake OMP installation. The execution adapter is ready for a future browser/Wasm-compatible OMP build.

## User flow

1. Open WebAi.
2. Scroll to **Browser Linux Worker**.
3. Enter a BrowserPod API key.
4. Press **Boot Browser Linux**.
5. On first use GitHub Pages may reload once to enable cross-origin isolation.
6. Press **Clone / Sync WebAi**.
7. Press **Open Shell** for an interactive shell.
8. Press **Start Preview** to expose the browser-local server through a Portal and render it in WebAi's Preview tab.
9. Press **Check OMP** to run the compatibility probe.

## Security boundaries

- `TYPHOON_API_KEY` stays on VPS only.
- BrowserPod key is never committed to Git and never sent to the VPS by WebAi.
- Project execution is isolated inside the browser sandbox.
- Browser Linux has no direct access to the host Android/PC filesystem unless a future explicit import/export feature is added.
- OMP remains disabled until a runnable browser build is verified.

## Next milestones

1. BrowserPod boot acceptance on Android Chrome and desktop Chrome/Firefox.
2. Repository import/sync beyond the hard-coded WebAi repository.
3. Files changed view from browser git status/diff.
4. Build/test command runner and verification evidence.
5. OMP browser build investigation: port OMP runtime or obtain an upstream BrowserPod/Wasm target.
6. Certified browser OMP RPC adapter.
7. Route `Execute` mode to browser OMP only after milestone 6 passes.
