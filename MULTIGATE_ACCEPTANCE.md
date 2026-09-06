# V0.5 Multi-Gate Verification Acceptance

Merge only when the PR CI proves all of the following:

- Browser Agent, Browser Workspace, Browser Memory/AI Cache and Reasoning/CB-1.1 remain intact.
- Host A Secret Proxy contains no workspace, task, snapshot, worker or verification execution path.
- Host B Core uses `multi-gate-v0.5` and no longer owns a single hard-coded `npm test` verifier.
- File Safety validates the applied snapshot before project commands run.
- Security scans bounded changed-file content and returns codes/paths only.
- Configured Build/Unit/Integration/Regression gates are required; missing gates are explicitly skipped.
- A task cannot become `completed` unless all required gates pass.
- Changing `package.json` cannot redefine npm verification commands for the same execution unless an operator-owned protected policy is used.
- Verification command processes use argv + `shell: false`.
- Raw stdout/stderr never enters task state or browser responses; only bounded metadata and SHA-256 output evidence are retained.
- Verification failure leaves the transaction rollback path available.
- Core UI displays required/skipped/passed/failed/blocked gate state without replacing Browser Agent sandbox verification.
