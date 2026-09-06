(() => {
  document.documentElement.dataset.executionTarget = "webai-native";

  const load = (src, done) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    if (done) script.onload = done;
    document.head.appendChild(script);
  };

  load("./browser-memory-client.js", () => {
    load("./app-core.js", () => {
      load("./capability-bridge.js");
    });
  });
})();
