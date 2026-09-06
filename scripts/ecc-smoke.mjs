import assert from "node:assert/strict";
import { ECC_POLICY_VERSION, selectEccPolicy } from "../ecc-policy-core.js";
import { exactCacheKey } from "../browser-memory-core.js";

const browser = selectEccPolicy({ prompt: "แก้หน้าเว็บ mobile UI และทดสอบ error state", mode: "agent" });
assert.equal(browser.version, ECC_POLICY_VERSION);
assert.deepEqual(browser.ids, ["baseline", "browser-ui", "testing-review"]);
assert.match(browser.context, /Browser\/UI/);

const proxy = selectEccPolicy({ prompt: "สร้าง API proxy ที่ห้ามส่ง token และต้องตรวจ CORS", mode: "review" });
assert.deepEqual(proxy.ids, ["baseline", "api-proxy", "security", "testing-review"]);
assert.match(proxy.context, /server-owned values/);

const first = exactCacheKey({ prompt: "ตรวจ api", mode: "ask", memoryRevision: 2, eccFingerprint: browser.fingerprint });
const second = exactCacheKey({ prompt: "ตรวจ api", mode: "ask", memoryRevision: 2, eccFingerprint: proxy.fingerprint });
assert.notEqual(first, second, "ECC policy change must invalidate exact cache");
assert.equal(selectEccPolicy({ prompt: "hello", mode: "ask" }).ids.join(","), "baseline");
console.log("ECC SMOKE PASS: deterministic policy selection, bounded policy context, and cache isolation");
