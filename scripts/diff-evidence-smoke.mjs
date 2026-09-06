import assert from "node:assert/strict";
import { createDiffEvidence } from "../server/diff-evidence.mjs";

const same = createDiffEvidence({ beforeContent: "a\nb\n", afterContent: "a\nb\n" });
assert.deepEqual(same, { changed: false, additions: 0, deletions: 0, diffExact: true, diffKind: "unchanged" });

const created = createDiffEvidence({ beforeExists: false, beforeContent: null, afterContent: "a\nb\n" });
assert.equal(created.changed, true);
assert.equal(created.additions, 2);
assert.equal(created.deletions, 0);
assert.equal(created.diffExact, true);
assert.equal(created.diffKind, "created");

const replaced = createDiffEvidence({ beforeContent: "a\nb\nc\n", afterContent: "a\nx\nc\nd\n" });
assert.equal(replaced.changed, true);
assert.equal(replaced.additions, 2);
assert.equal(replaced.deletions, 1);
assert.equal(replaced.diffExact, true);
assert.equal(replaced.diffKind, "line-exact");

const deleted = createDiffEvidence({ beforeContent: "a\nb\n", afterExists: false, afterContent: null });
assert.equal(deleted.additions, 0);
assert.equal(deleted.deletions, 2);
assert.equal(deleted.diffKind, "deleted");

const binary = createDiffEvidence({ beforeContent: Buffer.from([0, 1, 2]), afterContent: Buffer.from([0, 3, 4]) });
assert.equal(binary.changed, true);
assert.equal(binary.additions, null);
assert.equal(binary.deletions, null);
assert.equal(binary.diffExact, false);
assert.equal(binary.diffKind, "non-text");

const hugeBefore = Array.from({ length: 5_000 }, (_, index) => `old-${index}`).join("\n");
const hugeAfter = Array.from({ length: 5_000 }, (_, index) => `new-${index}`).join("\n");
const bounded = createDiffEvidence({ beforeContent: hugeBefore, afterContent: hugeAfter });
assert.equal(bounded.changed, true);
assert.equal(bounded.diffExact, false);
assert.equal(bounded.diffKind, "bounded-replacement");
assert.equal(bounded.additions, 5_000);
assert.equal(bounded.deletions, 5_000);

console.log("DIFF EVIDENCE SMOKE PASS: unchanged, create, replace, delete, non-text, bounded fallback");
