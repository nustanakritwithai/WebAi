(() => {
  document.documentElement.dataset.executionTarget = "browser-agent";

  const load = (src, done) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    if (done) script.onload = done;
    document.head.appendChild(script);
  };

  load("./browser-memory-client.js", () => {
    load("./app-core.js", () => {
      // Browser Agent + Browser Memory remain the primary no-Host-B workflow.
      load("./capability-bridge.js", () => {
        // Core Execute is an optional execution plane layered on top.
        load("./core-bridge.js", () => {
          load("./core-execute.js", () => load("./diff-evidence.js"));
        });
      });
    });
  });
})();
