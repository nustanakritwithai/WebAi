(() => {
  const load = (src, done) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    if (done) script.onload = done;
    document.head.appendChild(script);
  };

  load("./app.js", () => load("./capability-bridge.js"));
})();
