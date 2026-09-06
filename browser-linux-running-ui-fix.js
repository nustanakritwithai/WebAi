(() => {
  let preflightStarted = false;
  let done = false;

  function setRunningUi() {
    const worker = window.WebAiBrowserWorker;
    if (!worker?.getStatus) return false;
    const status = worker.getStatus();
    if (!status?.linuxReady) return false;

    const boot = document.querySelector("#bootBrowserLinux");
    const badge = document.querySelector("#browserWorkerBadge");
    const linuxText = document.querySelector("#workerLinuxText");
    const linuxDot = document.querySelector("#workerLinuxDot");
    const teamDot = document.querySelector("#teamBrowserLinux");
    const teamText = document.querySelector("#teamBrowserLinuxText");

    if (boot) {
      boot.disabled = true;
      boot.textContent = "Linux Running";
    }
    if (badge) {
      badge.className = "browserLinuxBadge ok";
      badge.textContent = "LINUX RUNNING";
    }
    if (linuxText) linuxText.textContent = "Running";
    if (linuxDot) linuxDot.className = "ok";
    if (teamDot) teamDot.className = "tinyDot ok";
    if (teamText) teamText.textContent = "Running locally";

    document.documentElement.dataset.browserLinuxReady = "true";
    return true;
  }

  function renderRuntimeSummary(text, kind = "ok") {
    const info = document.querySelector("#browserPortalInfo");
    if (!info) return;
    info.classList.add("show");
    info.dataset.runtimeSummary = kind;
    info.textContent = text;
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("preflight_timeout")), ms)),
    ]);
  }

  async function runNonBlockingPreflight() {
    if (preflightStarted) return;
    const worker = window.WebAiBrowserWorker;
    if (!worker?.runCapture) return;
    preflightStarted = true;
    renderRuntimeSummary("Linux ready · checking Node / Git / Bash…", "working");

    try {
      const results = await withTimeout(Promise.all([
        worker.runCapture("node", ["--version"]),
        worker.runCapture("git", ["--version"]),
        worker.runCapture("bash", ["--version"]),
      ]), 8000);
      const node = String(results[0] || "node ready").split("\n")[0];
      const git = String(results[1] || "git ready").split("\n")[0];
      const bash = String(results[2] || "bash ready").split("\n")[0];
      renderRuntimeSummary(`Runtime ready · ${node} · ${git} · ${bash}`, "ok");
    } catch (error) {
      const message = error?.message === "preflight_timeout"
        ? "Linux ready · runtime preflight ยังทำงานต่อเบื้องหลัง — ใช้ Clone / Sync หรือ Open Shell ได้แล้ว"
        : `Linux ready · preflight warning: ${String(error?.message || error)}`;
      renderRuntimeSummary(message, "warn");
    }
  }

  function sync() {
    if (!setRunningUi()) return;
    runNonBlockingPreflight();
    done = true;
  }

  window.addEventListener("webai:browser-worker-status", sync);

  const observer = new MutationObserver(() => {
    if (document.documentElement.dataset.browserLinuxReady === "true") setRunningUi();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    sync();
    if ((done && attempts > 8) || attempts > 240) clearInterval(timer);
  }, 250);
})();
