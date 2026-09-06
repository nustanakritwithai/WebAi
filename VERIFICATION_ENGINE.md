# WebAi V0.5 Multi-Gate Verification

Core Execute does not become `DONE` because a model says the work is complete. Host B runs a deterministic verification profile after the Native Worker transaction has produced a durable snapshot and Diff Evidence.

## Gate order

The safety preflight runs before any project command:

1. **File Safety** — validates the recorded applied snapshot still matches the workspace and requires at least one effective change.
2. **Security** — re-checks changed paths/symlinks and scans bounded changed-file content for high-confidence secret/private-key patterns.
3. **Build** — runs only when configured.
4. **Unit Tests** — runs only when configured.
5. **Integration** — runs only when configured.
6. **Regression** — runs only when configured; an existing `test` script is the default regression command.

A configured gate is required. A gate with no configured command is `skipped` and is not counted as required. `DONE` requires every required gate to pass.

## Command ownership

The model never returns verification shell commands.

By default WebAi selects only known script names from the workspace's existing `package.json`:

- `build`
- `test:unit` or `unit`
- `test:integration` or `integration`
- `test:regression`, `regression`, or `test`

If the current execution changed `package.json`, npm-based verification commands are fail-closed with `verification_command_source_changed`. This prevents the same execution from redefining its own verifier.

An operator may provide a protected policy at `.webai/verification.json`. The Native Worker already denies hidden paths, so the model cannot write this file through the normal execution path.

Example:

```json
{
  "version": 1,
  "gates": {
    "build": ["npm", "run", "build"],
    "unit": ["npm", "run", "test:unit"],
    "integration": ["npm", "run", "test:integration"],
    "regression": ["npm", "test"]
  }
}
```

Policy commands are argv arrays and are spawned with `shell: false`. Arguments are bounded before use.

## Evidence boundary

Task state stores bounded metadata only:

- gate id / label / required state
- `passed`, `failed`, `blocked`, or `skipped`
- static command label
- exit code and duration
- output byte count and SHA-256 digest
- bounded error/finding codes

Raw stdout/stderr is not persisted in task state or returned to the browser. Secret scan findings contain only a file path and finding code, never the matched secret value.

## Failure behavior

If File Safety fails, all project command gates are blocked. If Security fails, project command gates are blocked. A failed or blocked required gate leaves the task in `verification_failed`, so the existing transaction can still be inspected and rolled back.
