(() => {
  "use strict";

  const VERSION = "RE-0.1";
  const DEFAULT_BASE = "https://157.85.96.139:5444";

  function normalizeBase(value) {
    return String(value || localStorage.getItem("webai.apiBase") || DEFAULT_BASE).trim().replace(/\/+$/, "");
  }

  function stripFence(text) {
    const value = String(text ?? "").trim();
    const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : value;
  }

  function extractJsonArray(text) {
    const clean = stripFence(text);
    const first = clean.indexOf("[");
    const last = clean.lastIndexOf("]");
    if (first < 0 || last <= first) return { ok: false, items: [] };
    try {
      const parsed = JSON.parse(clean.slice(first, last + 1));
      return { ok: Array.isArray(parsed), items: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { ok: false, items: [] };
    }
  }

  async function readJsonResponse(response) {
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) throw Object.assign(new Error(`Backend returned non-JSON (${response.status})`), { status: response.status });
    const data = await response.json();
    if (!response.ok) {
      const error = Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
      const retry = Number(response.headers.get("retry-after") || 0);
      if (Number.isFinite(retry) && retry > 0) error.retryAfter = retry;
      throw error;
    }
    return data;
  }

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function chat(baseUrl, messages, options = {}) {
    const base = normalizeBase(baseUrl);
    const maxTokens = Math.max(200, Math.min(4096, Number(options.maxTokens || 1800)));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = performance.now();
      try {
        const response = await fetch(`${base}/api/typhoon/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, temperature: 0, max_tokens: maxTokens }),
          signal: options.signal,
        });
        const data = await readJsonResponse(response);
        return { data, latencyMs: Math.round(performance.now() - started) };
      } catch (error) {
        if (error.name === "AbortError") throw error;
        if (error.status === 429 && attempt === 0) {
          const seconds = Math.max(1, Math.min(60, Number(error.retryAfter || 60)));
          options.onRateLimit?.(seconds);
          await sleep(seconds * 1000);
          continue;
        }
        throw error;
      }
    }
    throw new Error("Rate-limit retry failed");
  }

  function rawContent(data) { return data?.choices?.[0]?.message?.content || ""; }

  function itemMap(items) {
    const map = new Map();
    for (const item of items || []) {
      if (!item || typeof item.id !== "string") continue;
      map.set(item.id, item);
    }
    return map;
  }

  function safeList(value, max = 5) {
    return Array.isArray(value) ? value.slice(0, max).map((entry) => String(entry)) : [];
  }

  async function runBatch(items, options = {}) {
    const normalized = (items || []).map((item) => ({ id: String(item.id), prompt: String(item.prompt) }));
    if (!normalized.length) throw new Error("No reasoning items supplied");
    options.onStage?.("decompose_solve", { count: normalized.length });

    const pass1System = [
      "You are WebAi Reasoning Engine V0.1.",
      "Do NOT reveal hidden chain-of-thought. Return only concise decision summaries useful for verification.",
      "For each task: identify up to 4 short subtask labels, state only necessary assumptions, and produce a candidate answer.",
      "Return ONLY a valid JSON array in this shape:",
      '[{"id":"R-01","decomposition":["subtask label"],"assumptions":[],"candidate":"final candidate"}]',
      "Keep candidate directly responsive to the user's requested output.",
    ].join(" ");

    const first = await chat(options.baseUrl, [
      { role: "system", content: pass1System },
      { role: "user", content: JSON.stringify(normalized) },
    ], options);
    const firstParsed = extractJsonArray(rawContent(first.data));
    const firstMap = itemMap(firstParsed.items);

    const verificationPayload = normalized.map((item) => {
      const stage = firstMap.get(item.id) || {};
      return {
        id: item.id,
        prompt: item.prompt,
        decomposition: safeList(stage.decomposition, 4),
        assumptions: safeList(stage.assumptions, 4),
        candidate: String(stage.candidate ?? ""),
      };
    });

    options.onStage?.("verify_revise", { count: normalized.length });
    const pass2System = [
      "You are the verification/revision stage of WebAi Reasoning Engine V0.1.",
      "Do NOT expose hidden chain-of-thought. Check the candidate against the original prompt using concise audit notes only.",
      "For each task, check arithmetic/logic, constraints, dependencies, unsupported assumptions, and requested output format when relevant.",
      "Revise when needed and return the best final answer.",
      "Return ONLY a valid JSON array in this shape:",
      '[{"id":"R-01","checks":["logic:pass","constraints:pass"],"revised":"candidate or corrected answer","final":"final answer"}]',
    ].join(" ");

    const second = await chat(options.baseUrl, [
      { role: "system", content: pass2System },
      { role: "user", content: JSON.stringify(verificationPayload) },
    ], options);
    const secondParsed = extractJsonArray(rawContent(second.data));
    const secondMap = itemMap(secondParsed.items);

    const results = normalized.map((item) => {
      const stage1 = firstMap.get(item.id) || {};
      const stage2 = secondMap.get(item.id) || {};
      const candidate = String(stage1.candidate ?? "");
      const revised = String(stage2.revised ?? "");
      const final = String(stage2.final ?? revised ?? candidate).trim() || candidate.trim();
      return {
        id: item.id,
        prompt: item.prompt,
        decomposition: safeList(stage1.decomposition, 4),
        assumptions: safeList(stage1.assumptions, 4),
        candidate,
        checks: safeList(stage2.checks, 5),
        revised,
        final,
      };
    });

    options.onStage?.("final", { count: results.length });
    return {
      version: VERSION,
      results,
      protocol: {
        pass1Json: firstParsed.ok,
        pass1Ids: firstMap.size,
        pass2Json: secondParsed.ok,
        pass2Ids: secondMap.size,
        expected: normalized.length,
      },
      latencyMs: first.latencyMs + second.latencyMs,
      calls: 2,
      usage: {
        prompt_tokens: Number(first.data?.usage?.prompt_tokens || 0) + Number(second.data?.usage?.prompt_tokens || 0),
        completion_tokens: Number(first.data?.usage?.completion_tokens || 0) + Number(second.data?.usage?.completion_tokens || 0),
        total_tokens: Number(first.data?.usage?.total_tokens || 0) + Number(second.data?.usage?.total_tokens || 0),
      },
    };
  }

  async function run(prompt, options = {}) {
    const batch = await runBatch([{ id: "TASK", prompt }], options);
    return { ...batch.results[0], meta: { version: batch.version, protocol: batch.protocol, latencyMs: batch.latencyMs, calls: batch.calls, usage: batch.usage } };
  }

  window.WebAiReasoningEngine = { VERSION, DEFAULT_BASE, normalizeBase, extractJsonArray, runBatch, run };
})();
