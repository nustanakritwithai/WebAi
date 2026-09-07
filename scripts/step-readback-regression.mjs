import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
const start = source.indexOf("function readbackEvidenceForRecord");
const end = source.indexOf("\nfunction buildBrowserTaskHandoff", start);
assert.ok(start >= 0 && end > start, "readback evidence helpers must remain available in app-core");

const context = {
  TextEncoder, Object, Number, Boolean, Date, String, RegExp,
  utf8Bytes: (value) => new TextEncoder().encode(value).byteLength
};
vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.readbackEvidenceForRecord = readbackEvidenceForRecord;\nglobalThis.stepEvidenceForReadback = stepEvidenceForReadback;`, context);

const step = { id: "step-1", targetFiles: ["index.html"] };
const path = "tasks/BROWSER-12345678/index.html";
const content = "<main>ready</main>";
const completeRecord = { path, content, version: 1, hash: "a".repeat(64) };
const complete = context.stepEvidenceForReadback(step, { [path]: completeRecord }, "tasks/BROWSER-12345678");
assert.equal(complete.readback.ok, true);
const completeEvidence = complete.readback.files["index.html"];
assert.equal(completeEvidence.ok, true);
assert.equal(completeEvidence.path, path);
assert.equal(completeEvidence.revision, 1);
assert.equal(completeEvidence.version, 1);
assert.equal(completeEvidence.hash, "a".repeat(64));
assert.equal(completeEvidence.contentPresent, true);
assert.equal(completeEvidence.contentBytes, new TextEncoder().encode(content).byteLength);

const emptyContent = context.stepEvidenceForReadback(step, {
  [path]: { ...completeRecord, content: "" }
}, "tasks/BROWSER-12345678");
assert.equal(emptyContent.readback.ok, true, "an intentionally empty file is still a complete readback");
assert.equal(emptyContent.readback.files["index.html"].contentBytes, 0);

const missingMetadata = context.stepEvidenceForReadback(step, {
  [path]: { content, version: 1, hash: "a".repeat(64) }
}, "tasks/BROWSER-12345678");
assert.equal(missingMetadata.readback.ok, false, "missing path must not pass readback evidence");

const missingHash = context.stepEvidenceForReadback(step, {
  [path]: { path, content, version: 1 }
}, "tasks/BROWSER-12345678");
assert.equal(missingHash.readback.ok, false, "missing hash must not pass readback evidence");

console.log("PASS step-1 readback evidence: path, revision/version, content presence/bytes, and hash are complete");
