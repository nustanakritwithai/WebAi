# WebAi Reasoning Engine V0.1 + Capability Benchmark CB-1.1

## Goal

Measure and improve the small model's two weakest areas without confusing protocol formatting failures with semantic reasoning failures.

## Reasoning Engine V0.1

The engine uses the same OpenTyphoon model through the existing server-side secret proxy. It does not add a larger judge model.

Pipeline:

1. **Decompose** — identify up to four short subtask labels.
2. **Solve** — produce a candidate answer.
3. **Verify** — check logic/arithmetic, constraints, dependencies and unsupported assumptions.
4. **Revise** — correct the candidate when needed.
5. **Final** — return the final answer.

The implementation uses two model calls per batch: Decompose+Solve, then Verify+Revise+Final. Prompts explicitly request concise audit summaries rather than hidden chain-of-thought.

## CB-1.1

CB-1.1 replaces the fragile Reasoning/Planning slice of CB-1.0 with:

- 20 Reasoning tests = 50 points
- 15 Planning tests = 40 points
- Protocol quality = 10 points

Protocol is scored separately from semantic capability. Raw responses are parsed as JSON first, then a best-effort ID-line fallback is attempted before semantic grading.

### Error taxonomy

- `REASONING_ERROR`
- `PLANNING_ERROR`
- `CONSTRAINT_ERROR`
- `FORMAT_ERROR`
- `MISSING_ANSWER`
- `PASS`

A format fault can therefore coexist with a correct semantic answer without zeroing the Reasoning/Planning score.

## Benchmark modes

### Raw Baseline

One model call per batch of four tests. 35 tests require 9 calls.

### Reasoning Engine

Two model calls per batch. 35 tests require 18 calls.

This stays below the current 30 request/minute proxy ceiling for a single full run.

## Security boundary

- API key remains server-side.
- Browser calls only `/api/health` and `/api/typhoon/chat`.
- No repository or server execution is performed by the Reasoning lab.
- Result history is stored only in browser localStorage and can be exported as JSON.

## Interpretation

Compare Raw vs Reasoning Engine using the category scores, not only total score. The target signal is a repeatable uplift in Reasoning and Planning while Protocol is reported independently.
