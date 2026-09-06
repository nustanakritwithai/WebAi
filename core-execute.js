(() => {
  const CORE_TASK_KEY = "webai.coreActiveTask";
  const BROWSER_TASK_KEY = "webai.browserAgentTask";
  const bridge = () => window.WebAiCoreBridge;
  let lastMode = document.querySelector("#taskMode")?.value || "agent";

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeCoreTask(task) {
    if (!task) return;
    try { localStorage.setItem(CORE_TASK_KEY, JSON.stringify(task)); } catch {}
  }

  function coreReady() {
    return bridge()?.isTaskReady?.() === true
      && document.documentElement.dataset.nativeWorker === "ready";
  }

  function latestExecution(task) {
    return Array.isArray(task?.executions) && task.executions.length
      ? task.executions[task.executions.length - 1]
      : null;
  }

  function rollbackReady(task) {
    const execution = latestExecution(task);
    return coreReady()
      && ["awaiting_verification", "verification_failed", "failed"].includes(task?.status)
      && execution?.status === "applied"
      && typeof execution?.snapshotId === "string";
  }

  function preserveBrowserTask(operation) {
    const had = localStorage.getItem(BROWSER_TASK_KEY) !== null;
    const raw = localStorage.getItem(BROWSER_TASK_KEY);
    try {
      return operation();
    } finally {
      try {
        if (had) localStorage.setItem(BROWSER_TASK_KEY, raw);
        else localStorage.removeItem(BROWSER_TASK_KEY);
      } catch {}
    }
  }

  function coreTaskView(task) {
    if (!task || typeof task !== "object") return task;
    return { ...task, _webaiPlane: "core" };
  }

  function renderCoreTask(task) {
    if (!task) return;
    const view = coreTaskView(task);
    writeCoreTask(view);
    preserveBrowserTask(() => {
      if (typeof applyAgentTask === "function") applyAgentTask(view);
      else if (typeof state !== "undefined") state.agentTask = view;
    });
    if (typeof state !== "undefined") state.agentTask = view;
    window.WebAiDiffEvidence?.render?.(view);
    reconcile();
  }

  function restoreBrowserTask() {
    const task = readJson(BROWSER_TASK_KEY);
    if (task && typeof applyAgentTask === "function") {
      applyAgentTask(task);
      if (typeof state !== "undefined") state.agentTask = task;
      return;
    }
    if (typeof resetTask === "function") {
      const coreRaw = localStorage.getItem(CORE_TASK_KEY);
      resetTask();
      if (coreRaw != null) localStorage.setItem(CORE_TASK_KEY, coreRaw);
    }
  }

  function restoreCoreTask() {
    const task = readJson(CORE_TASK_KEY);
    if (task) renderCoreTask(task);
  }

  function installModeOption() {
    const select = document.querySelector("#taskMode");
    if (!select) return;
    const legacy = select.querySelector('option[value="execute"]');
    if (legacy) {
      legacy.value = "core";
      legacy.textContent = "Core Execute";
    } else if (!select.querySelector('option[value="core"]')) {
      const option = document.createElement("option");
      option.value = "core";
      option.textContent = "Core Execute";
      select.appendChild(option);
    }
  }

  function cleanupLegacyOmpUi() {
    document.querySelector("#ompStatusDot")?.closest(".overviewItem")?.setAttribute("hidden", "");
    document.querySelector("#teamOmp")?.closest("div")?.setAttribute("hidden", "");

    const welcome = document.querySelector(".welcome p");
    if (welcome) welcome.textContent = "Browser Agent สร้างและทดลองงานใน virtual workspace ได้ทันที ส่วน Core Execute ใช้ Native Worker, Snapshot/Rollback, Diff Evidence และ Verification กับ workspace จริง";

    document.querySelectorAll("#tab-preview .emptyState small, #tab-diff .emptyState small").forEach((node) => {
      node.textContent = (node.textContent || "")
        .replaceAll("OMP", "WebAi Core")
        .replaceAll("repository", "workspace");
    });
  }

  function installRollbackButton() {
    const buttons = document.querySelector(".agentActionButtons");
    if (!buttons || document.querySelector("#rollbackTaskBtn")) return;
    const rollback = document.createElement("button");
    rollback.id = "rollbackTaskBtn";
    rollback.className = "verifyBtn";
    rollback.type = "button";
    rollback.disabled = true;
    rollback.textContent = "Rollback ↶";
    buttons.appendChild(rollback);
  }

  function patchModeLabel() {
    if (typeof modeLabel !== "function") return;
    const original = modeLabel;
    modeLabel = function webAiModeLabel(mode) {
      if (mode === "core") return "Core Execute";
      if (mode === "agent") return "Browser Agent";
      return original(mode);
    };
  }

  function patchStatusLabel() {
    if (typeof agentStatusLabel !== "function") return;
    const original = agentStatusLabel;
    agentStatusLabel = function webAiStatusLabel(status) {
      if (status === "rolling_back") return "กำลัง Rollback";
      if (status === "rolled_back") return "Rollback สำเร็จ";
      return original(status);
    };
  }

  function reconcile() {
    const select = document.querySelector("#taskMode");
    const isCore = select?.value === "core";
    if (!isCore) return;

    const task = typeof state !== "undefined" ? state.agentTask : null;
    const busy = typeof state !== "undefined" && state.busy;
    const ready = coreReady();
    const hasGoal = !!document.querySelector("#taskInput")?.value.trim();
    const run = document.querySelector("#runTaskBtn");
    const status = document.querySelector("#taskStatus");
    const connectionHint = document.querySelector("#connectionHint");
    const panel = document.querySelector(".agentActions");
    const hint = document.querySelector("#agentActionHint");
    const approve = document.querySelector("#approveExecutionBtn");
    const verify = document.querySelector("#verifyTaskBtn");
    const rollback = document.querySelector("#rollbackTaskBtn");

    if (panel) panel.hidden = false;
    if (run) run.disabled = !(ready && hasGoal && !busy);
    const runLabel = run?.querySelector("span");
    if (runLabel) runLabel.textContent = ready ? "Create Core Task → Review Plan" : "เชื่อมต่อ WebAi Core ก่อน";

    if (approve) {
      approve.disabled = !(ready && !busy && task?._webaiPlane === "core" && task?.status === "awaiting_approval");
      approve.innerHTML = 'Approve &amp; Execute <span>→</span>';
    }
    if (verify) verify.disabled = !(ready && !busy && task?._webaiPlane === "core" && task?.status === "awaiting_verification");
    if (rollback) rollback.disabled = !(task?._webaiPlane === "core" && rollbackReady(task) && !busy);

    if (!busy) {
      if (!ready) {
        if (status) { status.textContent = "รอ WebAi Core"; status.className = "pill warn"; }
        if (connectionHint) connectionHint.textContent = "Core Execute ต้องมี Core URL + Pairing + Native Worker workspace";
      } else if (task?._webaiPlane === "core" && task.status === "rolled_back") {
        if (status) { status.textContent = "Rolled back"; status.className = "pill warn"; }
        if (connectionHint) connectionHint.textContent = "Workspace ถูกคืนสภาพและตรวจ hash แล้ว";
      } else {
        if (status) { status.textContent = "Core พร้อม Execute"; status.className = "pill ok"; }
        if (connectionHint) connectionHint.textContent = "Core จะสร้าง Snapshot ก่อน Native Worker เขียน workspace จริง";
      }
    }

    if (hint) {
      if (!ready) hint.textContent = "เชื่อมต่อ WebAi Core และ Pairing ก่อนเริ่ม Core Execute";
      else if (!task || task._webaiPlane !== "core") hint.textContent = "Core จะวางแผนก่อน แล้วหยุดรอ Approval ก่อนแก้ workspace";
      else if (task.status === "awaiting_approval") hint.textContent = "ตรวจ Plan แล้วกด Approve & Execute เมื่อพร้อมให้ Native Worker แก้ไฟล์จริง";
      else if (task.status === "awaiting_verification") hint.textContent = "Execution มี Snapshot + Diff Evidence แล้ว · Verify ต่อหรือ Rollback ได้";
      else if (task.status === "verification_failed") hint.textContent = "Verification ไม่ผ่าน · Diff Evidence ยังอยู่และสามารถ Rollback ได้";
      else if (task.status === "rolled_back") hint.textContent = "Rollback ผ่าน hash verification แล้ว · งานนี้ไม่ถือว่า DONE";
      else if (task.status === "completed") hint.textContent = "Verification ผ่านแล้ว งานนี้ DONE · transaction rollback ถูกปิดสำหรับ completed task";
    }
  }

  function coreErrorMessage(error, fallback = "Core Execute ไม่สำเร็จ") {
    const code = error?.code || error?.message || "";
    if (code === "native_worker_disabled") return "WebAi Core ออนไลน์ แต่ Native Worker ยังปิด";
    if (code === "workspace_not_configured") return "WebAi Core ออนไลน์ แต่ Workspace ยังไม่พร้อม";
    if (code === "snapshot_store_not_configured") return "WebAi Core ยังไม่ได้ตั้ง Snapshot Store";
    if (code === "session_required") return "Core session ไม่พร้อม · Pairing ใหม่อีกครั้ง";
    if (code === "completed_task_not_rollbackable") return "Task นี้ Verification ผ่านและ DONE แล้ว จึงไม่อนุญาต transaction rollback";
    if (code === "rollback_conflict") {
      const files = Array.isArray(error?.files) ? error.files.join(", ") : "workspace";
      return `Rollback ถูกหยุดเพราะไฟล์เปลี่ยนหลัง execution: ${files}`;
    }
    return `${fallback}: ${error?.message || "ไม่ทราบสาเหตุ"}`;
  }

  async function requestCore(path, body) {
    const api = bridge();
    if (!api?.request) throw new Error("WebAi Core bridge ยังไม่พร้อม");
    return api.request(path, body);
  }

  function beginCoreBusy(label) {
    if (typeof setAgentError === "function") setAgentError("");
    if (typeof setBusy === "function") setBusy(true, label);
    else if (typeof state !== "undefined") state.busy = true;
    reconcile();
  }

  function finishCoreBusy() {
    if (typeof state !== "undefined") state.busy = false;
    if (typeof applyActionState === "function") applyActionState();
    reconcile();
  }

  async function runCoreTask() {
    const goal = document.querySelector("#taskInput")?.value.trim() || "";
    if (!goal || (typeof state !== "undefined" && state.busy)) return;
    if (!coreReady()) {
      if (typeof setAgentError === "function") setAgentError("เชื่อมต่อ WebAi Core และ Pairing ก่อนเริ่ม Core Execute");
      document.querySelector("#openConnection")?.click();
      return;
    }

    const browserRaw = localStorage.getItem(BROWSER_TASK_KEY);
    if (typeof makeTask === "function") preserveBrowserTask(() => makeTask(goal, "core"));
    if (browserRaw != null) localStorage.setItem(BROWSER_TASK_KEY, browserRaw);
    beginCoreBusy("กำลังวางแผน Core Task");
    try {
      const task = await requestCore("/api/tasks", { goal });
      renderCoreTask(task);
      addTimeline?.("Core plan ready", "ตรวจแผนก่อนอนุมัติการแก้ workspace จริง", "ok");
      log?.(`Core task created · ${task.id}`, "ok");
    } catch (error) {
      const message = coreErrorMessage(error, "สร้าง Core task ไม่สำเร็จ");
      setAgentError?.(message);
      addTimeline?.("Core task failed", message, "bad");
      log?.(`Core task failed · ${message}`, "bad");
    } finally {
      finishCoreBusy();
    }
  }

  async function approveCoreTask() {
    const task = typeof state !== "undefined" ? state.agentTask : null;
    if (!task?.id || task._webaiPlane !== "core" || task.status !== "awaiting_approval" || state.busy || !coreReady()) return;
    beginCoreBusy("กำลัง Execute ผ่าน Native Worker");
    setProgress?.(2);
    addTimeline?.("Core execution approved", "Snapshot จะถูกสร้างก่อน workspace mutation", "working");
    try {
      const result = await requestCore(`/api/tasks/${encodeURIComponent(task.id)}/approve`);
      renderCoreTask(result);
      addTimeline?.("Core execution finished", "Snapshot + after hashes + Diff Evidence พร้อม", "ok");
      log?.(`Core execution finished · ${task.id}`, "ok");
    } catch (error) {
      const message = coreErrorMessage(error, "Core execution ไม่สำเร็จ");
      setAgentError?.(message);
      addTimeline?.("Core execution failed", message, "bad");
      log?.(`Core execution failed · ${message}`, "bad");
    } finally {
      finishCoreBusy();
    }
  }

  async function verifyCoreTask() {
    const task = typeof state !== "undefined" ? state.agentTask : null;
    if (!task?.id || task._webaiPlane !== "core" || task.status !== "awaiting_verification" || state.busy || !coreReady()) return;
    beginCoreBusy("กำลัง Verification");
    setProgress?.(3);
    addTimeline?.("Core verification started", "ตรวจ evidence บน Host B", "working");
    try {
      const result = await requestCore(`/api/tasks/${encodeURIComponent(task.id)}/verify`);
      renderCoreTask(result);
      addTimeline?.(result.status === "completed" ? "Verification passed" : "Verification failed", result.status === "completed" ? "Task DONE หลัง deterministic gate" : "Task ยังไม่ DONE", result.status === "completed" ? "ok" : "bad");
      log?.(`Core verification · ${result.status}`, result.status === "completed" ? "ok" : "bad");
    } catch (error) {
      const message = coreErrorMessage(error, "Verification ไม่สำเร็จ");
      setAgentError?.(message);
      addTimeline?.("Verification failed", message, "bad");
      log?.(`Core verification failed · ${message}`, "bad");
    } finally {
      finishCoreBusy();
    }
  }

  async function rollbackCoreTask() {
    const task = typeof state !== "undefined" ? state.agentTask : null;
    if (!task?.id || task._webaiPlane !== "core" || !rollbackReady(task) || state.busy) return;
    beginCoreBusy("กำลัง Rollback");
    addTimeline?.("Rollback started", "ตรวจ drift ก่อนคืนไฟล์จาก snapshot", "working");
    try {
      const result = await requestCore(`/api/tasks/${encodeURIComponent(task.id)}/rollback`);
      renderCoreTask(result);
      const restored = result?.rollback?.restoredFiles || 0;
      addTimeline?.("Rollback verified", `${restored} file(s) restored`, "ok");
      log?.(`Rollback verified · ${restored} file(s) restored`, "ok");
    } catch (error) {
      const message = coreErrorMessage(error, "Rollback ไม่สำเร็จ");
      setAgentError?.(message);
      addTimeline?.("Rollback blocked", message, "bad");
      log?.(`Rollback blocked · ${message}`, "bad");
    } finally {
      finishCoreBusy();
    }
  }

  function interceptCoreActions() {
    const run = document.querySelector("#runTaskBtn");
    const approve = document.querySelector("#approveExecutionBtn");
    const verify = document.querySelector("#verifyTaskBtn");
    const rollback = document.querySelector("#rollbackTaskBtn");

    run?.addEventListener("click", (event) => {
      if (document.querySelector("#taskMode")?.value !== "core") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runCoreTask();
    }, true);
    approve?.addEventListener("click", (event) => {
      if (document.querySelector("#taskMode")?.value !== "core") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      approveCoreTask();
    }, true);
    verify?.addEventListener("click", (event) => {
      if (document.querySelector("#taskMode")?.value !== "core") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      verifyCoreTask();
    }, true);
    rollback?.addEventListener("click", (event) => {
      if (document.querySelector("#taskMode")?.value !== "core") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      rollbackCoreTask();
    }, true);

    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
      if (document.querySelector("#taskMode")?.value !== "core") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!run?.disabled) runCoreTask();
    }, true);
  }

  function bindModeState() {
    const select = document.querySelector("#taskMode");
    const input = document.querySelector("#taskInput");
    select?.addEventListener("change", () => {
      const next = select.value;
      if (next === "core" && lastMode !== "core") restoreCoreTask();
      else if (lastMode === "core" && next === "agent") restoreBrowserTask();
      lastMode = next;
      queueMicrotask(reconcile);
    });
    input?.addEventListener("input", () => queueMicrotask(reconcile));
    window.addEventListener("focus", () => queueMicrotask(reconcile));
    setInterval(() => {
      if (document.querySelector("#taskMode")?.value === "core") reconcile();
    }, 2_000);
  }

  installModeOption();
  cleanupLegacyOmpUi();
  installRollbackButton();
  patchModeLabel();
  patchStatusLabel();
  interceptCoreActions();
  bindModeState();
  if (document.querySelector("#taskMode")?.value === "core") restoreCoreTask();

  window.WebAiCoreExecute = {
    isReady: coreReady,
    run: runCoreTask,
    approve: approveCoreTask,
    verify: verifyCoreTask,
    rollback: rollbackCoreTask,
    render: renderCoreTask,
  };
})();
