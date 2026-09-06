(() => {
  const busy = { name: "", shellOpen: false };
  const orderHint = "ลำดับที่แนะนำ: Clone / Sync → Check OMP → Start Preview → Open Shell";

  function $(selector) { return document.querySelector(selector); }

  function showInfo(text, kind = "working") {
    const info = $("#browserPortalInfo");
    if (!info) return;
    info.classList.add("show");
    info.dataset.operation = kind;
    info.textContent = text;
  }

  function setDisabled(selector, value) {
    const el = $(selector);
    if (el) el.disabled = !!value;
  }

  function refreshButtons() {
    const worker = window.WebAiBrowserWorker;
    const status = worker?.getStatus?.() || {};
    const locked = !!busy.name || busy.shellOpen;

    setDisabled("#prepareBrowserWorkspace", !status.linuxReady || locked);
    setDisabled("#probeBrowserOmp", !status.linuxReady || locked);
    setDisabled("#startBrowserPreview", !status.workspaceReady || locked);
    setDisabled("#startBrowserShell", !status.linuxReady || locked);

    const shell = $("#startBrowserShell");
    if (shell && busy.shellOpen) shell.textContent = "Shell Open";
  }

  function begin(name, message) {
    busy.name = name;
    showInfo(message, "working");
    refreshButtons();
  }

  function finish(message, kind = "ok") {
    busy.name = "";
    showInfo(message, kind);
    refreshButtons();
  }

  function waitUntil(test, { timeoutMs, intervalMs = 250 } = {}) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        try {
          const value = test();
          if (value) {
            clearInterval(timer);
            resolve(value);
            return;
          }
        } catch {}
        if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(new Error("operation_timeout"));
        }
      }, intervalMs);
    });
  }

  function guardClick(event) {
    const button = event.target.closest?.("button");
    if (!button) return;
    const id = button.id;
    if (!["prepareBrowserWorkspace", "probeBrowserOmp", "startBrowserShell", "startBrowserPreview"].includes(id)) return;

    if (busy.shellOpen && id !== "startBrowserShell") {
      event.preventDefault();
      event.stopImmediatePropagation();
      showInfo("Shell เปิดอยู่ จึงหยุดงาน background เพื่อไม่ให้แย่ง terminal · reload หน้าเมื่อจะกลับมาทำ Clone/Check", "warn");
      return;
    }
    if (busy.name) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showInfo(`กำลังทำ ${busy.name} อยู่ · รอให้งานนี้จบก่อน`, "warn");
      return;
    }

    const worker = window.WebAiBrowserWorker;
    const status = worker?.getStatus?.() || {};

    if (id === "prepareBrowserWorkspace") {
      begin("Clone / Sync", "กำลัง Clone / Sync WebAi ใน background · ปุ่มอื่นถูกล็อกชั่วคราว");
      waitUntil(() => window.WebAiBrowserWorker?.getStatus?.().workspaceReady, { timeoutMs: 60000 })
        .then(() => finish("Workspace mounted · ต่อไปกด Check OMP หรือ Start Preview ได้", "ok"))
        .catch(() => finish("Clone / Sync ใช้เวลานานเกิน 60 วินาที · ตรวจ network ใน BrowserPod แล้วลองใหม่", "warn"));
      return; // allow the original worker handler to execute
    }

    if (id === "probeBrowserOmp") {
      begin("Check OMP", "กำลังตรวจ OMP · รอผลก่อนเริ่มงานอื่น");
      waitUntil(() => {
        const text = $("#workerOmpText")?.textContent || "";
        return text && !/checking/i.test(text) ? text : "";
      }, { timeoutMs: 12000 })
        .then((text) => finish(`OMP check finished · ${text}`, /ready|version/i.test(text) ? "ok" : "warn"))
        .catch(() => finish("OMP check timeout · browser/Wasm build ยังไม่ยืนยัน", "warn"));
      return;
    }

    if (id === "startBrowserPreview") {
      begin("Start Preview", "กำลังเปิด Preview จาก Browser Linux");
      waitUntil(() => window.WebAiBrowserWorker?.getStatus?.().previewUrl, { timeoutMs: 20000 })
        .then(() => finish("Preview ready", "ok"))
        .catch(() => finish("Preview ยังไม่เปิดภายใน 20 วินาที · ตรวจ runtime log", "warn"));
      return;
    }

    if (id === "startBrowserShell") {
      if (!status.workspaceReady) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showInfo(`${orderHint} · เตรียม Workspace ก่อนเปิด interactive shell`, "warn");
        return;
      }
      busy.shellOpen = true;
      showInfo("Interactive shell เปิดแล้ว · งาน Clone/Check/Preview จะถูกล็อกเพื่อไม่ให้แย่ง terminal", "ok");
      setTimeout(refreshButtons, 0);
    }
  }

  document.addEventListener("click", guardClick, true);
  window.addEventListener("webai:browser-worker-status", refreshButtons);
  setInterval(refreshButtons, 1000);

  setTimeout(() => {
    const status = window.WebAiBrowserWorker?.getStatus?.() || {};
    if (status.linuxReady && !status.workspaceReady) showInfo(orderHint, "info");
    refreshButtons();
  }, 500);
})();
