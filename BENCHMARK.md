# WebAi Model Benchmark CB-1.0

CB-1.0 is a transparent, deterministic regression benchmark for measuring whether the same small model improves when WebAi adds a reasoning harness around it.

## What it measures

The suite contains 30 fixed tests across seven weighted categories:

| Category | Weight | Tests |
| --- | ---: | ---: |
| Instruction following | 15 | 5 |
| Reasoning | 20 | 6 |
| Coding | 25 | 7 |
| Planning | 15 | 4 |
| Agent judgement | 10 | 3 |
| Self-correction | 10 | 3 |
| Hallucination resistance | 5 | 2 |

The weighted category points sum to 100.

## Two run modes

### Raw Model Baseline

Each test is answered once through the existing `/api/typhoon/chat` secret proxy. No API key is stored in the benchmark page.

### WebAi Assisted

The same model first answers each batch, then a second pass receives the original prompt plus its candidate answer and is instructed to review/correct it. Only the corrected answer is scored. This isolates the uplift from a simple reflection layer while keeping the underlying model constant.

## Deterministic scoring

CB-1.0 does not use another LLM as a judge. Graders are local browser rules such as:

- exact / case-insensitive exact match;
- numeric match;
- normalized code alternatives;
- required-term coverage.

For required-term tests, partial credit is deterministic based on the fraction of required terms present. All other current graders are binary.

## Batching and rate limits

Tests are sent in batches of three. A baseline run uses 10 model calls. An assisted run uses 20 calls. This keeps one baseline + one assisted run at the proxy's current 30 requests/minute ceiling. If the provider or proxy returns HTTP 429, the page honors `Retry-After` once and can be stopped by the user.

## Result storage

The latest runs are stored only in browser `localStorage` (up to 12 runs). A baseline run is also stored as the comparison anchor for the uplift score. Results can be exported as JSON.

## Important limitation

CB-1.0 is a **transparent regression benchmark**, not a held-out anti-cheating benchmark. Its purpose is to compare the same model and the same test set before/after WebAi system layers in a repeatable way. A later held-out suite should keep prompts and graders server-side and version test sets separately.
