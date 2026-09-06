(() => {
  const RUNTIME_URL = "https://rt.browserpod.io/3.0.1/browserpod.js";
  const STORAGE_KEY = "webai-browser-linux-v03";
  const REPO_URL = "https://github.com/nustanakritwithai/WebAi.git";
  const WORKSPACE = "/workspace/WebAi";
  const PREVIEW_PORT = 4173;
  const SESSION_KEY = "webai.browserpod.key.session";
  const LOCAL_KEY = "webai.browserpod.key.local";
  const AUTOBOOT_KEY = "webai.browserpod.autoboot";

  const state = {
    pod: null,
    commandTerminal: null,
    shellTerminal: null,
    previewTerminal: null,
    captureSink: null,
    ready: false,
    booting: false,
    reloadPending: false,
    operation: "",
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

  function setInfo(text, kind = "info") {
    const info = $("#browserPortalInfo");
    if (!info) return;
    info.classList.add("show");
    info.dataset.operation = kind;
    info.textContent = text;
  }

  function writeTerminalNotice(text) {
    const target = $("#browserLinuxTerminal");
    if (!target || state.shellTerminal) return;
    const line = document.createElement("pre");
    line.textContent = text;
    line.style.cssText = "margin:0;color:#8fb7c5;white-space:pre-wrap;font:12px/1.65 ui-monospace,monospace;padding:12px";
    target.replaceChildren(line);
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
          <span class="sectionKicker">CLIENT-SIDE EXECUTION · V0.3 MINIMAL</span>
          <h2>Browser Linux Worker</h2>
          <p>Boot เบาที่สุดสำหรับมือถือ · ไม่มี auto preflight · งานทั้งหมดรันทีละขั้น</p>
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
          <div class="browserLinuxNote"><b>Minimal Mode</b> — หลัง Linux Running ปุ่ม Clone / Sync จะใช้ได้ทันที ไม่มี Node/Git/Bash check แอบทำงานเบื้องหลัง</div>
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
            <button id="startBrowserPreview" type="button" disabled>Start Preview</button>
            <button id="startBrowserShell" type="button" disabled>Open Shell</button>
            <button id="resetBrowserWorker" class="ghostBtn" type="button">Reset Worker</button>
            <a class="browserLinuxLink" href="https://console.browserpod.io" target="_blank" rel="noreferrer">BrowserPod Console</a>
          </div>
          <div id="browserPortalInfo" class="browserLinuxPortal"></div>
        </div>
        <div class="browserLinuxTerminalWrap">
          <div class="browserLinuxTerminalHead">
            <div><b>Local Linux Terminal</b><small>สร้างเฉพาะตอนกด Open Shell</small></div>
            <span id="browserWorkerRuntime">BrowserPod 3.0.1 · V0.3</span>
          </div>
          <div id="browserLinuxTerminal" class="browserLinuxTerminal"></div>
        </div>
      </div>
      <div class="browserLinuxCompatibility">
        <b>OMP compatibility gate:</b> WebAi จะไม่ขึ้น OMP = Ready จน <code>omp --version</code> รันได้จริงใน browser sandbox.
      </div>`;

    lowerGrid.parentNode.insertBefore(section, lowerGrid);
    bindPanel();
    restoreKey();
    refreshIsolationStatus();
    installTeamWorkerRow();
    writeTerminalNotice("Worker ยังไม่เปิด · Boot Browser Linux ก่อน");
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

  function setButtons() {
    const locked = !!state.operation || state.booting || state.shellStarted;
    const boot = $("#bootBrowserLinux");
    const prepare = $("#prepareBrowserWorkspace");
    const probe = $("#probeBrowserOmp");
    const preview = $("#startBrowserPreview");
    const shell = $("#startBrowserShell");

    if (boot) {
      boot.disabled = state.booting || state.ready;
      boot.textContent = state.booting ? "Booting…" : state.ready ? "Linux Running" : "Boot Browser Linux";
    }
    if (prepare) prepare.disabled = !state.ready || locked;
    if (probe) probe.disabled = !state.workspaceReady || locked;
    if (preview) preview.disabled = !state.workspaceReady || locked;
    if (shell) {
      shell.disabled = !state.workspaceReady || locked;
      shell.textContent = state.shellStarted ? "Shell Open" : "Open Shell";
    }
  }

  function saveKey() {
    const value = $("#browserPodKey")?.value.trim() || "";
    if (!value) return "";
    sessionStorage.setItem(SESSION_KEY, value);
    if ($("#rememberBrowserPodKey")?.checked) localStorage.setItem(LOCAL_KEY, value);
    else localStorage.removeItem(LOCAL_KEY);
    return value;
  }

  function restoreKey() {
    const remembered = localStorage.getItem(LOCAL_KEY) || "";
    const session = sessionStorage.getItem(SESSION_KEY) || "";
    const input = $("#browserPodKey");
    const remember = $("#rememberBrowserPodKey");
    if (input) input.value = session || remembered;
    if (remember) remember.checked = Boolean(remembered);
  }

  function forgetKey() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);
    if ($("#browserPodKey")) $("#browserPodKey").value = "";
    if ($("#rememberBrowserPodKey")) $("#rememberBrowserPodKey").checked = false;
  }

  async function ensureIsolation() {
    if (window.crossOriginIsolated) return true;
    if (!window.isSecureContext || !("serviceWorker" in navigator)) throw new Error("Browser นี้ไม่รองรับ cross-origin isolation/service worker");

    state.reloadPending = true;
    setBadge("warn", "PREPARING ISOLATION");
    setStatus("#workerIsolationDot", "#workerIsolationText", "work", "Preparing");
    setInfo("กำลังเปิด isolation · หน้าเว็บจะ reload 1 ครั้ง", "working");
    await navigator.serviceWorker.register("./coi-sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;
    sessionStorage.setItem(AUTOBOOT_KEY, "1");
    location.reload();
    return false;
  }

  function refreshIsolationStatus() {
    if (window.crossOriginIsolated) setStatus("#workerIsolationDot", "#workerIsolationText", "ok", "Ready");
    else if (window.isSecureContext && "serviceWorker" in navigator) setStatus("#workerIsolationDot", "#workerIsolationText", "warn", "Needs one reload");
    else setStatus("#workerIsolationDot", "#workerIsolationText", "bad", "Unsupported");
  }

  async function loadBrowserPod() {
    const module = await import(RUNTIME_URL);
    if (!module?.BrowserPod) throw new Error("BrowserPod runtime โหลดไม่สำเร็จ");
    return module.BrowserPod;
  }

  async function ensureCommandTerminal() {
    if (state.commandTerminal) return state.commandTerminal;
    if (!state.pod) throw new Error("Browser Linux ยังไม่ boot");
    const decoder = new TextDecoder();
    state.commandTerminal = await state.pod.createCustomTerminal({
      cols: 90,
      rows: 20,
      onOutput(buffer) {
        if (state.captureSink) state.captureSink(decoder.decode(buffer, { stream: true }));
      },
    });
    return state.commandTerminal;
  }

  async function runCapture(executable, args = [], opts = {}) {
    if (!state.pod) throw new Error("Browser Linux ยังไม่ boot");
    if (state.shellStarted) throw new Error("Shell เปิดอยู่ · Reset Worker ก่อนรัน background task");
    const terminal = await ensureCommandTerminal();
    let output = "";
    state.captureSink = (chunk) => { output += chunk; };
    try {
      await state.pod.run(executable, args, { terminal, echo: false, cwd: opts.cwd, env: opts.env });
    } finally {
      state.captureSink = null;
    }
    return output.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "").trim();
  }

  async function withOperation(name, fn) {
    if (!state.ready) throw new Error("Boot Browser Linux ก่อน");
    if (state.operation) throw new Error(`กำลังทำ ${state.operation} อยู่`);
    if (state.shellStarted) throw new Error("Shell เปิดอยู่ · Reset Worker ก่อนเริ่มงาน background");
    state.operation = name;
    document.documentElement.dataset.browserWorkerOperation = name;
    setButtons();
    try {
      return await fn();
    } finally {
      state.operation = "";
      delete document.documentElement.dataset.browserWorkerOperation;
      setButtons();
    }
  }

  async function boot() {
    if (state.ready || state.booting) return state;
    const key = saveKey();
    if (!key) throw new Error("กรุณาใส่ BrowserPod API key ก่อน");

    state.booting = true;
    state.reloadPending = false;
    setBadge("warn", "BOOTING");
    setStatus("#workerLinuxDot", "#workerLinuxText", "work", "Booting");
    setTeamWorker("working", "Booting");
    setButtons();

    try {
      const isolated = await ensureIsolation();
      if (!isolated) return state;
      const BrowserPod = await loadBrowserPod();
      state.pod = await BrowserPod.boot({ apiKey: key, nodeVersion: "22", storageKey: STORAGE_KEY });
      state.pod.onPortal(({ url, port }) => handlePortal(url, port));

      state.ready = true;
      setBadge("ok", "LINUX RUNNING");
      setStatus("#workerLinuxDot", "#workerLinuxText", "ok", "Running");
      setTeamWorker("ok", "Running locally");
      setInfo("Linux Running · พร้อม Clone / Sync WebAi", "ok");
      writeTerminalNotice("Linux Running\n\nต่อไปกด Clone / Sync WebAi ได้ทันที");
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
      if (!state.reloadPending) sessionStorage.removeItem(AUTOBOOT_KEY);
    }
  }

  async function prepareWorkspace() {
    return withOperation("Clone / Sync", async () => {
      setStatus("#workerGitDot", "#workerGitText", "work", "Syncing");
      setInfo("กำลัง Clone / Sync WebAi · ตรวจ Git ในขั้นนี้", "working");
      await state.pod.createDirectory("/workspace", { recursive: true });
      const script = `set -e\ncommand -v git >/dev/null 2>&1 || { echo 'git unavailable'; exit 127; }\nif [ -d ${WORKSPACE}/.git ]; then\n  cd ${WORKSPACE}\n  git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=20 fetch --depth 1 origin main\n  git reset --hard origin/main\nelse\n  rm -rf ${WORKSPACE}\n  git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=20 clone --depth 1 --filter=blob:none ${REPO_URL} ${WORKSPACE}\nfi\ngit -C ${WORKSPACE} rev-parse --short HEAD\n`;
      const output = await runCapture("bash", ["-lc", script]);
      state.workspaceReady = true;
      setStatus("#workerGitDot", "#workerGitText", "ok", "WebAi mounted");
      setInfo(`Workspace mounted · ${output.split("\n").slice(-1)[0] || WORKSPACE}`, "ok");
      await refreshGitEvidence();
      window.dispatchEvent(new CustomEvent("webai:browser-worker-status", { detail: getStatus() }));
      return output;
    }).catch((error) => {
      setStatus("#workerGitDot", "#workerGitText", "bad", "Sync failed");
      setInfo(`Clone / Sync failed · ${error.message}`, "warn");
      throw error;
    });
  }

  async function refreshGitEvidence() {
    if (!state.workspaceReady) return;
    try {
      const status = await runCapture("git", ["status", "--short"], { cwd: WORKSPACE });
      const numstat = await runCapture("git", ["diff", "--numstat"], { cwd: WORKSPACE });
      const files = status ? status.split("\n").filter(Boolean).length : 0;
      let additions = 0;
      let deletions = 0;
      for (const line of (numstat || "").split("\n")) {
        const [a, d] = line.split("\t");
        if (/^\d+$/.test(a)) additions += Number(a);
        if (/^\d+$/.test(d)) deletions += Number(d);
      }
      if ($("#diffHeadline")) $("#diffHeadline").textContent = `${files} files changed`;
      if ($("#diffStats")) $("#diffStats").textContent = `+${additions} −${deletions}`;
    } catch {}
  }

  async function probeOmp() {
    return withOperation("Check OMP", async () => {
      if (!state.workspaceReady) throw new Error("Clone / Sync WebAi ก่อน");
      setStatus("#workerOmpDot", "#workerOmpText", "work", "Checking");
      setInfo("กำลังตรวจ OMP", "working");
      state.ompReady = false;
      state.ompVersion = "";
      try {
        const output = await runCapture("bash", ["-lc", "command -v omp >/dev/null 2>&1 && omp --version"], { cwd: WORKSPACE });
        if (!output || /not found|error/i.test(output)) throw new Error("omp executable not available");
        state.ompReady = true;
        state.ompVersion = output.split("\n").filter(Boolean).slice(-1)[0] || "available";
        setStatus("#workerOmpDot", "#workerOmpText", "ok", state.ompVersion);
        setInfo(`OMP detected · ${state.ompVersion}`, "ok");
      } catch {
        setStatus("#workerOmpDot", "#workerOmpText", "warn", "Needs browser/Wasm build");
        setInfo("OMP ยังไม่มี browser/Wasm-compatible build · Workspace ยังใช้งานต่อได้", "warn");
      }
      paintGlobalOmpState();
      return state.ompReady;
    });
  }

  function paintGlobalOmpState() {
    const kind = state.ompReady ? "ok" : state.ready ? "warn" : "idle";
    const label = state.ompReady ? "Browser OMP ready" : state.ready ? "Browser build pending" : "Browser worker stopped";
    if ($("#ompStatusDot")) $("#ompStatusDot").className = `tinyDot ${kind}`;
    if ($("#ompState")) $("#ompState").textContent = state.ompReady ? "พร้อมใน Browser" : "รอ Browser build";
    if ($("#teamOmp")) $("#teamOmp").className = `tinyDot ${kind}`;
    if ($("#teamOmpText")) $("#teamOmpText").textContent = label;
  }

  async function startShell() {
    if (!state.workspaceReady) throw new Error("Clone / Sync WebAi ก่อน");
    if (state.operation) throw new Error(`กำลังทำ ${state.operation} อยู่`);
    if (state.shellStarted) return;
    state.shellStarted = true;
    setButtons();
    setInfo("Interactive shell เปิดแล้ว · background operations ถูกล็อกจน Reset Worker", "ok");
    const target = $("#browserLinuxTerminal");
    target?.replaceChildren();
    state.shellTerminal = state.shellTerminal || await state.pod.createDefaultTerminal(target);
    state.pod.run("bash", [], { terminal: state.shellTerminal, echo: true, cwd: WORKSPACE })
      .catch((error) => setInfo(`Shell ended · ${error.message}`, "warn"))
      .finally(() => { state.shellStarted = false; setButtons(); });
  }

  async function writePreviewServer() {
    const source = `import http from "node:http";\nimport { readFile, stat } from "node:fs/promises";\nimport path from "node:path";\nconst root=process.cwd();\nconst mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".wasm":"application/wasm"};\nhttp.createServer(async(req,res)=>{try{const u=new URL(req.url,"http://localhost");let rel=decodeURIComponent(u.pathname);if(rel==="/")rel="/index.html";let file=path.resolve(root,"."+rel);if(!file.startsWith(root)){res.writeHead(403);return res.end("forbidden");}try{const s=await stat(file);if(s.isDirectory())file=path.join(file,"index.html");}catch{}const body=await readFile(file);res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(body);}catch{res.writeHead(404,{"Content-Type":"text/plain"});res.end("not found");}}).listen(${PREVIEW_PORT},"0.0.0.0",()=>console.log("WebAi browser preview on :${PREVIEW_PORT}"));\n`;
    const file = await state.pod.createFile(`${WORKSPACE}/.webai-preview.mjs`, "utf-8");
    await file.write(source);
    await file.close();
  }

  async function startPreview() {
    return withOperation("Start Preview", async () => {
      if (!state.workspaceReady) throw new Error("Clone / Sync WebAi ก่อน");
      await writePreviewServer();
      if ($("#previewStatus")) $("#previewStatus").textContent = "Starting Browser Linux preview…";
      if (!state.previewTerminal) state.previewTerminal = await state.pod.createCustomTerminal({ cols: 72, rows: 12, onOutput: () => {} });
      if (!state.previewPromise) {
        state.previewPromise = state.pod.run("node", [".webai-preview.mjs"], { terminal: state.previewTerminal, echo: false, cwd: WORKSPACE })
          .catch((error) => {
            state.previewPromise = null;
            if ($("#previewStatus")) $("#previewStatus").textContent = `Preview failed: ${error.message}`;
          });
      }
      setInfo("Preview process started · รอ portal URL", "ok");
    });
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
      if ($("#previewStatus")) $("#previewStatus").textContent = `Browser Linux · port ${PREVIEW_PORT}`;
      const canvas = $("#tab-preview .previewCanvas");
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
    if (!state.ompReady) throw new Error("OMP ยังไม่มี browser/Wasm-compatible build ใน Worker นี้");
    if (!state.workspaceReady) throw new Error("Workspace ยังไม่พร้อม");
    const version = await runCapture("omp", ["--version"], { cwd: WORKSPACE });
    return { ok: false, blocked: true, content: `OMP detected (${version}) แต่ RPC streaming adapter ยังไม่ certified`, promptLength: String(prompt || "").length };
  }

  function getStatus() {
    return {
      target: "browser",
      minimalMode: true,
      isolated: window.crossOriginIsolated,
      linuxReady: state.ready,
      workspaceReady: state.workspaceReady,
      operation: state.operation,
      shellStarted: state.shellStarted,
      ompReady: state.ompReady,
      ompVersion: state.ompVersion,
      previewUrl: state.portalUrl,
      previewPort: state.portalPort,
    };
  }

  function resetWorker() {
    sessionStorage.removeItem(AUTOBOOT_KEY);
    location.reload();
  }

  function bindPanel() {
    $("#bootBrowserLinux")?.addEventListener("click", () => boot().catch((error) => alert(error.message)));
    $("#prepareBrowserWorkspace")?.addEventListener("click", () => prepareWorkspace().catch((error) => alert(error.message)));
    $("#probeBrowserOmp")?.addEventListener("click", () => probeOmp().catch((error) => alert(error.message)));
    $("#startBrowserPreview")?.addEventListener("click", () => startPreview().catch((error) => alert(error.message)));
    $("#startBrowserShell")?.addEventListener("click", () => startShell().catch((error) => alert(error.message)));
    $("#resetBrowserWorker")?.addEventListener("click", resetWorker);
    $("#forgetBrowserPodKey")?.addEventListener("click", forgetKey);
    $("#browserPodKey")?.addEventListener("change", saveKey);
    $("#rememberBrowserPodKey")?.addEventListener("change", saveKey);
  }

  async function maybeAutoBoot() {
    if (sessionStorage.getItem(AUTOBOOT_KEY) !== "1") return;
    restoreKey();
    if (!$("#browserPodKey")?.value.trim()) {
      sessionStorage.removeItem(AUTOBOOT_KEY);
      return;
    }
    try { await boot(); } catch { sessionStorage.removeItem(AUTOBOOT_KEY); }
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
    startPreview,
    startShell,
    runCapture,
    runOmp,
    resetWorker,
    getStatus,
    isOmpReady: () => state.ompReady,
  };

  setTimeout(maybeAutoBoot, 120);
})();