(() => {
  const AUTO_BOOT_KEY = "webai.browserpod.autoboot";
  const SESSION_KEY = "webai.browserpod.key.session";

  const $ = (s) => document.querySelector(s);

  function showPhase(text, kind = "warn") {
    const badge = $("#browserWorkerBadge");
    const linux = $("#workerLinuxText");
    if (badge) {
      badge.className = `browserLinuxBadge ${kind}`;
      badge.textContent = text;
    }
    if (linux) linux.textContent = text;
  }

  async function prepareIsolation(event) {
    if (window.crossOriginIsolated) return;

    const button = event.target.closest?.("#bootBrowserLinux");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const input = $("#browserPodKey");
    const key = input?.value.trim() || "";
    if (!key) {
      alert("กรุณาใส่ BrowserPod API key ก่อน");
      return;
    }

    sessionStorage.setItem(SESSION_KEY, key);
    sessionStorage.setItem(AUTO_BOOT_KEY, "1");
    showPhase("PREPARING ISOLATION");

    try {
      if (!window.isSecureContext || !("serviceWorker" in navigator)) {
        throw new Error("Browser นี้ไม่รองรับ secure service worker ที่ Browser Linux ต้องใช้");
      }

      await navigator.serviceWorker.register("./coi-sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;
      showPhase("RELOADING…");
      setTimeout(() => location.reload(), 80);
    } catch (error) {
      sessionStorage.removeItem(AUTO_BOOT_KEY);
      showPhase("ISOLATION FAILED", "bad");
      alert(error.message || "เตรียม Browser Linux ไม่สำเร็จ");
    }
  }

  document.addEventListener("click", prepareIsolation, true);

  // Recover users who already hit the old one-reload bug in this tab.
  setTimeout(() => {
    const key = sessionStorage.getItem(SESSION_KEY) || "";
    const shouldBoot = sessionStorage.getItem(AUTO_BOOT_KEY) === "1";
    if (!window.crossOriginIsolated || !key || !shouldBoot) return;
    showPhase("BOOTING RUNTIME");
    window.WebAiBrowserWorker?.boot?.().catch((error) => {
      showPhase("BOOT FAILED", "bad");
      alert(error.message || "Browser Linux boot failed");
    });
  }, 250);
})();
