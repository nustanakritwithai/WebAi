(() => {
  const fallbackRedact = (value) => String(value ?? "")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b|\b(?:bp\d+|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/=:-]{8,}/gi, "$1[REDACTED]")
    .replace(/\b((?:TYPHOON_)?API(?:_|\s)?KEY|AUTHORIZATION|ACCESS(?:_|\s)?TOKEN|SESSION(?:_|\s)?TOKEN|PASSWORD|SECRET)\s*([:=])\s*[^\s'"`]+/gi, "$1$2[REDACTED]");
  let sequence = 0;
  let worker;
  const pending = new Map();
  try {
    worker = new Worker("./browser-memory-worker.js", { type: "module", name: "webai-browser-memory" });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data?.id);
      if (!request) return;
      pending.delete(data.id);
      data.ok ? request.resolve(data.result) : request.reject(new Error(data.error || "Browser memory ล้มเหลว"));
    };
    worker.onerror = () => {
      for (const request of pending.values()) request.reject(new Error("Browser memory worker ไม่พร้อม"));
      pending.clear();
    };
  } catch { worker = null; }

  function call(type, payload = {}) {
    if (!worker) return Promise.reject(new Error("Browser memory worker ไม่พร้อม"));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });
  }

  window.WebAiMemory = {
    supported: () => Boolean(worker && window.indexedDB),
    init: () => call("init"),
    prepare: (payload) => call("prepare", payload),
    recordExchange: (payload) => call("recordExchange", payload),
    saveTask: (task) => call("saveTask", { task }),
    async sanitize(text, limit) {
      try { return (await call("sanitize", { text, limit })).text; }
      catch { return fallbackRedact(text); }
    }
  };
})();
