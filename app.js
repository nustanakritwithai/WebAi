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
      // Browser Agent runs entirely in the page through the existing Host A proxy.
      load("./capability-bridge.js");
    });
  });
})();
