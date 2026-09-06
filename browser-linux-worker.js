(() => {
  const RUNTIME_URL = "https://rt.browserpod.io/3.0.1/browserpod.js";
  const STORAGE_KEY = "webai-browser-linux-v01";
  const REPO_URL = "https://github.com/nustanakritwithai/WebAi.git";
  const WORKSPACE = "/workspace/WebAi";
  const PREVIEW_PORT = 4173;
  const sessionKey = "webai.browserpod.key.session";
  const localKey = "webai.browserpod.key.local";
  const autoBootKey = "webai.browserpod.autoboot";

  const state = {
    pod: null,
    terminal: null,
    captureTerminal: null,
    booting: false,
    ready: false,
    workspaceReady: false,
    shellStarted: false,
    ompReady: false,
    ompVersion: "",
    portalUrl: "",
    portalPort: null,
    previewPromise: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function addStylesheet() {
    if (document.querySelector('link[href="./browser-linux-worker.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./browser-linux-worker.css";
    document.head.appendChild(link);
  }

  function injectPanel() {
    if ($("#browserLinuxWorker")) return;
    const lowerGrid = $(".lowerGrid");
    if (!lowerGrid?.parentNode) return;

    const section = document.createElement("section");
    section.id = "browserLinuxWorker";
    section.className = "browserLinuxSection";
    section.innerHTML = `
      <div class="browserLinuxHead">
        <div>
          <span class="sectionKicker">CLIENT-SIDE EXECUTION</span>
          <h2>Browser Linux Worker</h2>
          <p>Linux-like sandbox, Git, Shell, Workspace และ Preview ทำงานบนอุปกรณ์นี้ ไม่ใช่บน VPS</p>
        </div>
        <span id="browserWorkerBadge" class="browserLinuxBadge warn">NOT BOOTED</span>
      </div>
      <div class="browserLinuxBody">
        <div class="browserLinuxSetup">
          <label><b>BrowserPod API key</b>
            <input id="browserPodKey" type="password" autocomplete="off" placeholder="วาง BrowserPod key เพื่อ boot Linux">
          </label>
          <div class="browserLinuxKeyRow">
            <label><input id="rememberBrowserPodKey" type="checkbox"> จำ key บนอุปกรณ์นี้</label>
            <button id="forgetBrowserPodKey" class="ghostBtn" type="button">ลืม key</button>
          </div>
          <div class="browserLinuxNote"><b>คนละ key กับ OpenTyphoon</b> — BrowserPod key ใช้ boot sandbox ใน browser เท่านั้น และจะไม่ถูก commit ลง Git หรือส่งไป VPS</div>
          <div class="browserLinuxStatusGrid">
            <div class="browserLinuxStatus"><i id="workerIsolationDot"></i><div><small>ISOLATION</small><b id="workerIsolationText">Checking</b></div></div>
            <div class="browserLinuxStatus"><i id="workerLinuxDot"></i><div><small>LINUX</small><b id="workerLinuxText">Stopped</b></div></div>
            <div class="browserLinuxStatus"><i id="workerGitDot"></i><div><small>WORKSPACE</small><b id="workerGitText">Not mounted</b></div></div>
            <div class="browserLinuxStatus"><i id="workerOmpDot"></i><div><small>OMP</small><b id="workerOmpText">Compatibility pending</b></div></div>
          </div>
          <div class="browserLinuxActions">
            <button id="bootBrowserLinux" class="primaryWorker" type="button">Boot Browser Linux</button>
            <button id="prepareBrowserWorkspace" type="button" disabled>Clone / Sync WebAi</button>
            <button id="probeBrowserOmp" type="button" disabled>Check OMP</button>
            <button id="startBrowserShell" type="button" disabled>Open Shell</button>
            <button id="startBrowserPreview" type="button" disabled>Start Preview</button>
            <a class="browserLinuxLink" href="https://console.browserpod.io" target="_blank" rel="noreferrer">Get BrowserPod key</a>
          </div>
          <div id="browserPortalInfo" class="browserLinuxPortal"></div>
        </div>
        <div class="browserLinuxTerminalWrap">
          <div class="browserLinuxTerminalHead">
            <div><b>Local Linux Terminal</b><small>Browser sandbox · persistent storageKey</small></div>
            <span id="browserWorkerRuntime">BrowserPod 3.0.1</span>
          </div>
          <div id="browserLinuxTerminal" class="browserLinuxTerminal"></div>
        </div>
      </div>
      <div class="browserLinuxCompatibility">
        <b>OMP compatibility gate:</b> WebAi จะไม่ขึ้น OMP = Ready จนพบ <code>omp</code> ที่รันได้จริงใน browser sandbox. OMP release ปัจจุบันเป็น native Linux x64/arm64 ขณะที่ BrowserPod รัน native binaries แบบนั้นตรง ๆ ไม่ได้; panel นี้เตรียม execution layer ให้พร้อมสำหรับ browser/Wasm build โดยไม่ปลอมสถานะ.
      </div>`;

    lowerGrid.parentNode.insertBefore(section, lowerGrid);
    bindPanel();
    restoreKey();
    refreshIsolationStatus();
    installTeamWorkerRow();
  }

  function setStatus(dotId, textId, kind, text) {
    const dot = $(dotId);
    const label = $(textId);
    if (dot) dot.className = kind || "";
    if (label) label.textContent = text;
  }

  function setBadge(kind, text) {
    const badge = $("#browserWorkerBadge");
    if (!badge) return;
    badge.className = `browserLinuxBadge ${kind || ""}`.trim();
    badge.textContent = text;
  }

  function setButtons() {
    const boot = $("#bootBrowserLinux");
    const prepare = $("#prepareBrowserWorkspace");
    const probe = $("#probeBrowserOmp");
    const shell = $("#startBrowserShell");
    const preview = $("#startBrowserPreview");
    if (boot) {
      boot.disabled = state.booting || state.ready;
      boot.textContent = state.booting ? "Booting…" : state.ready ? "Linux Running" : "Boot Browser Linux";
    }
    if (prepare) prepare.disabled = !state.ready;
    if (probe) probe.disabled = !state.ready;
    if (shell) shell.disabled = !state.ready || state.shellStarted;
    if (preview) preview.disabled = !state.workspaceReady;
  }

  function saveKey() {
    const input = $("#browserPodKey");
    const remember = $("#rememberBrowserPodKey");
    const value = input?.value.trim() || "";
    if (!value) return "";
    sessionStorage.setItem(sessionKey, value);
    if (remember?.checked) localStorage.setItem(localKey, value);
    else localStorage.removeItem(localKey);
    return value;
  }

  function restoreKey() {
    const remembered = localStorage.getItem(localKey) || "";
    const session = sessionStorage.getItem(sessionKey) || "";
    const value = session || remembered;
    const input = $("#browserPodKey");
    const remember = $("#rememberBrowserPodKey");
    if (input) input.value = value;
    if (remember) remember.checked = Boolean(remembered);
  }

  function forgetKey() {
    sessionStorage.removeItem(sessionKey);
    localStorage.removeItem(localKey);
    const input = $("#browserPodKey");
    const remember = $("#rememberBrowserPodKey");
    if (input) input.value = "";
    if (remember) remember.checked = false;
  }

  async function ensureIsolation() {
    if (window.crossOriginIsolated) return true;
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      throw new Error("Browser นี้ไม่รองรับ cross-origin isolation/service worker ที่ Browser Linux ต้องใช้");
    }

    await navigator.serviceWorker.register("./coi-sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;

    sessionStorage.setItem(autoBootKey, "1");
    location.reload();
    return false;
  }

  function refreshIsolationStatus() {
    if (window.crossOriginIsolated) {
      setStatus("#workerIsolationDot", "#workerIsolationText", "ok", "Ready");
      return;
    }
    if (window.isSecureContext && "serviceWorker" in navigator) {
      setStatus("#workerIsolationDot", "#workerIsolationText", "warn", "Needs reload");
    } else {
      setStatus("#workerIsolationDot", "#workerIsolationText", "bad", "Unsupported");
    }
  }

  async function loadBrowserPod() {
    const module = await import(RUNTIME_URL);
    if (!module?.BrowserPod) throw new Error("BrowserPod runtime โหลดไม่สำเร็จ");
    return module.BrowserPod;
  }

  function installTeamWorkerRow() {
    const grid = $(".teamGrid");
    if (!grid || $("#teamBrowserLinux")) return;
    const row = document.createElement("div");
    row.dataset.browserWorker = "true";
    row.innerHTML = '<span id="teamBrowserLinux" class="tinyDot idle"></span><b>Browser Linux</b><small id="teamBrowserLinuxText">Not booted</small>';
    grid.appendChild(row);
  }

  function setTeamWorker(kind, text) {
    const dot = $("#teamBrowserLinux");
    const label = $("#teamBrowserLinuxText");
    if (dot) dot.className = `tinyDot ${kind}`;
    if (label) label.textContent = text;
  }

  async function boot() {
    if (state.ready || state.booting) return state;
    const key = saveKey();
    if (!key) throw new Error("กรุณาใส่ BrowserPod API key ก่อน");

    state.booting = true;
    setBadge("warn", "BOOTING");
    setStatus("#workerLinuxDot", "#workerLinuxText", "work", "Booting");
    setTeamWorker("working", "Booting");
    setButtons();

    try {
      const isolated = await ensureIsolation();
      if (!isolated) return state;

      const BrowserPod = await loadBrowserPod();
      state.pod = await BrowserPod.boot({
        apiKey: key,
        nodeVersion: "22",
        storageKey: STORAGE_KEY,
      });

      state.terminal = await state.pod.createDefaultTerminal($("#browserLinuxTerminal"));
      state.captureTerminal = await state.pod.createCustomTerminal({
        cols: 120,
        rows: 40,
        onOutput: () => {},
      });

      state.pod.onPortal(({ url, port }) => handlePortal(url, port));
      state.ready = true;
      setBadge("ok", "LINUX RUNNING");
      setStatus("#workerLinuxDot", "#workerLinuxText", "ok", "Running");
      setTeamWorker("ok", "Running locally");
      setButtons();

      await preflight();
      window.dispatchEvent(new CustomEvent("webai:browser-worker-status", { detail: getStatus() }));
      return state;
    } catch (error) {
      state.ready = false;
      setBadge("bad", "BOOT FAILED");
      setStatus("#workerLinuxDot", "#workerLinuxText", "bad", "Boot failed");
      setTeamWorker("bad", "Boot failed");
      writeTerminalNotice(`Browser Linux boot failed: ${error.message}`);
      throw error;
    } finally {
      state.booting = false;
      setButtons();
      sessionStorage.removeItem(autoBootKey);
    }
  }

  function writeTerminalNotice(text) {
    const target = $("#browserLinuxTerminal");
    if (!target || state.terminal) return;
    const line = document.createElement("pre");
    line.textContent = text;
    line.style.cssText = "margin:0;color:#8fb7c5;white-space:pre-wrap;font:11px/1.6 ui-monospace,monospace";
    target.replaceChildren(line);
  }

  async function runCapture(executable, args = [], opts = {}) {
    if (!state.pod) throw new Error("Browser Linux ยังไม่ boot");
    let output = "";
    const decoder = new TextDecoder();
    const terminal = await state.pod.createCustomTerminal({
      cols: 160,
      rows: 50,
      onOutput(buffer) {
        output += decoder.decode(buffer, { stream: true });
      },
    });
    await state.pod.run(executable, args, {
      terminal,
      echo: false,
      cwd: opts.cwd,
      env: opts.env,
    });
    return output.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "").trim();
  }

  async function runVisible(executable, args = [], opts = {}) {
    if (!state.pod || !state.terminal) throw new Error("Browser Linux ยังไม่ boot");
    return state.pod.run(executable, args, {
      terminal: state.terminal,
      echo: opts.echo !== false,
      cwd: opts.cwd,
      env: opts.env,
    });
  }

  async function preflight() {
    try {
      const [node, git, bash] = await Promise.all([
        runCapture("node", ["--version"]),
        runCapture("git", ["--version"]),
        runCapture("bash", ["--version"]),
      ]);
      writeTerminalNotice(`Browser Linux ready\n${node}\n${git}\n${bash.split("\n")[0] || bash}`);
    } catch (error) {
      writeTerminalNotice(`Linux booted, preflight warning: ${error.message}`);
    }
  }

  async function prepareWorkspace() {
    if (!state.ready) throw new Error("Boot Browser Linux ก่อน");
    setStatus("#workerGitDot", "#workerGitText", "work", "Syncing");
    await state.pod.createDirectory("/workspace", { recursive: true });

    const script = `set -e\nif [ -d ${WORKSPACE}/.git ]; then\n  cd ${WORKSPACE}\n  git fetch --depth 1 origin main\n  git reset --hard origin/main\nelse\n  rm -rf ${WORKSPACE}\n  git clone --depth 1 ${REPO_URL} ${WORKSPACE}\nfi\nprintf '\\nWorkspace ready: ${WORKSPACE}\\n'\ngit -C ${WORKSPACE} rev-parse --short HEAD\n`;
    await runVisible("bash", ["-lc", script]);
    state.workspaceReady = true;
    setStatus("#workerGitDot", "#workerGitText", "ok", "WebAi mounted");
    setButtons();
    await refreshGitEvidence();
    window.dispatchEvent(new CustomEvent("webai:browser-worker-status", { detail: getStatus() }));
  }

  async function refreshGitEvidence() {
    if (!state.workspaceReady) return;
    let status = "";
    let numstat = "";
    try {
      status = await runCapture("git", ["status", "--short"], { cwd: WORKSPACE });
      numstat = await runCapture("git", ["diff", "--numstat"], { cwd: WORKSPACE });
    } catch {
      return;
    }
    const files = status ? status.split("\n").filter(Boolean).length : 0;
    let additions = 0;
    let deletions = 0;
    if (numstat) {
      for (const line of numstat.split("\n")) {
        const [a, d] = line.split("\t");
        if (/^\d+$/.test(a)) additions += Number(a);
        if (/^\d+$/.test(d)) deletions += Number(d);
      }
    }
    const headline = $("#diffHeadline");
    const stats = $("#diffStats");
    if (headline) headline.textContent = `${files} files changed`;
    if (stats) stats.textContent = `+${additions} −${deletions}`;
  }

  async function probeOmp() {
    if (!state.ready) throw new Error("Boot Browser Linux ก่อน");
    setStatus("#workerOmpDot", "#workerOmpText", "work", "Checking");
    state.ompReady = false;
    state.ompVersion = "";

    try {
      const output = await runCapture("bash", ["-lc", "command -v omp >/dev/null 2>&1 && omp --version"]);
      if (output && !/not found|error/i.test(output)) {
        state.ompReady = true;
        state.ompVersion = output.split("\n").filter(Boolean).slice(-1)[0] || "available";
        setStatus("#workerOmpDot", "#workerOmpText", "ok", state.ompVersion);
      } else {
        throw new Error("omp executable not available");
      }
    } catch {
      setStatus("#workerOmpDot", "#workerOmpText", "warn", "Needs browser/Wasm build");
    }

    paintGlobalOmpState();
    window.dispatchEvent(new CustomEvent("webai:browser-worker-status", { detail: getStatus() }));
    return state.ompReady;
  }

  function paintGlobalOmpState() {
    const dot = $("#ompStatusDot");
    const text = $("#ompState");
    const teamDot = $("#teamOmp");
    const teamText = $("#teamOmpText");
    const kind = state.ompReady ? "ok" : state.ready ? "warn" : "idle";
    const label = state.ompReady ? "Browser OMP ready" : state.ready ? "Browser build pending" : "Browser worker stopped";
    if (dot) dot.className = `tinyDot ${kind}`;
    if (text) text.textContent = state.ompReady ? "พร้อมใน Browser" : "รอ Browser build";
    if (teamDot) teamDot.className = `tinyDot ${kind}`;
    if (teamText) teamText.textContent = label;
  }

  async function startShell() {
    if (!state.ready || state.shellStarted) return;
    state.shellStarted = true;
    setButtons();
    const cwd = state.workspaceReady ? WORKSPACE : "/";
    runVisible("bash", [], { cwd, echo: true })
      .catch((error) => writeTerminalNotice(`Shell ended: ${error.message}`))
      .finally(() => {
        state.shellStarted = false;
        setButtons();
      });
  }

  async function writePreviewServer() {
    const source = `import http from "node:http";\nimport { readFile, stat } from "node:fs/promises";\nimport path from "node:path";\nconst root=process.cwd();\nconst mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".wasm":"application/wasm"};\nhttp.createServer(async(req,res)=>{\n try{\n  const u=new URL(req.url,"http://localhost");\n  let rel=decodeURIComponent(u.pathname);\n  if(rel==="/") rel="/index.html";\n  let file=path.resolve(root,"."+rel);\n  if(!file.startsWith(root)){res.writeHead(403);return res.end("forbidden");}\n  try{const s=await stat(file);if(s.isDirectory()) file=path.join(file,"index.html");}catch{}\n  const body=await readFile(file);\n  res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(body);\n }catch{res.writeHead(404,{"Content-Type":"text/plain"});res.end("not found");}\n}).listen(${PREVIEW_PORT},"0.0.0.0",()=>console.log("WebAi browser preview on :${PREVIEW_PORT}"));\n`;
    const file = await state.pod.createFile(`${WORKSPACE}/.webai-preview.mjs`, "utf-8");
    await file.write(source);
    await file.close();
  }

  async function startPreview() {
    if (!state.workspaceReady) throw new Error("เตรียม Workspace ก่อน");
    await writePreviewServer();
    const status = $("#previewStatus");
    if (status) status.textContent = "Starting Browser Linux preview…";
    if (!state.previewPromise) {
      state.previewPromise = runVisible("node", [".webai-preview.mjs"], { cwd: WORKSPACE, echo: true })
        .catch((error) => {
          state.previewPromise = null;
          if (status) status.textContent = `Preview failed: ${error.message}`;
        });
    }
  }

  function handlePortal(url, port) {
    state.portalUrl = url;
    state.portalPort = port;
    const info = $("#browserPortalInfo");
    if (info) {
      info.classList.add("show");
      info.innerHTML = `Preview Portal · port ${Number(port)} · <a href="${url}" target="_blank" rel="noreferrer">Open preview</a>`;
    }
    if (Number(port) === PREVIEW_PORT) {
      const status = $("#previewStatus");
      const canvas = $("#tab-preview .previewCanvas");
      if (status) status.textContent = `Browser Linux · port ${PREVIEW_PORT}`;
      if (canvas) {
        canvas.innerHTML = "";
        const iframe = document.createElement("iframe");
        iframe.className = "browserWorkerPreviewFrame";
        iframe.src = url;
        iframe.title = "WebAi Browser Linux Preview";
        iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups allow-same-origin");
        canvas.appendChild(iframe);
      }
    }
  }

  async function runOmp(prompt) {
    if (!state.ompReady) {
      throw new Error("OMP ยังไม่มี browser/Wasm-compatible build ใน Worker นี้");
    }
    if (!state.workspaceReady) throw new Error("Workspace ยังไม่พร้อม");
    // Execution hook is deliberately gated on a real runnable omp binary.
    return runVisible("omp", ["--version"], { cwd: WORKSPACE, echo: true }).then(() => ({
      ok: false,
      blocked: true,
      content: "OMP binary was detected, but RPC streaming adapter has not been certified yet.",
      promptLength: String(prompt || "").length,
    }));
  }

  function getStatus() {
    return {
      target: "browser",
      isolated: window.crossOriginIsolated,
      linuxReady: state.ready,
      workspaceReady: state.workspaceReady,
      ompReady: state.ompReady,
      ompVersion: state.ompVersion,
      previewUrl: state.portalUrl,
      previewPort: state.portalPort,
    };
  }

  function bindPanel() {
    $("#bootBrowserLinux")?.addEventListener("click", () => boot().catch((error) => alert(error.message)));
    $("#prepareBrowserWorkspace")?.addEventListener("click", () => prepareWorkspace().catch((error) => alert(error.message)));
    $("#probeBrowserOmp")?.addEventListener("click", () => probeOmp().catch((error) => alert(error.message)));
    $("#startBrowserShell")?.addEventListener("click", () => startShell().catch((error) => alert(error.message)));
    $("#startBrowserPreview")?.addEventListener("click", () => startPreview().catch((error) => alert(error.message)));
    $("#forgetBrowserPodKey")?.addEventListener("click", forgetKey);
    $("#browserPodKey")?.addEventListener("change", saveKey);
    $("#rememberBrowserPodKey")?.addEventListener("change", saveKey);
  }

  async function maybeAutoBoot() {
    if (sessionStorage.getItem(autoBootKey) !== "1") return;
    restoreKey();
    if (!$("#browserPodKey")?.value.trim()) {
      sessionStorage.removeItem(autoBootKey);
      return;
    }
    try {
      await boot();
    } catch {
      sessionStorage.removeItem(autoBootKey);
    }
  }

  addStylesheet();
  injectPanel();
  paintGlobalOmpState();
  setButtons();

  window.WebAiBrowserWorker = {
    boot,
    prepareWorkspace,
    refreshGitEvidence,
    probeOmp,
    startShell,
    startPreview,
    runCapture,
    runOmp,
    getStatus,
    isOmpReady: () => state.ompReady,
  };

  setTimeout(maybeAutoBoot, 120);
})();
