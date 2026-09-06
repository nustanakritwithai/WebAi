# Agent transition smoke tests

Run the deterministic agent checks with:

```text
npm run agent-smoke
```

The suite imports `server/agent.mjs` directly and injects stub planner, worker, and verifier functions. It does not call Typhoon, OMP, or any other external API. The checks cover:

- missing and malformed task goals;
- `planning → awaiting_approval → executing → awaiting_verification → verifying → completed`;
- approval and verification gates, including repeat/early calls;
- worker and verification failure states;
- raw model-output boundaries and worker/error secret redaction probes;
- state-file restore behavior.

Security probes are reported as `KNOWN FINDING` and make the command fail until the underlying service behavior is hardened. The test-only probe does not modify `server/index.mjs`, the UI, or production state.
