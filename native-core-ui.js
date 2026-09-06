(() => {
  document.documentElement.dataset.executionTarget = "webai-native";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function replaceText(node, replacements) {
    if (!node) return;
    let text = node.textContent || "";
    for (const [from, to] of replacements) text = text.replaceAll(from, to);
    node.textContent = text;
  }

  function cleanupLegacyBrowserRuntime() {
    const sessionKeys = [
      "webai.browserpod.key.session",
      "webai.browserpod.autoboot",
      "webai.browserpod.tab-id",
    ];
    const localKeys = ["webai.browserpod.key.local"];
    for (const key of sessionKeys) sessionStorage.removeItem(key);
    for (const key of localKeys) localStorage.removeItem(key);

    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
        if (/\/coi-sw\.js(?:$|\?)/.test(script)) registration.unregister().catch(() => {});
      }
    }).catch(() => {});
  }

  function hideLegacyOmpUi() {
    $("#ompStatusDot")?.closest(".overviewItem")?.setAttribute("hidden", "");
    $("#teamOmp")?.closest("div")?.setAttribute("hidden", "");
    const executeOption = $("#taskMode option[value='execute']");
    if (executeOption) executeOption.remove();
  }

  function installNativeCoreRow() {
    const grid = $(".teamGrid");
    if (!grid || $("#teamNativeCore")) return;
    const row = document.createElement("div");
    row.innerHTML = '<span id="teamNativeCore" class="tinyDot ok"></span><b>WebAi Core</b><small>Supervised state machine</small>';
    const aiCpu = $$(':scope > div', grid).find((item) => item.querySelector("b")?.textContent === "AI CPU");
    if (aiCpu) aiCpu.replaceWith(row);
    else grid.prepend(row);
  }

  function relabelStaticUi() {
    const mode = $("#taskMode option[value='agent']");
    if (mode) mode.textContent = "WebAi Core";

    const welcomeCopy = $(".welcome p");
    if (welcomeCopy) welcomeCopy.textContent = "บอกเป้าหมายเดียว แล้ว WebAi Core จะวางแผน รออนุมัติ ลงมือผ่าน worker ของเรา และตรวจหลักฐานก่อน DONE";

    const agentMeta = $$(".taskMeta small").find((node) => node.textContent.trim() === "AGENT");
    if (agentMeta) agentMeta.textContent = "CORE";

    const supervisedKicker = $(".agentActions .sectionKicker");
    if (supervisedKicker) supervisedKicker.textContent = "WEBAI CORE · SUPERVISED";

    const hint = $("#agentActionHint");
    if (hint && !hint.dataset.nativeCoreLabel) {
      hint.dataset.nativeCoreLabel = "1";
      replaceText(hint, [["Agent", "WebAi Core"], ["agent", "WebAi Core"]]);
    }

    const approve = $("#approveExecutionBtn");
    if (approve) approve.innerHTML = 'Approve &amp; Run Core <span>→</span>';

    const readySmall = $("#stepReady small");
    if (readySmall) readySmall.textContent = "Typhoon + WebAi Core";

    $$("#tab-preview .emptyState small, #tab-diff .emptyState small").forEach((node) => {
      replaceText(node, [["OMP", "WebAi Core"], ["repository", "workspace"]]);
    });

    const teamTitle = $("#monitor .cardHead h3");
    if (teamTitle) teamTitle.textContent = "Core Services";
  }

  function reconcileDynamicLabels() {
    const activeMode = $("#activeMode");
    if (activeMode?.textContent === "Supervised Agent") activeMode.textContent = "WebAi Core";

    const runLabel = $("#runTaskBtn span");
    if (runLabel?.textContent.includes("Agent Task")) runLabel.textContent = "Create Core Task → Review Plan";

    const hint = $("#agentActionHint");
    if (hint) replaceText(hint, [["Agent", "WebAi Core"], ["agent", "WebAi Core"]]);
  }

  cleanupLegacyBrowserRuntime();
  hideLegacyOmpUi();
  installNativeCoreRow();
  relabelStaticUi();
  reconcileDynamicLabels();

  const observer = new MutationObserver(reconcileDynamicLabels);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
})();
