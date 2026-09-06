(() => {
  const RUNTIME_URL = "https://rt.browserpod.io/3.0.1/browserpod.js";
  const BASE_STORAGE_KEY = "webai-browser-linux-v01";
  const TAB_ID_KEY = "webai.browserpod.tab-id";

  function freshId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function tabId({ rotate = false } = {}) {
    let id = rotate ? "" : sessionStorage.getItem(TAB_ID_KEY) || "";
    if (!id) {
      id = freshId();
      sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  }

  function recoveryStorageKey() {
    return `${BASE_STORAGE_KEY}:tab:${tabId()}`;
  }

  function showRecoveryStatus() {
    const linuxText = document.querySelector("#workerLinuxText");
    const badge = document.querySelector("#browserWorkerBadge");
    if (linuxText) linuxText.textContent = "Storage busy · retrying";
    if (badge) {
      badge.className = "browserLinuxBadge warn";
      badge.textContent = "OPENING NEW DEVICE";
    }
  }

  async function installPatch() {
    const module = await import(RUNTIME_URL);
    const BrowserPod = module?.BrowserPod;
    if (!BrowserPod?.boot) throw new Error("BrowserPod.boot unavailable");
    if (BrowserPod.boot.__webaiStorageLockPatch) return;

    const originalBoot = BrowserPod.boot.bind(BrowserPod);

    const patchedBoot = async (options = {}) => {
      const primaryOptions = { ...options };
      try {
        return await originalBoot(primaryOptions);
      } catch (error) {
        const message = String(error?.message || error || "");
        if (!/device already opened in another tab/i.test(message)) throw error;

        showRecoveryStatus();
        tabId({ rotate: true });
        const retryOptions = {
          ...primaryOptions,
          storageKey: primaryOptions.storageKey === BASE_STORAGE_KEY
            ? recoveryStorageKey()
            : `${String(primaryOptions.storageKey || BASE_STORAGE_KEY)}:tab:${tabId()}`,
        };

        window.dispatchEvent(new CustomEvent("webai:browserpod-storage-recovery", {
          detail: { recoveredFromTabLock: true },
        }));

        return originalBoot(retryOptions);
      }
    };

    Object.defineProperty(patchedBoot, "__webaiStorageLockPatch", { value: true });
    BrowserPod.boot = patchedBoot;
    document.documentElement.dataset.browserpodStorageLockFix = "ready";
  }

  window.WebAiBrowserPodPatchReady = installPatch().catch((error) => {
    console.error("WebAi BrowserPod storage lock patch failed", error);
    throw error;
  });
})();
