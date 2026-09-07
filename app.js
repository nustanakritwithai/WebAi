(() => {
  document.documentElement.dataset.executionTarget = "browser-agent";

  const scriptUrl = new URL(document.currentScript?.src || location.href, location.href);
  const releaseMeta = document.querySelector('meta[name="webai-release"]');
  const queryVersion = scriptUrl.searchParams.get("v");
  const declaredRelease = releaseMeta?.content;
  const assetVersion = declaredRelease && declaredRelease !== "dev"
    ? declaredRelease
    : queryVersion || declaredRelease || "dev";

  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = `./main-ui-v2.css?v=${encodeURIComponent(assetVersion)}`;
  document.head.appendChild(style);

  const load = (src, done) => {
    const script = document.createElement("script");
    script.src = `${src}?v=${encodeURIComponent(assetVersion)}`;
    script.async = false;
    if (done) script.onload = done;
    document.head.appendChild(script);
  };

  load("./browser-memory-client.js", () => {
    load("./app-core.js", () => {
      load("./main-ui-v2.js");
      // Browser Agent + Browser Memory remain the primary no-Host-B workflow.
      load("./capability-bridge.js", () => {
        // Core Execute is an optional execution plane layered on top.
        load("./core-bridge.js", () => {
          load("./core-execute.js", () => {
            load("./diff-evidence.js", () => load("./verification-evidence.js"));
          });
        });
      });
    });
  });
})();
