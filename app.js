const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const els = {
  apiBase: $("#apiBase"),
  token: $("#sessionToken"),
  save: $("#saveConfig"),
  health: $("#health"),
  model: $("#modelName"),
  send: $("#sendBtn"),
  plan: $("#planBtn"),
  omp: $("#ompBtn"),
  input: $("#taskInput"),
  messages: $("#messages"),
  planBox: $("#planBox"),
  log: $("#eventLog"),
  status: $("#taskStatus"),
  setupGuide: $("#setupGuide"),
  goConnect: $("#goConnect"),
  clearLog: $("#clearLog"),
  backendState: $("#backendState"),
  typhoonState: $("#typhoonState"),
  ompState: $("#ompState"),
  backendBadge: $("#backendBadge"),
  typhoonBadge: $("#typhoonBadge"),
  ompBadge: $("#ompBadge"),
  connectionSummary: $("#connectionSummary"),
  connectionHint: $("#connectionHint"),
  stepUrl: $("#stepUrl"),
  stepHealth: $("#stepHealth"),
  stepReady: $("#stepReady"),
  typhoonDot: $("#typhoonDot"),
  ompDot: $("#ompDot")
};

const state = {
  apiBase: localStorage.getItem("webai.apiBase") || "",
  token: localStorage.getItem("webai.sessionToken") || "",
  connected: false,
  typhoonConfigured: false,
  ompEnabled: false,
  busy: false,
  messages: [{ role: "system", content: "You are WebAi, an AI software engineering assistant. Respond in the user's language." }]
};

els.apiBase.value = state.apiBase;
els.token.value = state.token;

function normalizedBase() {
  return (state.apiBase || "").trim().replace(/\/+$/, "");
}

function api(path) {
  const base = normalizedBase();
  if (!base) throw new Error("กรุณาตั้ง Backend API Base URL ของ VPS ก่อน");
  return `${base}${path}`;
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (state.token) h["x-webai-token"] = state.token;
  return h;
}

function setBadge(el, text, kind = "wait") {
  if (!el) return;
  el.textContent = text;
  el.className = `miniBadge ${kind}`;
}

function setStep(el, mode) {
  if (!el) return;
  el.className = `miniStep ${mode || ""}`.trim();
}

function clearEmptyLog() {
  const empty = els.log?.querySelector(".emptyLog");
  if (empty) empty.remove();
}

function log(text, kind = "") {
  if (!els.log) return;
  clearEmptyLog();
  const line = document.createElement("div");
  line.className = `logline ${kind}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  els.log.prepend(line);
}

function bubble(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `bubble ${role}`;
  const who = document.createElement("b");
  const body = document.createElement("div");
  who.textContent = role === "user" ? "คุณ" : "WebAi";
  body.textContent = text;
  wrap.append(who, body);
  els.messages.append(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function applyActionState() {
  const canUseTyphoon = state.connected && state.typhoonConfigured && !state.busy;
  const canUseOmp = state.connected && state.ompEnabled && !state.busy;

  els.send.disabled = !canUseTyphoon;
  els.plan.disabled = !canUseTyphoon;
  els.omp.disabled = !canUseOmp;

  if (state.busy) return;

  if (!state.connected) {
    els.status.textContent = "รอ Backend";
    els.status.className = "pill warn";
    els.connectionHint.textContent = "ยังไม่ได้เชื่อม Backend";
  } else if (!state.typhoonConfigured) {
    els.status.textContent = "รอ Typhoon key";
    els.status.className = "pill warn";
    els.connectionHint.textContent = "Backend ออนไลน์ แต่ยังไม่มี Typhoon key";
  } else {
    els.status.textContent = "พร้อมรับงาน";
    els.status.className = "pill ok";
    els.connectionHint.textContent = state.ompEnabled ? "Typhoon + OMP พร้อม" : "Typhoon พร้อม · OMP ยังปิด";
  }
}

function setBusy(on, label = "กำลังทำงาน") {
  state.busy = on;
  if (on) {
    els.status.textContent = label;
    els.status.className = "pill info";
  }
  applyActionState();
}

function resetStackDots() {
  els.typhoonDot?.classList.remove("on");
  els.ompDot?.classList.remove("on");
}

function setWaitingForBackend() {
  state.connected = false;
  state.typhoonConfigured = false;
  state.ompEnabled = false;
  document.body.classList.remove("backend-connected");
  resetStackDots();

  els.health.innerHTML = '<span class="statusDot"></span>รอ Backend URL';
  els.health.className = "pill warn";
  els.model.textContent = "รอเชื่อมต่อ";
  els.backendState.textContent = "รอ URL";
  els.typhoonState.textContent = "ยังไม่ตรวจ";
  els.ompState.textContent = "ยังไม่ตรวจ";
  setBadge(els.backendBadge, "WAIT", "wait");
  setBadge(els.typhoonBadge, "WAIT", "wait");
  setBadge(els.ompBadge, "WAIT", "wait");
  els.connectionSummary.textContent = "ใส่ URL ของ Secret Proxy / Backend";
  setStep(els.stepUrl, normalizedBase() ? "done" : "active");
  setStep(els.stepHealth, normalizedBase() ? "active" : "");
  setStep(els.stepReady, "");
  els.setupGuide.classList.remove("hidden");
  els.omp.textContent = "ส่งให้ OMP";
  applyActionState();
}

function setConnecting() {
  els.health.innerHTML = '<span class="statusDot"></span>กำลังเชื่อมต่อ';
  els.health.className = "pill info";
  els.backendState.textContent = "กำลังตรวจ";
  setBadge(els.backendBadge, "CHECK", "wait");
  els.connectionSummary.textContent = "กำลังตรวจ /api/health";
  setStep(els.stepUrl, "done");
  setStep(els.stepHealth, "active");
  setStep(els.stepReady, "");
}

function setConnected(data) {
  state.connected = true;
  state.typhoonConfigured = !!data.typhoonConfigured;
  state.ompEnabled = !!data.ompEnabled;
  document.body.classList.add("backend-connected");

  els.backendState.textContent = "ออนไลน์";
  setBadge(els.backendBadge, "LIVE", "ok");
  els.typhoonState.textContent = state.typhoonConfigured ? "พร้อม" : "ยังไม่มี API key";
  setBadge(els.typhoonBadge, state.typhoonConfigured ? "READY" : "WAIT", state.typhoonConfigured ? "ok" : "wait");
  els.ompState.textContent = state.ompEnabled ? "พร้อม" : "ยังปิด";
  setBadge(els.ompBadge, state.ompEnabled ? "READY" : "OFF", state.ompEnabled ? "ok" : "wait");

  if (state.typhoonConfigured) els.typhoonDot?.classList.add("on");
  else els.typhoonDot?.classList.remove("on");
  if (state.ompEnabled) els.ompDot?.classList.add("on");
  else els.ompDot?.classList.remove("on");

  els.health.innerHTML = state.typhoonConfigured
    ? '<span class="statusDot"></span>Typhoon พร้อม'
    : '<span class="statusDot"></span>Backend ออนไลน์';
  els.health.className = state.typhoonConfigured ? "pill ok" : "pill warn";
  els.model.textContent = data.model || "OpenTyphoon";
  els.omp.textContent = state.ompEnabled ? "ส่งให้ OMP" : "OMP ยังปิด";
  els.connectionSummary.textContent = state.typhoonConfigured ? "เชื่อมต่อสำเร็จ · Typhoon พร้อม" : "Backend พร้อม · รอ Typhoon key";

  setStep(els.stepUrl, "done");
  setStep(els.stepHealth, "done");
  setStep(els.stepReady, state.typhoonConfigured ? "done" : "active");
  if (state.typhoonConfigured) els.setupGuide.classList.add("hidden");
  else els.setupGuide.classList.remove("hidden");

  applyActionState();
}

function setConnectionFailed(message) {
  state.connected = false;
  state.typhoonConfigured = false;
  state.ompEnabled = false;
  resetStackDots();

  els.health.innerHTML = '<span class="statusDot"></span>เชื่อมต่อไม่สำเร็จ';
  els.health.className = "pill bad";
  els.backendState.textContent = "ตรวจไม่ผ่าน";
  els.typhoonState.textContent = "ยังไม่ตรวจ";
  els.ompState.textContent = "ยังไม่ตรวจ";
  setBadge(els.backendBadge, "ERROR", "bad");
  setBadge(els.typhoonBadge, "WAIT", "wait");
  setBadge(els.ompBadge, "WAIT", "wait");
  els.connectionSummary.textContent = message || "ตรวจสอบ Backend URL / CORS / HTTPS";
  els.model.textContent = "—";
  els.omp.textContent = "ส่งให้ OMP";
  setStep(els.stepUrl, "done");
  setStep(els.stepHealth, "active");
  setStep(els.stepReady, "");
  els.setupGuide.classList.remove("hidden");
  applyActionState();
}

async function readJsonResponse(r) {
  const contentType = r.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await r.text();
    const html = text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html");
    throw new Error(html ? "ปลายทางกำลังตอบหน้า HTML แทน API — ตรวจสอบ Backend URL" : `Backend ตอบกลับไม่ใช่ JSON (${r.status})`);
  }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function request(path, body, timeoutMs = 65000) {
  if (!state.connected) throw new Error("กรุณาเชื่อมต่อ Backend ก่อน");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(api(path), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    return await readJsonResponse(r);
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Backend ใช้เวลาตอบนานเกินกำหนด");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function health() {
  if (!normalizedBase()) {
    setWaitingForBackend();
    return;
  }

  setConnecting();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(api("/api/health"), { headers: headers(), signal: ctl.signal });
    const data = await readJsonResponse(r);
    setConnected(data);
    log(`Backend connected · ${data.model || "OpenTyphoon"} · OMP ${data.ompEnabled ? "ON" : "OFF"}`, "ok");
  } catch (e) {
    const message = e.name === "AbortError" ? "Backend ไม่ตอบภายใน 12 วินาที" : e.message;
    setConnectionFailed(message);
    log(`เชื่อมต่อ Backend ไม่สำเร็จ · ${message}`, "bad");
  } finally {
    clearTimeout(t);
  }
}

els.save.addEventListener("click", () => {
  state.apiBase = els.apiBase.value.trim();
  state.token = els.token.value.trim();
  localStorage.setItem("webai.apiBase", state.apiBase);
  localStorage.setItem("webai.sessionToken", state.token);

  if (!normalizedBase()) {
    setWaitingForBackend();
    return;
  }

  if (!/^https?:\/\//i.test(normalizedBase())) {
    setConnectionFailed("URL ต้องขึ้นต้นด้วย https:// หรือ http://");
    log("Backend URL ไม่ถูกต้อง · ต้องขึ้นต้นด้วย https:// หรือ http://", "warn");
    return;
  }

  log("บันทึก Backend URL แล้ว · เริ่ม health check");
  health();
});

els.send.addEventListener("click", async () => {
  const text = els.input.value.trim();
  if (!text || els.send.disabled) return;
  bubble("user", text);
  state.messages.push({ role: "user", content: text });
  els.input.value = "";
  setBusy(true, "กำลังคุยกับ Typhoon");
  log("ส่งข้อความไป OpenTyphoon");
  try {
    const data = await request("/api/chat", { messages: state.messages });
    const answer = data.content || "(ไม่มีข้อความตอบกลับ)";
    state.messages.push({ role: "assistant", content: answer });
    bubble("assistant", answer);
    log(`Typhoon ตอบแล้ว · ${data.latencyMs ?? "?"} ms`, "ok");
  } catch (e) {
    bubble("assistant", `เชื่อมต่อไม่สำเร็จ: ${e.message}`);
    log(`Chat failed · ${e.message}`, "bad");
  } finally {
    setBusy(false);
  }
});

els.plan.addEventListener("click", async () => {
  const goal = els.input.value.trim();
  if (!goal || els.plan.disabled) return;
  setBusy(true, "กำลังสร้างแผน");
  els.planBox.textContent = "กำลังให้ OpenTyphoon สร้างแผน...";
  log("ขอ structured plan จาก Typhoon");
  try {
    const data = await request("/api/plan", { goal });
    els.planBox.textContent = JSON.stringify(data.plan, null, 2);
    log("ได้ implementation plan แล้ว", "ok");
  } catch (e) {
    els.planBox.textContent = `สร้างแผนไม่สำเร็จ\n\n${e.message}`;
    log(`Plan failed · ${e.message}`, "bad");
  } finally {
    setBusy(false);
  }
});

els.omp.addEventListener("click", async () => {
  const prompt = els.input.value.trim();
  if (!prompt || els.omp.disabled) return;
  setBusy(true, "OMP กำลังทำงาน");
  log("ส่งงานให้ OMP RPC");
  try {
    const data = await request("/api/omp/prompt", { prompt }, 190000);
    bubble("assistant", data.content || "OMP ทำงานเสร็จแล้ว");
    log("OMP agent_end", "ok");
  } catch (e) {
    bubble("assistant", `OMP error: ${e.message}`);
    log(`OMP failed · ${e.message}`, "bad");
  } finally {
    setBusy(false);
  }
});

els.input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") els.send.click();
});

$$('.promptChip').forEach((btn) => {
  btn.addEventListener("click", () => {
    els.input.value = btn.dataset.prompt || "";
    els.input.focus();
  });
});

els.goConnect?.addEventListener("click", () => {
  document.querySelector("#connect")?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => els.apiBase.focus(), 350);
});

els.clearLog?.addEventListener("click", () => {
  els.log.innerHTML = '<div class="emptyLog">ยังไม่มี event · ระบบจะเริ่มบันทึกหลังเชื่อม Backend</div>';
});

health();
