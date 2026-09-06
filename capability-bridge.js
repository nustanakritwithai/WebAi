(() => {
  function findTeam(name) {
    return [...document.querySelectorAll(".teamGrid > div")]
      .find((row) => row.querySelector("b")?.textContent?.trim().toLowerCase() === name.toLowerCase());
  }

  function ensureTeam(name) {
    let row = findTeam(name);
    if (row) return row;
    const grid = document.querySelector(".teamGrid");
    if (!grid) return null;
    row = document.createElement("div");
    row.innerHTML = '<span class="tinyDot idle"></span><b></b><small>Waiting</small>';
    row.querySelector("b").textContent = name;
    grid.appendChild(row);
    return row;
  }

  function paintTeam(name, capability, readyLabel = "Configured") {
    const row = ensureTeam(name);
    if (!row) return;
    const dot = row.querySelector(".tinyDot");
    const text = row.querySelector("small");
    let kind = "idle";
    let label = "Disabled";
    if (capability?.enabled) {
      if (capability?.configured) { kind = "ok"; label = readyLabel; }
      else { kind = "warn"; label = "Needs ENV"; }
    }
    dot.className = `tinyDot ${kind}`;
    text.textContent = label;
    row.dataset.capability = capability?.enabled ? (capability?.configured ? "configured" : "needs-env") : "disabled";
  }

  function installHeaderBridge() {
    try {
      if (typeof headers === "function") {
        headers = function () {
          const h = { "Content-Type": "application/json" };
          const token = localStorage.getItem("webai.sessionToken") || "";
          if (token) h["x-webai-token"] = token;
          return h;
        };
      }
    } catch {
      // Old core builds may not expose headers as a mutable global binding.
    }
  }

  function installOptionalTokenInput(authEnabled) {
    const form = document.querySelector(".connectionForm");
    if (!form) return;
    let label = document.querySelector("#envSessionTokenLabel");
    if (!authEnabled) {
      label?.remove();
      return;
    }
    if (!label) {
      label = document.createElement("label");
      label.id = "envSessionTokenLabel";
      label.innerHTML = 'Session token <em>optional</em><input id="envSessionToken" type="password" autocomplete="off" placeholder="WEB_AUTH_TOKEN"><small>ใช้เมื่อ VPS เปิด WEB_AUTH_TOKEN</small>';
      const save = document.querySelector("#saveConfig");
      form.insertBefore(label, save || null);
      document.querySelector("#envSessionToken")?.addEventListener("input", (event) => {
        localStorage.setItem("webai.sessionToken", event.target.value.trim());
      });
    }
    const input = document.querySelector("#envSessionToken");
    if (input) input.value = localStorage.getItem("webai.sessionToken") || "";
  }

  function syncCoreState(data, ompReady) {
    try {
      if (typeof state !== "undefined") {
        state.typhoonConfigured = !!(data?.capabilities?.typhoon?.configured ?? data?.keyConfigured ?? data?.typhoonConfigured);
        state.ompEnabled = ompReady;
      }
      if (typeof applyActionState === "function") applyActionState();
    } catch {
      // UI status still updates even if an older core hides its state binding.
    }
  }

  function applyCapabilities(data) {
    const caps = data?.capabilities || {};
    const ompReady = !!(caps.omp?.enabled && caps.omp?.configured);
    syncCoreState(data, ompReady);

    const ompDot = document.querySelector("#ompStatusDot");
    const ompState = document.querySelector("#ompState");
    if (ompDot) ompDot.className = `tinyDot ${ompReady ? "ok" : caps.omp?.enabled ? "warn" : "idle"}`;
    if (ompState) ompState.textContent = ompReady ? "พร้อม" : caps.omp?.enabled ? "รอ ENV" : "ยังปิด";

    const teamOmp = document.querySelector("#teamOmp");
    const teamOmpText = document.querySelector("#teamOmpText");
    if (teamOmp) teamOmp.className = `tinyDot ${ompReady ? "ok" : caps.omp?.enabled ? "warn" : "idle"}`;
    if (teamOmpText) teamOmpText.textContent = ompReady ? "Configured" : caps.omp?.enabled ? "Needs ENV" : "Disabled";

    paintTeam("ECC", caps.ecc);
    paintTeam("Hermes", caps.hermes);
    paintTeam("OpenClaw", caps.openclaw);
    paintTeam("Harpoon", caps.harpoon);

    const previewStatus = document.querySelector("#previewStatus");
    if (previewStatus && caps.preview) {
      previewStatus.textContent = caps.preview.enabled
        ? (caps.preview.configured ? "Preview channel configured" : "Preview เปิดแล้ว · รอ ENV")
        : "Preview channel disabled";
    }

    installOptionalTokenInput(!!data?.authEnabled);
    installHeaderBridge();
    document.documentElement.dataset.envCapabilities = "loaded";
    document.documentElement.dataset.omp = ompReady ? "ready" : caps.omp?.enabled ? "needs-env" : "disabled";
  }

  async function refreshCapabilities() {
    const base = (localStorage.getItem("webai.apiBase") || "https://157.85.96.139:5444").replace(/\/+$/, "");
    if (!base) return;
    try {
      const h = { "Content-Type": "application/json" };
      const token = localStorage.getItem("webai.sessionToken") || "";
      if (token) h["x-webai-token"] = token;
      const response = await fetch(`${base}/api/health`, { headers: h, cache: "no-store" });
      if (!response.ok) return;
      applyCapabilities(await response.json());
    } catch {
      // Core app owns connection-error UX.
    }
  }

  window.WebAiCapabilities = { refresh: refreshCapabilities, apply: applyCapabilities };
  installHeaderBridge();
  setTimeout(refreshCapabilities, 500);
  setInterval(refreshCapabilities, 30_000);
  document.querySelector("#saveConfig")?.addEventListener("click", () => setTimeout(refreshCapabilities, 900));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshCapabilities();
  });
})();
