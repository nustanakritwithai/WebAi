(() => {
  document.documentElement.dataset.executionTarget = "browser";

  const load = (src, done) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    if (done) script.onload = done;
    document.head.appendChild(script);
  };

  load("./app-core.js", () => {
    load("./capability-bridge.js", () => {
      load("./browserpod-storage-lock-fix.js", () => {
        Promise.resolve(window.WebAiBrowserPodPatchReady)
          .catch(() => {})
          .finally(() => load("./browser-linux-worker-v03.js"));
      });
    });
  });
})();