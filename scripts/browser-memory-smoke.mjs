import assert from "node:assert/strict";
import {
  buildRelatedContext,
  defaultSnapshot,
  exactCacheKey,
  recoverSnapshot,
  redactSecrets,
  wasRedacted
} from "../browser-memory-core.js";

const secret = "sk-this-is-a-test-secret-value";
const pairingToken = "bp1_test_pairing_token_value";
const clean = redactSecrets(`Authorization: Bearer abcdefghijklmnop ${secret} ${pairingToken} TYPHOON_API_KEY=${secret}`);
assert.equal(wasRedacted(secret), true);
assert.equal(clean.includes(secret), false);
assert.equal(clean.includes(pairingToken), false);
assert.match(clean, /REDACTED/);

const backup = { ...defaultSnapshot(), memoryRevision: 3, messages: [{ role: "user", content: "งานค้าง: เพิ่ม cache" }] };
assert.equal(recoverSnapshot({ messages: "broken" }, backup).memoryRevision, 3);
assert.equal(recoverSnapshot(null, null).messages.length, 1);

const key = exactCacheKey({ prompt: "สร้าง browser cache", mode: "agent", memoryRevision: 4 });
assert.equal(key, exactCacheKey({ prompt: "สร้าง browser cache", mode: "agent", memoryRevision: 4 }));
assert.notEqual(key, exactCacheKey({ prompt: "สร้าง browser cache", mode: "agent", memoryRevision: 5 }));

const context = buildRelatedContext("เพิ่ม browser cache สำหรับ agent", [{ prompt: "เพิ่ม browser cache", answer: "ใช้ IndexedDB และ Worker", tokens: ["เพิ่ม", "browser", "cache"] }]);
assert.match(context, /IndexedDB/);
assert.equal(buildRelatedContext("ตรวจ health ล่าสุด", [{ prompt: "ตรวจ health", answer: "old" }]), "");
console.log("browser-memory smoke: PASS");
