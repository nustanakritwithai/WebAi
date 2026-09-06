(() => {
  const bridge = () => window.WebAiCoreBridge;

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
    if (welcome) welcome.textContent = "Agent คิดผ่าน OpenTyphoon ได้ทันที ส่วน Core Execute ใช้ WebAi Native Worker, Snapshot/Rollback และ Verification สำหรับงานที่ต้องแก้ไฟล์จริง";

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
    rollback.innerHTML = 'Rollback <span>↶</span>';
    buttons.appendChild(rollback);
    rollback.addEventListener("click", runRollback);
  }

  function patchModeLabel() {
    if (typeof modeLabel !== "function") return;
    const original = modeLabel;
    modeLabel = function patchedModeLabel(mode) {
      if (mode === "core") return "Core Execute";
      if (mode === "agent") return "Agent · Direct Typhoon";
      return original(mode);
    };
  }

  function patchStatusLabel() {
    if (typeof agentStatusLabel !== "function") return;
    const original = agentStatusLabel;
    agentStatusLabel = function patchedAgentStatusLabel(status) {
      if (status === "rolling_back") return "กำลัง Rollback";
      if (status === "rolled_back") return "Rollback สำเร็จ";
      return original(status);
    };
  }

  function patchAgentActions() {
    if (typeof updateAgentActions !== "function") return;
    const original = updateAgentActions;
    updateAgentActions = function patchedAgentActions() {
      original();
      const select = document.querySelector("#taskMode");
      const panel = document.querySelector(".agentActions");
      const hint = document.querySelector("#agentActionHint");
      const approve = document.querySelector("#approveExecutionBtn");
      const verify = document.querySelector("#verifyTaskBtn");
      const rollback = document.querySelector("#rollbackTaskBtn");
      const isCore = select?.value === "core";

      if (panel) panel.hidden = !isCore;
      if (!isCore) {
        if (rollback) rollback.disabled = true;
        return;
      }

      const task = typeof state !== "undefined" ? state.agentTask : null;
      const ready = coreReady();
      if (approve) approve.disabled = !(ready && !state.busy && task?.status === "awaiting_approval");
      if (verify) verify.disabled = !(ready && !state.busy && task?.status === "awaiting_verification");
      if (rollback) rollback.disabled = !(rollbackReady(task) && !state.busy);

      if (!hint) return;
      if (!ready) hint.textContent = "เชื่อมต่อ WebAi Core และ Pairing ก่อนเริ่ม Core Execute";
      else if (!task) hint.textContent = "Core จะวางแผนก่อน แล้วหยุดรอให้คุณอนุมัติก่อนแก้ workspace";
      else if (task.status === "awaiting_approval") hint.textContent = "ตรวจ Plan แล้วกด Approve & Execute เมื่อพร้อมให้ Native Worker แก้ไฟล์จริง";
      else if (task.status === "awaiting_verification") hint.textContent = "Execution มี Snapshot แล้ว · Verify ต่อ หรือ Rollback เพื่อคืน workspace ก่อน execution";
      else if (task.status === "completed") hint.textContent = "Verification ผ่านแล้ว งานนี้ DONE · หากจะย้อนภายหลังให้ใช้ Revert Task ในรุ่นถัดไป";
      else if (task.status === "verification_failed") hint.textContent = "Verification ไม่ผ่าน · สามารถ Rollback snapshot ที่บันทึกไว้ได้";
      else if (task.status === "rolled_back") hint.textContent = "Rollback ผ่านการตรวจ hash แล้ว · workspace กลับสภาพก่อน execution";
      else if (task.status === "failed" && rollbackReady(task)) hint.textContent = "Execution มี snapshot ที่ใช้ได้ · สามารถ Rollback เพื่อคืน workspace";
    };
  }

  function patchActionState() {
    if (typeof applyActionState !== "function") return;
    const original = applyActionState;
    applyActionState = function patchedActionState() {
      original();
      const select = document.querySelector("#taskMode");
      if (select?.value !== "core") return;

      const run = document.querySelector("#runTaskBtn");
      const taskStatus = document.querySelector("#taskStatus");
      const hint = document.querySelector("#connectionHint");
      const hasGoal = !!document.querySelector("#taskInput")?.value.trim();
      const ready = coreReady();
      const busy = typeof state !== "undefined" && state.busy;

      if (run) run.disabled = !(ready && hasGoal && !busy);
      if (!busy) {
        if (!ready) {
          if (taskStatus) {
            taskStatus.textContent = "รอ WebAi Core";
            taskStatus.className = "pill warn";
          }
          if (hint) hint.textContent = "Core Execute ต้องเชื่อม Core URL + Pairing และ Workspace ต้องพร้อม";
        } else if (state.agentTask?.status === "rolled_back") {
          if (taskStatus) {
            taskStatus.textContent = "Rolled back";
            taskStatus.className = "pill warn";
          }
          if (hint) hint.textContent = "Workspace ถูกคืนสภาพและตรวจ hash แล้ว";
        } else {
          if (taskStatus) {
            taskStatus.textContent = "Core พร้อม Execute";
            taskStatus.className = "pill ok";
          }
          if (hint) hint.textContent = "Native Worker พร้อม · execution จะสร้าง Snapshot ก่อนเขียนไฟล์";
        }
      }

      const label = run?.querySelector("span");
      if (label) label.textContent = ready ? "Create Core Task → Review Plan" : "เชื่อมต่อ WebAi Core ก่อน";
      updateAgentActions();
    };
  }

  function coreErrorMessage(error) {
    const code = error?.code || error?.message || "";
    if (code === "native_worker_disabled") return "WebAi Core ออนไลน์ แต่ Native Worker ยังปิด";
    if (code === "workspace_not_configured") return "WebAi Core ออนไลน์ แต่ Workspace ยังไม่พร้อม";
    if (code === "snapshot_store_not_configured") return "WebAi Core ยังไม่ได้ตั้ง Snapshot Store";
    if (code === "session_required") return "Core session ไม่พร้อม · Pairing ใหม่อีกครั้ง";
    if (code === "completed_task_not_rollbackable") return "Task นี้ Verification ผ่านและ DONE แล้ว จึงไม่อนุญาต Rollback แบบ transaction";
    if (code === "rollback_conflict") {
      const files = Array.isArray(error?.files) ? error.files.join(", ") : "workspace";
      return `Rollback ถูกหยุดเพราะไฟล์เปลี่ยนหลัง execution: ${files}`;
    }
    return error?.message || "Core Execute ไม่สำเร็จ";
  }

  async function runCoreTask() {
    const goal = document.querySelector("#taskInput")?.value.trim() || "";
    if (!goal || state.busy) return;
    if (!coreReady()) {
      setAgentError("เชื่อมต่อ WebAi Core และ Pairing ก่อนเริ่ม Core Execute");
      document.querySelector("#openConnection")?.click();
      return;
    }

    makeTask(goal, "core");
    setBusy(true, "กำลังวางแผน Core Task");
    setAgentError("");
    try {
      await createAgentTask(goal);
    } catch (error) {
      const message = coreErrorMessage(error);
      setAgentError(message);
      addTimeline("Core task failed", message, "bad");
      log(`Core task failed · ${message}`, "bad");
      finishTask(message, false);
    }
  }

  function renderRolledBack(task) {
    const restored = task?.rollback?.restoredFiles || 0;
    const status = document.querySelector("#taskStatus");
    if (status) {
      status.textContent = "Rolled back";
      status.className = "pill warn";
    }
    const badge = document.querySelector("#gateBadge");
    const message = document.querySelector("#gateMessage");
    if (badge) {
      badge.textContent = "ROLLED BACK";
      badge.className = "gateBadge waiting";
    }
    if (message) message.textContent = `${restored} file(s) restored และ hash ตรงกับ snapshot ก่อน execution · งานนี้ไม่ถือว่า DONE`;
    addTimeline("Rollback verified", `${restored} file(s) restored`, "ok");
    log(`Rollback verified · ${restored} file(s) restored`, "ok");
  }

  async function runRollback() {
    const task = state.agentTask;
    if (!task?.id || !rollbackReady(task) || state.busy) return;
    setAgentError("");
    state.busy = true;
    const status = document.querySelector("#taskStatus");
    if (status) {
      status.textContent = "กำลัง Rollback";
      status.className = "pill info";
    }
    updateAgentActions();
    addTimeline("Rollback started", "กำลังตรวจ drift และคืนไฟล์จาก snapshot", "working");
    try {
      const result = await bridge().request(`/api/tasks/${encodeURIComponent(task.id)}/rollback`);
      applyAgentTask(result);
      renderRolledBack(result);
    } catch (error) {
      const message = coreErrorMessage(error);
      setAgentError(message);
      addTimeline("Rollback blocked", message, "bad");
      log(`Rollback blocked · ${message}`, "bad");
    } finally {
      state.busy = false;
      applyActionState();
    }
  }

  function interceptCoreRun() {
    const run = document.querySelector("#runTaskBtn");
    run?.addEventListener("click", (event) => {
      if (document.querySelector("#taskMode")?.value !== "core") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runCoreTask();
    }, true);

    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
      if (document.querySelector("#taskMode")?.value !== "core") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!run?.disabled) runCoreTask();
    }, true);
  }

  function bindReconcile() {
    const select = document.querySelector("#taskMode");
    const input = document.querySelector("#taskInput");
    select?.addEventListener("change", () => applyActionState());
    input?.addEventListener("input", () => applyActionState());
    window.addEventListener("focus", () => applyActionState());
  }

  installModeOption();
  cleanupLegacyOmpUi();
  installRollbackButton();
  patchModeLabel();
  patchStatusLabel();
  patchAgentActions();
  patchActionState();
  interceptCoreRun();
  bindReconcile();
  applyActionState();

  window.WebAiCoreMode = {
    isReady: coreReady,
    run: runCoreTask,
    rollback: runRollback,
  };
})();
