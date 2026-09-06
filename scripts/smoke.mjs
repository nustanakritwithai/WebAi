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
  throw new Error("health endpoint did not become ready");
}

try {
  const health = await waitForHealth();
  const healthText = await health.text();
  const healthJson = JSON.parse(healthText);
  if (!healthJson.ok || healthJson.provider !== "opentyphoon" || healthJson.keyConfigured !== true || healthText.includes(placeholder)) {
    throw new Error("health response is not safe or does not match the contract");
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
    throw new Error("allowed origin did not receive its exact CORS header");
  }

  const rateStatuses = [];
  for (let requestNumber = 0; requestNumber < 31; requestNumber += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/typhoon/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    rateStatuses.push(response.status);
  }
  if (rateStatuses.slice(0, 30).some((status) => status !== 400) || rateStatuses[30] !== 429) {
    throw new Error("rate limit did not return the expected HTTP status");
  }
  console.log("SMOKE PASS: health, CORS rejection, exact CORS allowlist, redaction, and rate limit");
} finally {
  child.kill("SIGTERM");
}
