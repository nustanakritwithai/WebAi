import { spawn } from "node:child_process";

const port = 8799;
const child = spawn(process.execPath, ["server/index.mjs"], {
  env: { ...process.env, PORT: String(port), TYPHOON_API_KEY: "", OMP_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));
try {
  let ok = false;
  for (let i = 0; i < 20; i++) {
    await wait(150);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      const data = await r.json();
      if (r.ok && data.ok && data.provider === "opentyphoon") { ok = true; break; }
    } catch {}
  }
  if (!ok) throw new Error("health endpoint did not become ready");
  console.log("SMOKE PASS: WebAi API boots and /api/health responds");
} finally {
  child.kill("SIGTERM");
}
