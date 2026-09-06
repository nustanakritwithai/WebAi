(() => {
  const CORE_BASE_KEY = "webai.coreBase";
  const CORE_SESSION_KEY = "webai.coreSession";
  const CORE_SESSION_EXP_KEY = "webai.coreSessionExpiresAt";
  const CORE_CLIENT_KEY = "webai.coreClientId";

  const $ = (selector) => document.querySelector(selector);

  function coreBase() {
    return (localStorage.getItem(CORE_BASE_KEY) || "").trim().replace(/\/+$/, "");
  }

  function clientId() {
    let value = localStorage.getItem(CORE_CLIENT_KEY) || "";
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(value)) {
      value = crypto.randomUUID();
      localStorage.setItem(CORE_CLIENT_KEY, value);
    }
    return value;
  }

  function sessionValid() {
    const token = localStorage.getItem(CORE_SESSION_KEY) || "";
    const expiresAt = Date.parse(localStorage.getItem(CORE_SESSION_EXP_KEY) || "");
    return Boolean(token) && Number.isFinite(expiresAt) && expiresAt > Date.now() + 30_000;
  }

  function clearSession() {
    localStorage.removeItem(CORE_SESSION_KEY);
    localStorage.removeItem(CORE_SESSION_EXP_KEY);
    try {
      if (typeof state !== "undefined") state.agentAvailable = false;
      if (typeof applyActionState === "function") applyActionState();
    } catch {}
  }

  function ensureTeam(name, id) {
    let row = [...document.querySelectorAll(".teamGrid > div")]
      .find((item) => item.querySelector("b")?.textContent?.trim() === name);
    if (!row) {
      const grid = $(".teamGrid");
      if (!grid) return null;
      row = document.createElement("div");
      row.innerHTML = `<span id="${id}" class="tinyDot idle"></span><b>${name}</b><small>Not configured</small>`;
      grid.appendChild(row);
    }
    if (id && !row.querySelector(`#${id}`)) row.querySelector(".tinyDot")?.setAttribute("id", id);
    return row;
  }

  function paintRow(name, id, kind, label) {
    const row = ensureTeam(name, id);
    if (!row) return;
    const dot = row.querySelector(".tinyDot");
    const small = row.querySelector("small");
    if (dot) dot.className = `tinyDot ${kind}`;
    if (small) small.textContent = label;
  }

  function installCoreOverview() {
    const bar = $(".overviewBar");
    if (!bar || $("#coreStatusDot")) return;
    const action = $("#openConnection");
    const item = document.createElement("div");
    item.className = "overviewItem";
    item.innerHTML = '<span id="coreStatusDot" class="tinyDot idle"></span><div><small>WEBAI CORE</small><b id="coreState">รอ URL</b></div>';
    bar.insertBefore(item, action || null);
  }

  function installCoreConnectionUi() {
    const form = $(".connectionForm");
    if (!form || $("#coreBase")) return;

    const divider = document.createElement("div");
    divider.className = "securityNote";
    divider.innerHTML = '<span>⚙</span><p><b>Execution Plane</b> WebAi Core/Native Worker อยู่คนละ host กับ VPS Secret Proxy</p>';

    const baseLabel = document.createElement("label");
    baseLabel.innerHTML = 'WebAi Core URL<input id="coreBase" inputmode="url" autocomplete="url" placeholder="https://core.example.com"><small>Worker host แยกจาก VPS · ไม่ต้องใส่ /api</small>';

    const pairingLabel = document.createElement("label");
    pairingLabel.innerHTML = 'Pairing token<input id="corePairingToken" type="password" autocomplete="off" placeholder="WEBAI_CORE_PAIRING_TOKEN"><small>ใช้แลก short-lived session เท่านั้น · จะไม่บันทึก token นี้</small>';

    const connect = document.createElement("button");
    connect.id = "connectCoreBtn";
    connect.className = "primary fullBtn";
    connect.type = "button";
    connect.textContent = "เชื่อมต่อ WebAi Core";

    const status = document.createElement("div");
    status.id = "coreConnectionStatus";
    status.className = "connectionResult";
    status.innerHTML = '<span class="resultIcon">○</span><div><b>Core ยังไม่เชื่อมต่อ</b><small>Task/Worker/Verification จะไม่วิ่งผ่าน VPS</small></div>';

    form.append(divider, baseLabel, pairingLabel, connect, status);
    $("#coreBase").value = coreBase();
    connect.addEventListener("click", connectCore);
  }

  function paintCoreHealth(data) {
    const caps = data?.capabilities || {};
    const coreReady = data?.configured === true || caps.webaiCore?.configured === true;
    const workerReady = caps.nativeWorker?.configured === true;
    const authReady = caps.sessionAuth?.configured === true;

    const coreDot = $("#coreStatusDot");
    const coreState = $("#coreState");
    if (coreDot) coreDot.className = `tinyDot ${coreReady ? "ok" : "warn"}`;
    if (coreState) coreState.textContent = coreReady ? (sessionValid() ? "พร้อมใช้งาน" : "รอ Pairing") : "Needs ENV";

    paintRow("WebAi Core", "teamNativeCore", coreReady ? "ok" : "warn", coreReady ? (sessionValid() ? "Session ready" : "Core online") : "Needs ENV");
    paintRow("Native Worker", "teamNativeWorker", workerReady ? "ok" : "warn", workerReady ? "Workspace ready" : "Needs workspace");
    paintRow("Verification", "teamVerification", caps.verification?.configured ? "ok" : "warn", caps.verification?.configured ? "npm test ready" : "Needs workspace");
    paintRow("Session Auth", "teamSessionAuth", authReady ? "ok" : "bad", authReady ? "Signed sessions" : "Not configured");

    try {
      if (typeof state !== "undefined") state.agentAvailable = coreReady && authReady && sessionValid();
      if (typeof applyActionState === "function") applyActionState();
    } catch {}

    document.documentElement.dataset.core = coreReady ? "ready" : "needs-env";
    document.documentElement.dataset.nativeWorker = workerReady ? "ready" : "needs-workspace";
  }

  async function refreshCoreHealth() {
    const base = coreBase();
    if (!base) {
      const dot = $("#coreStatusDot");
      const text = $("#coreState");
      if (dot) dot.className = "tinyDot idle";
      if (text) text.textContent = "รอ URL";
      try {
        if (typeof state !== "undefined") state.agentAvailable = false;
        if (typeof applyActionState === "function") applyActionState();
      } catch {}
      return null;
    }
    try {
      const response = await fetch(`${base}/api/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      paintCoreHealth(data);
      return data;
    } catch (error) {
      const dot = $("#coreStatusDot");
      const text = $("#coreState");
      if (dot) dot.className = "tinyDot bad";
      if (text) text.textContent = "Offline";
      try {
        if (typeof state !== "undefined") state.agentAvailable = false;
        if (typeof applyActionState === "function") applyActionState();
      } catch {}
      throw error;
    }
  }

  async function exchangeSession() {
    const base = coreBase();
    if (!base) throw new Error("กรุณาใส่ WebAi Core URL");
    const pairingToken = $("#corePairingToken")?.value.trim() || "";
    if (!pairingToken) throw new Error("กรุณาใส่ Pairing token");

    const response = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingToken, clientId: clientId() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.sessionToken) throw new Error(data.error || `HTTP ${response.status}`);

    localStorage.setItem(CORE_SESSION_KEY, data.sessionToken);
    localStorage.setItem(CORE_SESSION_EXP_KEY, data.expiresAt || "");
    if ($("#corePairingToken")) $("#corePairingToken").value = "";
    return data;
  }

  async function connectCore() {
    const input = $("#coreBase");
    const status = $("#coreConnectionStatus");
    const base = input?.value.trim().replace(/\/+$/, "") || "";
    if (!base) return;
    if (base !== coreBase()) clearSession();
    localStorage.setItem(CORE_BASE_KEY, base);
    if (status) status.querySelector("b").textContent = "กำลังตรวจ Core…";

    try {
      const health = await refreshCoreHealth();
      if ($("#corePairingToken")?.value.trim()) await exchangeSession();
      paintCoreHealth(health);
      if (status) {
        status.querySelector(".resultIcon").textContent = "✓";
        status.querySelector("b").textContent = sessionValid() ? "WebAi Core พร้อม" : "Core online · รอ Pairing";
        status.querySelector("small").textContent = "Task มี signed owner session และ Worker อยู่แยกจาก VPS";
      }
    } catch (error) {
      if (status) {
        status.querySelector(".resultIcon").textContent = "×";
        status.querySelector("b").textContent = "Core เชื่อมต่อไม่สำเร็จ";
        status.querySelector("small").textContent = error.message;
      }
    }
  }

  async function ensureSession() {
    if (sessionValid()) return localStorage.getItem(CORE_SESSION_KEY);
    clearSession();
    if ($("#corePairingToken")?.value.trim()) {
      const session = await exchangeSession();
      return session.sessionToken;
    }
    throw new Error("WebAi Core ต้อง Pairing ก่อนเริ่ม Task");
  }

  async function coreTaskRequest(path, body = undefined, timeoutMs = 190000) {
    const base = coreBase();
    if (!base) throw new Error("ยังไม่ได้ตั้ง WebAi Core URL");
    const token = await ensureSession();
    const normalizedPath = path.replace(/^\/api\/agent\/tasks/, "/api/tasks");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${normalizedPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webai-session": token },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        clearSession();
        throw new Error("Core session หมดอายุ · Pairing ใหม่อีกครั้ง");
      }
      if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, code: data.error });
      return data.task || data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("WebAi Core ใช้เวลานานเกินกำหนด");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function installRequestBridge() {
    try {
      requestAgent = coreTaskRequest;
    } catch {
      window.WebAiCoreRequest = coreTaskRequest;
    }
  }

  installCoreOverview();
  installCoreConnectionUi();
  installRequestBridge();
  setTimeout(() => refreshCoreHealth().catch(() => {}), 700);
  setInterval(() => refreshCoreHealth().catch(() => {}), 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshCoreHealth().catch(() => {});
  });

  window.WebAiCoreBridge = {
    refresh: refreshCoreHealth,
    connect: connectCore,
    exchangeSession,
    clearSession,
    isTaskReady: () => Boolean(coreBase()) && sessionValid(),
    request: coreTaskRequest,
  };
})();
