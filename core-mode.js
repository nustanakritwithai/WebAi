(() => {
  const bridge = () => window.WebAiCoreBridge;

  function coreReady() {
    return bridge()?.isTaskReady?.() === true
      && document.documentElement.dataset.nativeWorker === "ready";
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
    if (welcome) welcome.textContent = "Agent คิดผ่าน OpenTyphoon ได้ทันที ส่วน Core Execute ใช้ WebAi Native Worker และ Verification สำหรับงานที่ต้องแก้ไฟล์จริง";

    document.querySelectorAll("#tab-preview .emptyState small, #tab-diff .emptyState small").forEach((node) => {
      node.textContent = (node.textContent || "")
        .replaceAll("OMP", "WebAi Core")
        .replaceAll("repository", "workspace");
    });
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
      const isCore = select?.value === "core";

      if (panel) panel.hidden = !isCore;
      if (!isCore) return;

      const task = typeof state !== "undefined" ? state.agentTask : null;
      const ready = coreReady();
      if (approve) approve.disabled = !(ready && !state.busy && task?.status === "awaiting_approval");
      if (verify) verify.disabled = !(ready && !state.busy && task?.status === "awaiting_verification");

      if (!hint) return;
      if (!ready) hint.textContent = "เชื่อมต่อ WebAi Core และ Pairing ก่อนเริ่ม Core Execute";
      else if (!task) hint.textContent = "Core จะวางแผนก่อน แล้วหยุดรอให้คุณอนุมัติก่อนแก้ workspace";
      else if (task.status === "awaiting_approval") hint.textContent = "ตรวจ Plan แล้วกด Approve & Execute เมื่อพร้อมให้ Native Worker แก้ไฟล์จริง";
      else if (task.status === "awaiting_verification") hint.textContent = "Execution จบแล้ว กด Run Verification ก่อนงานจะถือว่า DONE";
      else if (task.status === "completed") hint.textContent = "Verification ผ่านแล้ว งานนี้จึงถือว่า DONE";
      else if (task.status === "verification_failed") hint.textContent = "Verification ไม่ผ่าน งานยังไม่ DONE และควร Fix หรือ Rollback";
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
        } else {
          if (taskStatus) {
            taskStatus.textContent = "Core พร้อม Execute";
            taskStatus.className = "pill ok";
          }
          if (hint) hint.textContent = "Native Worker พร้อม · execution จะหยุดรอ Approval ก่อนแก้ไฟล์";
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
    if (code === "session_required") return "Core session ไม่พร้อม · Pairing ใหม่อีกครั้ง";
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
  patchModeLabel();
  patchAgentActions();
  patchActionState();
  interceptCoreRun();
  bindReconcile();
  applyActionState();

  window.WebAiCoreMode = {
    isReady: coreReady,
    run: runCoreTask,
  };
})();
