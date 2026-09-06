const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const els = {
  apiBase: $("#apiBase"),
  token: $("#sessionToken"),
  save: $("#saveConfig"),
  systemButton: $("#systemButton"),
  systemDot: $("#systemDot"),
  systemLabel: $("#systemLabel"),
  settingsBtn: $("#settingsBtn"),
  openConnection: $("#openConnection"),
  mobileMoreBtn: $("#mobileMoreBtn"),
  drawer: $("#connectionDrawer"),
  closeDrawer: $("#closeDrawer"),
  connectionSummary: $("#connectionSummary"),
  connectionDetail: $("#connectionDetail"),
  connectionResultIcon: $("#connectionResultIcon"),
  stepUrl: $("#stepUrl"),
  stepHealth: $("#stepHealth"),
  stepReady: $("#stepReady"),
  backendState: $("#backendState"),
  typhoonState: $("#typhoonState"),
  ompState: $("#ompState"),
  backendStatusDot: $("#backendStatusDot"),
  typhoonStatusDot: $("#typhoonStatusDot"),
  ompStatusDot: $("#ompStatusDot"),
  teamTyphoon: $("#teamTyphoon"),
  teamTyphoonText: $("#teamTyphoonText"),
  teamOmp: $("#teamOmp"),
  teamOmpText: $("#teamOmpText"),
  model: $("#modelName"),
  modelStatus: $("#modelStatus"),
  input: $("#taskInput"),
  mode: $("#taskMode"),
  run: $("#runTaskBtn"),
  taskStatus: $("#taskStatus"),
  connectionHint: $("#connectionHint"),
  currentTaskId: $("#currentTaskId"),
  currentTaskGoal: $("#currentTaskGoal"),
  currentTaskDetail: $("#currentTaskDetail"),
  activeAgent: $("#activeAgent"),
  activeModel: $("#activeModel"),
  activeMode: $("#activeMode"),
  elapsedTime: $("#elapsedTime"),
  timeline: $("#timeline"),
  clearTimeline: $("#clearTimelineBtn"),
  clearTask: $("#clearTaskBtn"),
  taskCount: $("#taskCount"),
  planBox: $("#planBox"),
  planEmpty: $("#planEmpty"),
  clearLog: $("#clearLog"),
  log: $("#eventLog"),
  gateBadge: $("#gateBadge"),
  gateMessage: $("#gateMessage"),
  commandBtn: $("#commandBtn"),
  palette: $("#commandPalette"),
  commandInput: $("#commandInput"),
  paletteList: $("#paletteList")
};

const state = {
  apiBase: localStorage.getItem("webai.apiBase") || "",
  token: localStorage.getItem("webai.sessionToken") || "",
  connected: false,
  typhoonConfigured: false,
  ompEnabled: false,
  busy: false,
  taskId: null,
  taskStart: null,
  taskTimer: null,
  completedTasks: Number(localStorage.getItem("webai.completedTasks") || "0"),
  messages: [{ role: "system", content: "You are WebAi, an AI software engineering assistant. Respond in the user's language." }]
};

els.apiBase.value = state.apiBase;
els.token.value = state.token;
els.taskCount.textContent = state.completedTasks;

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

function setDot(el, kind = "idle") {
  if (!el) return;
  el.className = el.classList.contains("statusDot") ? `statusDot ${kind}` : `tinyDot ${kind}`;
}

function setStep(el, mode = "") {
  if (!el) return;
  el.className = `connectionStep ${mode}`.trim();
}

function openDrawer() {
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  setTimeout(() => els.apiBase.focus(), 80);
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
}

function openPalette() {
  els.palette.classList.add("open");
  els.palette.setAttribute("aria-hidden", "false");
  setTimeout(() => els.commandInput.focus(), 50);
}

function closePalette() {
  els.palette.classList.remove("open");
  els.palette.setAttribute("aria-hidden", "true");
  els.commandInput.value = "";
  filterCommands("");
}

function filterCommands(query) {
  const q = query.trim().toLowerCase();
  $$("#paletteList button").forEach((btn) => {
    btn.hidden = q && !btn.textContent.toLowerCase().includes(q);
  });
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

function addTimeline(title, detail = "", kind = "working") {
  const empty = els.timeline?.querySelector(".emptyState");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "timelineItem";
  const icon = document.createElement("span");
  icon.textContent = kind === "ok" ? "✓" : kind === "bad" ? "!" : "•";
  if (kind === "ok") icon.style.background = "#12392e";
  if (kind === "bad") icon.style.background = "#381821";
  const body = document.createElement("div");
  const b = document.createElement("b");
  const small = document.createElement("small");
  b.textContent = title;
  small.textContent = detail;
  body.append(b, small);
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  row.append(icon, body, time);
  els.timeline.prepend(row);
}

function setBusy(on, label = "กำลังทำงาน") {
  state.busy = on;
  if (on) {
    els.taskStatus.textContent = label;
    els.taskStatus.className = "pill info";
  }
  applyActionState();
}

function applyActionState() {
  const mode = els.mode.value;
  const canTyphoon = state.connected && state.typhoonConfigured && !state.busy;
  const canOmp = state.connected && state.ompEnabled && !state.busy;
  const hasGoal = !!els.input.value.trim();

  let enabled = false;
  if (mode === "execute") enabled = canOmp && hasGoal;
  else enabled = canTyphoon && hasGoal;

  els.run.disabled = !enabled;

  if (state.busy) return;

  if (!state.connected) {
    els.taskStatus.textContent = "รอ Backend";
    els.taskStatus.className = "pill warn";
    els.connectionHint.textContent = "ยังไม่ได้เชื่อม Backend";
  } else if (!state.typhoonConfigured) {
    els.taskStatus.textContent = "รอ Typhoon key";
    els.taskStatus.className = "pill warn";
    els.connectionHint.textContent = "Backend ออนไลน์ แต่ยังไม่มี OpenTyphoon key";
  } else {
    els.taskStatus.textContent = "พร้อมรับงาน";
    els.taskStatus.className = "pill ok";
    els.connectionHint.textContent = state.ompEnabled ? "Typhoon + OMP พร้อม" : "Typhoon พร้อม · OMP ยังปิด";
  }

  const modeText = {
    auto: state.ompEnabled ? "Run Task → Plan + Execute" : "Run Task → Ask Typhoon",
    plan: "Run Task → Generate Plan",
    ask: "Run Task → Ask Typhoon",
    execute: state.ompEnabled ? "Run Task → Execute" : "OMP ยังไม่พร้อม",
    review: "Run Task → Review"
  };
  els.run.querySelector("span").textContent = modeText[mode] || "Run Task";
}

function setConnectionWaiting() {
  state.connected = false;
  state.typhoonConfigured = false;
  state.ompEnabled = false;

  setDot(els.systemDot, "warn");
  els.systemLabel.textContent = "รอ Backend";
  els.backendState.textContent = normalizedBase() ? "รอตรวจ" : "รอ URL";
  els.typhoonState.textContent = "ยังไม่ตรวจ";
  els.ompState.textContent = "ยังไม่ตรวจ";
  setDot(els.backendStatusDot, "warn");
  setDot(els.typhoonStatusDot, "idle");
  setDot(els.ompStatusDot, "idle");
  setDot(els.teamTyphoon, "idle");
  setDot(els.teamOmp, "idle");
  els.teamTyphoonText.textContent = "Waiting";
  els.teamOmpText.textContent = "Waiting";
  els.model.textContent = "OpenTyphoon";
  els.modelStatus.textContent = "รอเชื่อม Backend";
  els.connectionSummary.textContent = "ยังไม่ได้เชื่อมต่อ";
  els.connectionDetail.textContent = "ใส่ URL ของ VPS แล้วกดเชื่อมต่อ";
  els.connectionResultIcon.textContent = "○";
  setStep(els.stepUrl, normalizedBase() ? "done" : "active");
  setStep(els.stepHealth, normalizedBase() ? "active" : "");
  setStep(els.stepReady, "");
  applyActionState();
}

function setConnecting() {
  setDot(els.systemDot, "working");
  setDot(els.backendStatusDot, "working");
  els.systemLabel.textContent = "กำลังเชื่อม";
  els.backendState.textContent = "กำลังตรวจ";
  els.connectionSummary.textContent = "กำลังตรวจ Backend";
  els.connectionDetail.textContent = "GET /api/health";
  els.connectionResultIcon.textContent = "…";
  setStep(els.stepUrl, "done");
  setStep(els.stepHealth, "active");
  setStep(els.stepReady, "");
}

function setConnected(data) {
  state.connected = true;
  state.typhoonConfigured = !!data.typhoonConfigured;
  state.ompEnabled = !!data.ompEnabled;

  setDot(els.backendStatusDot, "ok");
  els.backendState.textContent = "ออนไลน์";
  setDot(els.typhoonStatusDot, state.typhoonConfigured ? "ok" : "warn");
  els.typhoonState.textContent = state.typhoonConfigured ? "พร้อม" : "ยังไม่มี API key";
  setDot(els.ompStatusDot, state.ompEnabled ? "ok" : "idle");
  els.ompState.textContent = state.ompEnabled ? "พร้อม" : "ยังปิด";
  setDot(els.teamTyphoon, state.typhoonConfigured ? "ok" : "warn");
  setDot(els.teamOmp, state.ompEnabled ? "ok" : "idle");
  els.teamTyphoonText.textContent = state.typhoonConfigured ? "Ready" : "Needs key";
  els.teamOmpText.textContent = state.ompEnabled ? "Ready" : "Disabled";

  if (state.typhoonConfigured) {
    setDot(els.systemDot, "ok");
    els.systemLabel.textContent = state.ompEnabled ? "All ready" : "Typhoon ready";
  } else {
    setDot(els.systemDot, "warn");
    els.systemLabel.textContent = "Backend ready";
  }

  els.model.textContent = data.model || "OpenTyphoon";
  els.modelStatus.textContent = state.typhoonConfigured ? "พร้อมรับ Task" : "Backend พร้อม · รอ API key";
  els.connectionSummary.textContent = state.typhoonConfigured ? "เชื่อมต่อสำเร็จ" : "Backend ออนไลน์";
  els.connectionDetail.textContent = state.typhoonConfigured
    ? `${data.model || "OpenTyphoon"} · OMP ${state.ompEnabled ? "ON" : "OFF"}`
    : "ยังไม่พบ TYPHOON_API_KEY บน server";
  els.connectionResultIcon.textContent = state.typhoonConfigured ? "✓" : "!";
  setStep(els.stepUrl, "done");
  setStep(els.stepHealth, "done");
  setStep(els.stepReady, state.typhoonConfigured ? "done" : "active");
  applyActionState();
}

function setConnectionFailed(message) {
  state.connected = false;
  state.typhoonConfigured = false;
  state.ompEnabled = false;

  setDot(els.systemDot, "bad");
  setDot(els.backendStatusDot, "bad");
  setDot(els.typhoonStatusDot, "idle");
  setDot(els.ompStatusDot, "idle");
  setDot(els.teamTyphoon, "idle");
  setDot(els.teamOmp, "idle");
  els.systemLabel.textContent = "Backend error";
  els.backendState.textContent = "ตรวจไม่ผ่าน";
  els.typhoonState.textContent = "ยังไม่ตรวจ";
  els.ompState.textContent = "ยังไม่ตรวจ";
  els.modelStatus.textContent = "ตรวจสอบ Backend URL";
  els.connectionSummary.textContent = "เชื่อมต่อไม่สำเร็จ";
  els.connectionDetail.textContent = message || "ตรวจสอบ URL / CORS / HTTPS";
  els.connectionResultIcon.textContent = "×";
  setStep(els.stepUrl, "done");
  setStep(els.stepHealth, "active");
  setStep(els.stepReady, "");
  applyActionState();
}

async function readJsonResponse(r) {
  const contentType = r.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await r.text();
    const html = text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html");
    throw new Error(html ? "ปลายทางตอบหน้า HTML แทน API — ตรวจสอบ Backend URL" : `Backend ตอบไม่ใช่ JSON (${r.status})`);
  }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function request(path, body, timeoutMs = 65000) {
  if (!state.connected) throw new Error("กรุณาเชื่อมต่อ Backend ก่อน");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
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
    clearTimeout(timer);
  }
}

async function health() {
  if (!normalizedBase()) {
    setConnectionWaiting();
    return;
  }

  setConnecting();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(api("/api/health"), { headers: headers(), signal: ctl.signal });
    const data = await readJsonResponse(r);
    setConnected(data);
    log(`Backend connected · ${data.model || "OpenTyphoon"} · OMP ${data.ompEnabled ? "ON" : "OFF"}`, "ok");
  } catch (e) {
    const message = e.name === "AbortError" ? "Backend ไม่ตอบภายใน 12 วินาที" : e.message;
    setConnectionFailed(message);
    log(`Backend connection failed · ${message}`, "bad");
  } finally {
    clearTimeout(timer);
  }
}

function makeTask(goal, mode) {
  state.taskId = `TASK-${String(Date.now()).slice(-6)}`;
  state.taskStart = Date.now();
  els.currentTaskId.textContent = state.taskId;
  els.currentTaskGoal.textContent = goal;
  els.currentTaskDetail.textContent = "กำลังเตรียม context และเลือกขั้นตอนที่เหมาะกับงาน";
  els.activeMode.textContent = modeLabel(mode);
  els.activeAgent.textContent = "AI CPU";
  els.activeModel.textContent = els.model.textContent || "OpenTyphoon";
  setProgress(0);
  startTimer();
  addTimeline("Task created", goal, "working");
}

function modeLabel(mode) {
  return {
    auto: "Auto",
    plan: "Plan only",
    ask: "Ask AI",
    execute: "Execute",
    review: "Review"
  }[mode] || mode;
}

function setProgress(index, failed = false) {
  $$("#progressSteps .progressStep").forEach((step, i) => {
    step.classList.remove("active", "done", "failed");
    if (i < index) step.classList.add("done");
    if (i === index) step.classList.add(failed ? "failed" : "active");
  });
}

function startTimer() {
  clearInterval(state.taskTimer);
  const tick = () => {
    if (!state.taskStart) return;
    const sec = Math.floor((Date.now() - state.taskStart) / 1000);
    const min = Math.floor(sec / 60);
    els.elapsedTime.textContent = min ? `${min}m ${sec % 60}s` : `${sec}s`;
  };
  tick();
  state.taskTimer = setInterval(tick, 1000);
}

function finishTask(message, success = true) {
  clearInterval(state.taskTimer);
  els.currentTaskDetail.textContent = message;
  if (success) {
    els.taskStatus.textContent = "รอ Verification";
    els.taskStatus.className = "pill info";
    setProgress(3);
    els.gateBadge.textContent = "WAITING";
    els.gateBadge.className = "gateBadge waiting";
    els.gateMessage.textContent = "มีผลลัพธ์แล้ว แต่ยังต้องผ่าน Verification Gate ก่อน DONE";
  } else {
    els.taskStatus.textContent = "Task failed";
    els.taskStatus.className = "pill bad";
  }
  state.busy = false;
  applyActionState();
}

function showPlan(plan) {
  els.planEmpty.classList.add("hidden");
  els.planBox.classList.remove("hidden");
  els.planBox.textContent = typeof plan === "string" ? plan : JSON.stringify(plan, null, 2);
  selectTab("plan");
}

function selectTab(name) {
  $$(".tabBtn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  $$(".tabPanel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  document.querySelector("#workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function callPlan(goal) {
  els.activeAgent.textContent = "OpenTyphoon";
  setProgress(1);
  addTimeline("Planning", "OpenTyphoon กำลังสร้าง structured plan", "working");
  log("Request structured plan from OpenTyphoon");
  const data = await request("/api/plan", { goal });
  showPlan(data.plan);
  addTimeline("Plan ready", "Structured plan created", "ok");
  log("Plan ready", "ok");
  return data;
}

async function callChat(goal, review = false) {
  els.activeAgent.textContent = "OpenTyphoon";
  setProgress(1);
  const prompt = review
    ? `Review this software task. Identify risks, missing acceptance criteria, likely regressions, and a safe implementation approach. Task: ${goal}`
    : goal;
  addTimeline(review ? "Reviewing" : "Thinking", "OpenTyphoon is analyzing the task", "working");
  log(review ? "Request review from OpenTyphoon" : "Send task to OpenTyphoon");
  state.messages.push({ role: "user", content: prompt });
  const data = await request("/api/chat", { messages: state.messages });
  const answer = data.content || "(ไม่มีข้อความตอบกลับ)";
  state.messages.push({ role: "assistant", content: answer });
  showPlan(answer);
  addTimeline(review ? "Review ready" : "Typhoon response ready", `${data.latencyMs ?? "?"} ms`, "ok");
  log(`Typhoon response · ${data.latencyMs ?? "?"} ms`, "ok");
  return data;
}

async function callOmp(goal) {
  if (!state.ompEnabled) throw new Error("OMP ยังไม่ได้เปิดบน Backend");
  els.activeAgent.textContent = "OMP";
  setProgress(2);
  addTimeline("Executing", "OMP กำลังทำงานกับ repository", "working");
  log("Send task to OMP RPC");
  const data = await request("/api/omp/prompt", { prompt: goal }, 190000);
  if (data.content) {
    showPlan(data.content);
  }
  addTimeline("OMP finished", data.content ? "Worker returned a result" : "agent_end", "ok");
  log("OMP agent_end", "ok");
  applyVerificationEvidence(data);
  return data;
}

function applyVerificationEvidence(data) {
  if (!data || !data.verification) return;
  const entries = $$("#verificationList > div");
  const order = ["build","unit","integration","browser","ecc","security","harpoon","regression"];
  let passed = 0;
  order.forEach((key, i) => {
    const value = data.verification[key];
    if (value == null || !entries[i]) return;
    const dot = entries[i].querySelector(".checkDot");
    const label = entries[i].querySelector("em");
    const ok = value === true || value === "pass" || value?.status === "pass";
    dot.textContent = ok ? "✓" : "×";
    dot.className = `checkDot ${ok ? "pass" : "fail"}`;
    label.textContent = ok ? "Passed" : "Failed";
    if (ok) passed++;
  });
  if (passed === order.length) {
    els.gateBadge.textContent = "READY";
    els.gateBadge.className = "gateBadge pass";
    els.gateMessage.textContent = "Verification Gate ผ่านครบ พร้อมสำหรับการอนุมัติ";
  }
}

async function runTask() {
  const goal = els.input.value.trim();
  const mode = els.mode.value;
  if (!goal || els.run.disabled) return;

  makeTask(goal, mode);
  setBusy(true, "กำลังทำงาน");

  try {
    if (mode === "plan") {
      await callPlan(goal);
      finishTask("แผนพร้อมแล้ว ยังไม่มีการแก้ repository", true);
      return;
    }

    if (mode === "ask") {
      await callChat(goal, false);
      finishTask("OpenTyphoon วิเคราะห์งานเสร็จแล้ว", true);
      return;
    }

    if (mode === "review") {
      await callChat(goal, true);
      finishTask("Review พร้อมแล้ว ตรวจรายละเอียดใน Workspace", true);
      return;
    }

    if (mode === "execute") {
      await callOmp(goal);
      finishTask("OMP ส่งผลลัพธ์กลับแล้ว รอ Verification", true);
      return;
    }

    await callPlan(goal);
    if (state.ompEnabled) {
      await callOmp(goal);
      finishTask("Auto run เสร็จขั้น Execute แล้ว รอ Verification", true);
    } else {
      await callChat(goal, false);
      finishTask("Auto run เสร็จด้วย Typhoon · OMP ยังไม่เปิด", true);
    }
  } catch (e) {
    addTimeline("Task failed", e.message, "bad");
    log(`Task failed · ${e.message}`, "bad");
    setProgress(2, true);
    finishTask(e.message, false);
  }
}

function resetTask() {
  clearInterval(state.taskTimer);
  state.taskId = null;
  state.taskStart = null;
  els.currentTaskId.textContent = "NO TASK";
  els.currentTaskGoal.textContent = "ยังไม่มีงานที่กำลังทำ";
  els.currentTaskDetail.textContent = "พิมพ์เป้าหมายด้านบนแล้วกด Run Task";
  els.activeAgent.textContent = "Idle";
  els.activeModel.textContent = "—";
  els.activeMode.textContent = "—";
  els.elapsedTime.textContent = "—";
  $$("#progressSteps .progressStep").forEach((s) => s.classList.remove("active","done","failed"));
  els.taskStatus.textContent = state.connected && state.typhoonConfigured ? "พร้อมรับงาน" : "รอ Backend";
  applyActionState();
}

els.save.addEventListener("click", () => {
  state.apiBase = els.apiBase.value.trim();
  state.token = els.token.value.trim();
  localStorage.setItem("webai.apiBase", state.apiBase);
  localStorage.setItem("webai.sessionToken", state.token);

  if (!normalizedBase()) {
    setConnectionWaiting();
    return;
  }

  if (!/^https?:\/\//i.test(normalizedBase())) {
    setConnectionFailed("URL ต้องขึ้นต้นด้วย https:// หรือ http://");
    log("Backend URL invalid", "warn");
    return;
  }

  health();
});

els.run.addEventListener("click", runTask);
els.input.addEventListener("input", applyActionState);
els.mode.addEventListener("change", applyActionState);
els.input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !els.run.disabled) els.run.click();
});

$$(".promptChip").forEach((btn) => btn.addEventListener("click", () => {
  els.input.value = btn.dataset.prompt || "";
  els.input.focus();
  applyActionState();
}));

$$(".tabBtn").forEach((btn) => btn.addEventListener("click", () => selectTab(btn.dataset.tab)));

els.clearTimeline.addEventListener("click", () => {
  els.timeline.innerHTML = '<div class="emptyState compact"><span>◎</span><b>ยังไม่มีเหตุการณ์</b><small>Timeline จะอัปเดตเมื่อเริ่ม Task</small></div>';
});
els.clearTask.addEventListener("click", resetTask);
els.clearLog.addEventListener("click", () => {
  els.log.innerHTML = '<div class="emptyLog">ยังไม่มี event · ระบบจะแสดง metadata โดยไม่ log secret</div>';
});

[els.systemButton, els.settingsBtn, els.openConnection, els.mobileMoreBtn].forEach((btn) => btn?.addEventListener("click", openDrawer));
els.closeDrawer.addEventListener("click", closeDrawer);
els.drawer.addEventListener("click", (e) => { if (e.target === els.drawer) closeDrawer(); });

els.commandBtn.addEventListener("click", openPalette);
els.palette.addEventListener("click", (e) => { if (e.target === els.palette) closePalette(); });
els.commandInput.addEventListener("input", () => filterCommands(els.commandInput.value));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
  }
  if (e.key === "Escape") {
    closePalette();
    closeDrawer();
  }
});

$$("#paletteList button").forEach((btn) => btn.addEventListener("click", () => {
  const cmd = btn.dataset.command;
  closePalette();
  if (cmd === "new-task") {
    document.querySelector("#home").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => els.input.focus(), 300);
  } else if (cmd === "connect") {
    openDrawer();
  } else if (cmd === "workspace") {
    document.querySelector("#workspace").scrollIntoView({ behavior: "smooth" });
  } else if (cmd === "roadmap") {
    window.location.href = "./roadmap.html";
  }
}));

setConnectionWaiting();
if (normalizedBase()) health();
applyActionState();
