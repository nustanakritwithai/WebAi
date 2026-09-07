import { spawn } from "node:child_process";

const port = 8799;
const placeholder = "test-value-must-not-appear-in-response";
const child = spawn(process.execPath, ["server/index.mjs"], {
  env: { ...process.env, PORT: String(port), TYPHOON_API_KEY: placeholder },
  stdio: ["ignore", "pipe", "pipe"],
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(100);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return response;
    } catch {}
  }
  throw new Error("proxy health endpoint did not become ready");
}

try {
  const health = await waitForHealth();
  const healthText = await health.text();
  const healthJson = JSON.parse(healthText);
  if (!healthJson.ok
    || healthJson.service !== "webai-typhoon-proxy"
    || healthJson.provider !== "opentyphoon"
    || healthJson.keyConfigured !== true
    || healthJson.capabilities?.secretProxy?.configured !== true
    || "nativeWorker" in (healthJson.capabilities || {})
    || "webaiCore" in (healthJson.capabilities || {})
    || "workspaceConfigured" in healthJson
    || healthText.includes(placeholder)) {
    throw new Error("proxy health is not minimal or secret-safe");
  }

  const rejected = await fetch(`http://127.0.0.1:${port}/api/typhoon/chat`, {
    method: "POST",
    headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
  });
  if (rejected.status !== 403 || (await rejected.json()).error !== "origin_not_allowed" || rejected.headers.get("access-control-allow-origin")) {
    throw new Error("untrusted origin was not rejected safely");
  }

  const allowed = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Origin: "https://nustanakritwithai.github.io" } });
  if (allowed.headers.get("access-control-allow-origin") !== "https://nustanakritwithai.github.io") {
    throw new Error("allowed origin did not receive exact CORS header");
  }

  for (const path of ["/api/tasks", "/api/agent/tasks", "/api/omp/prompt"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.status !== 404 || (await response.json()).error !== "not_found") {
      throw new Error(`proxy unexpectedly exposes ${path}`);
    }
  }

  const rateStatuses = [];
  // A minute rollover between requests resets the server's minute bucket. Run
  // enough requests to cross at most one boundary while still proving 429 occurs.
  for (let requestNumber = 0; requestNumber < 62; requestNumber += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/typhoon/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "proxy-rate-test" },
      body: "{}",
    });
    rateStatuses.push(response.status);
  }
  if (rateStatuses.some((status) => ![400, 429].includes(status)) || !rateStatuses.includes(429)) {
    throw new Error("proxy rate limit did not return expected status");
  }

  console.log("SMOKE PASS: secret proxy only, no task/worker endpoints, CORS, redaction, rate limit");
} finally {
  child.kill("SIGTERM");
}
