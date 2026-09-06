(() => {
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
      // The base app still owns proxy connection behavior if bindings are private.
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
      label.innerHTML = 'Proxy token <em>optional</em><input id="envSessionToken" type="password" autocomplete="off" placeholder="WEB_AUTH_TOKEN"><small>ใช้เฉพาะเมื่อ Secret Proxy เปิด WEB_AUTH_TOKEN</small>';
      const save = document.querySelector("#saveConfig");
      form.insertBefore(label, save || null);
      document.querySelector("#envSessionToken")?.addEventListener("input", (event) => {
        localStorage.setItem("webai.sessionToken", event.target.value.trim());
      });
    }
    const input = document.querySelector("#envSessionToken");
    if (input) input.value = localStorage.getItem("webai.sessionToken") || "";
  }

  function applyProxyCapabilities(data) {
    try {
      if (typeof state !== "undefined") {
        state.typhoonConfigured = !!(data?.capabilities?.typhoon?.configured ?? data?.keyConfigured ?? data?.typhoonConfigured);
        state.ompEnabled = false;
      }
      if (typeof applyActionState === "function") applyActionState();
    } catch {}

    document.querySelector("#ompStatusDot")?.closest(".overviewItem")?.setAttribute("hidden", "");
    document.querySelector("#teamOmp")?.closest("div")?.setAttribute("hidden", "");
    installOptionalTokenInput(!!data?.authEnabled);
    installHeaderBridge();
    document.documentElement.dataset.proxyCapabilities = data?.capabilities?.secretProxy?.configured ? "ready" : "needs-key";
  }

  async function refreshProxyCapabilities() {
    const base = (localStorage.getItem("webai.apiBase") || "https://157.85.96.139:5444").replace(/\/+$/, "");
    if (!base) return;
    try {
      const h = { "Content-Type": "application/json" };
      const token = localStorage.getItem("webai.sessionToken") || "";
      if (token) h["x-webai-token"] = token;
      const response = await fetch(`${base}/api/health`, { headers: h, cache: "no-store" });
      if (!response.ok) return;
      applyProxyCapabilities(await response.json());
    } catch {
      // The base app owns proxy connection-error UX.
    }
  }

  window.WebAiCapabilities = { refresh: refreshProxyCapabilities, apply: applyProxyCapabilities };
  installHeaderBridge();
  setTimeout(refreshProxyCapabilities, 500);
  setInterval(refreshProxyCapabilities, 30_000);
  document.querySelector("#saveConfig")?.addEventListener("click", () => setTimeout(refreshProxyCapabilities, 900));
})();
