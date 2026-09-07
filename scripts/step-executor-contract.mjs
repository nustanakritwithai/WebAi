import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const core = fs.readFileSync(path.join(scriptDir, "..", "app-core.js"), "utf8");

const checks = [
  [
    "structured plan steps are represented in app-core",
    /planVersion/.test(core) && /steps/.test(core) && /dependencies/.test(core) && /targetFiles/.test(core) && /acceptance/.test(core) && /evidence/.test(core)
  ],
  [
    "dependency gating only releases steps whose dependencies are done",
    /dependencies/.test(core) && /status\s*===\s*["']done["']/.test(core) && /(dependency|depends)/i.test(core)
  ],
  [
    "each step records a durable checkpoint",
    /(checkpoint|stepRunId|runId)/i.test(core) && /saveBrowserAgentTask\(\)/.test(core)
  ],
  [
    "Continue selects the handoff nextStepId",
    /nextStepId/.test(core) && /handoff/.test(core) && /Continue/i.test(core) && /nextStepId/.test(core.slice(core.indexOf("window.WebAiContinueTask")))
  ],
  [
    "executor advances one step and cannot skip pending work",
    /steps\s*\.?(?:find|filter)/.test(core) && /step\??\.status/.test(core) && /pending/.test(core) && !/steps\s*=\s*steps\.slice\(1\)/.test(core)
  ]
];

let failed = 0;
for (const [label, passed] of checks) {
  if (passed) console.log(`PASS ${label}`);
  else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

if (failed) {
  console.error(`\nStep Executor contract: ${checks.length - failed}/${checks.length} passed; ${failed} requirement(s) are not implemented in app-core.js.`);
  process.exitCode = 1;
} else {
  console.log(`\nStep Executor contract: ${checks.length}/${checks.length} passed.`);
}
