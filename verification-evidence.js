(() => {
  const DEFAULT_GATES = [
    ["file_safety", "File Safety"],
    ["security", "Security"],
    ["build", "Build"],
    ["unit", "Unit Tests"],
    ["integration", "Integration"],
    ["regression", "Regression"],
  ];

  const verificationList = document.querySelector("#verificationList");
  const originalInspectorRows = verificationList
    ? [...verificationList.children].map((node) => node.cloneNode(true))
    : [];

  function ensureStyles() {
    if (document.querySelector('link[data-webai-verification-evidence]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./verification-evidence.css";
    link.dataset.webaiVerificationEvidence = "1";
    document.head.appendChild(link);
  }

  function ensureDetailsContainer() {
    const panel = document.querySelector("#tab-tests");
    if (!panel) return null;
    let container = panel.querySelector("#coreVerificationEvidence");
    if (!container) {
      container = document.createElement("div");
      container.id = "coreVerificationEvidence";
      container.className = "verificationEvidence";
      container.hidden = true;
      panel.appendChild(container);
    }
    return container;
  }

  function restoreBrowserInspector() {
    if (verificationList && originalInspectorRows.length) {
      verificationList.replaceChildren(...originalInspectorRows.map((node) => node.cloneNode(true)));
    }
    const details = ensureDetailsContainer();
    if (details) {
      details.replaceChildren();
      details.hidden = true;
    }
    const panel = document.querySelector("#tab-tests");
    const empty = panel?.querySelector(".emptyState");
    if (empty) empty.hidden = false;
  }

  function statusUi(status) {
    if (status === "passed") return { icon: "✓", className: "pass", label: "Passed" };
    if (status === "failed") return { icon: "×", className: "fail", label: "Failed" };
    if (status === "blocked") return { icon: "!", className: "fail", label: "Blocked" };
    if (status === "skipped") return { icon: "○", className: "idle", label: "Skipped" };
    return { icon: "○", className: "idle", label: "Waiting" };
  }

  function waitingGates() {
    return DEFAULT_GATES.map(([id, label]) => ({ id, label, required: id === "file_safety" || id === "security", status: "waiting" }));
  }

  function gatesFor(task) {
    const gates = Array.isArray(task?.verification?.gates) ? task.verification.gates.slice(0, 12) : [];
    return gates.length ? gates : waitingGates();
  }

  function makeInspectorRow(gate) {
    const row = document.createElement("div");
    const dot = document.createElement("span");
    const title = document.createElement("b");
    const result = document.createElement("em");
    const ui = statusUi(gate?.status);
    dot.className = `checkDot ${ui.className}`;
    dot.textContent = ui.icon;
    title.textContent = String(gate?.label || gate?.id || "Gate").slice(0, 100);
    result.textContent = gate?.required === false && gate?.status === "skipped" ? "Not configured" : ui.label;
    row.append(dot, title, result);
    return row;
  }

  function makeMeta(label, value) {
    const box = document.createElement("div");
    box.className = "verificationMeta";
    const small = document.createElement("small");
    const code = document.createElement("code");
    small.textContent = label;
    code.textContent = value;
    box.append(small, code);
    return box;
  }

  function makeGateCard(gate) {
    const card = document.createElement("article");
    card.className = `verificationGateCard ${gate?.status || "waiting"}`;

    const head = document.createElement("div");
    head.className = "verificationGateHead";
    const left = document.createElement("div");
    const title = document.createElement("b");
    const subtitle = document.createElement("small");
    title.textContent = String(gate?.label || gate?.id || "Gate").slice(0, 100);
    subtitle.textContent = gate?.required === false ? "OPTIONAL / NOT CONFIGURED" : "REQUIRED GATE";
    left.append(title, subtitle);
    const badge = document.createElement("span");
    badge.className = `verificationGateBadge ${gate?.status || "waiting"}`;
    badge.textContent = statusUi(gate?.status).label.toUpperCase();
    head.append(left, badge);

    const meta = document.createElement("div");
    meta.className = "verificationGateMeta";
    if (typeof gate?.command === "string") meta.appendChild(makeMeta("COMMAND", gate.command.slice(0, 320)));
    if (Number.isInteger(gate?.durationMs)) meta.appendChild(makeMeta("DURATION", `${gate.durationMs} ms`));
    if (typeof gate?.outputSha256 === "string") meta.appendChild(makeMeta("OUTPUT SHA-256", gate.outputSha256.slice(0, 64)));
    if (Number.isInteger(gate?.changedFiles)) meta.appendChild(makeMeta("CHANGED FILES", String(gate.changedFiles)));
    if (Number.isInteger(gate?.scannedFiles)) meta.appendChild(makeMeta("SCANNED FILES", String(gate.scannedFiles)));

    const note = document.createElement("p");
    note.className = "verificationGateNote";
    if (gate?.status === "failed" || gate?.status === "blocked") {
      note.textContent = `Evidence code: ${String(gate?.error || "verification_failed").slice(0, 120)}`;
    } else if (gate?.status === "skipped") {
      note.textContent = "โปรเจกต์นี้ไม่ได้กำหนด gate นี้ จึงไม่ถูกนับเป็น required gate";
    } else if (gate?.status === "passed") {
      note.textContent = gate?.outputCaptured === true
        ? "ผ่านแล้ว · เก็บเฉพาะ output hash/metadata ไม่เก็บ stdout/stderr ดิบ"
        : "ผ่านแล้ว · deterministic evidence ถูกบันทึกใน task state";
    } else {
      note.textContent = "รอเริ่ม Verification";
    }

    card.append(head);
    if (meta.children.length) card.append(meta);
    card.append(note);
    return card;
  }

  function paintGateSummary(task) {
    const badge = document.querySelector("#gateBadge");
    const message = document.querySelector("#gateMessage");
    if (!badge || !message) return;
    const verification = task?.verification;
    if (task?.status === "completed" && verification?.ok === true) {
      badge.textContent = "PASS";
      badge.className = "gateBadge pass";
      message.textContent = `${verification.passedRequired || 0}/${verification.requiredGates || 0} required gates passed · DONE`;
      return;
    }
    if (task?.status === "verification_failed") {
      badge.textContent = "FAILED";
      badge.className = "gateBadge fail";
      message.textContent = `${verification?.passedRequired || 0}/${verification?.requiredGates || 0} required gates passed · งานยังไม่ DONE`;
      return;
    }
    if (task?.status === "verifying") {
      badge.textContent = "VERIFYING";
      badge.className = "gateBadge waiting";
      message.textContent = "กำลังรัน File Safety → Security → project gates บน Host B";
      return;
    }
    if (task?.status === "awaiting_verification") {
      badge.textContent = "READY TO VERIFY";
      badge.className = "gateBadge waiting";
      message.textContent = "Snapshot + Diff Evidence พร้อม · รอ Multi-Gate Verification";
    }
  }

  function renderCoreVerification(task) {
    if (task?._webaiPlane !== "core") {
      restoreBrowserInspector();
      return;
    }
    const gates = gatesFor(task);
    if (verificationList) verificationList.replaceChildren(...gates.map(makeInspectorRow));

    const details = ensureDetailsContainer();
    const panel = document.querySelector("#tab-tests");
    const empty = panel?.querySelector(".emptyState");
    if (empty) empty.hidden = true;
    if (details) {
      details.hidden = false;
      details.replaceChildren();
      const summary = document.createElement("div");
      summary.className = "verificationEvidenceSummary";
      const title = document.createElement("div");
      const kicker = document.createElement("small");
      const strong = document.createElement("b");
      kicker.textContent = "MULTI-GATE VERIFICATION";
      strong.textContent = task?.verification?.profile || "multi-gate-v0.5";
      title.append(kicker, strong);
      const counts = document.createElement("span");
      const required = Number.isInteger(task?.verification?.requiredGates) ? task.verification.requiredGates : gates.filter((gate) => gate.required).length;
      const passed = Number.isInteger(task?.verification?.passedRequired) ? task.verification.passedRequired : gates.filter((gate) => gate.required && gate.status === "passed").length;
      counts.textContent = `${passed}/${required} required passed`;
      summary.append(title, counts);
      details.appendChild(summary);
      for (const gate of gates) details.appendChild(makeGateCard(gate));
    }
    paintGateSummary(task);
  }

  function patchTaskRenderer() {
    if (typeof applyAgentTask !== "function") return;
    const original = applyAgentTask;
    applyAgentTask = function webAiVerificationApplyTask(task) {
      if (task?._webaiPlane !== "core") restoreBrowserInspector();
      original(task);
      renderCoreVerification(task);
    };
  }

  function patchReset() {
    if (typeof resetTask !== "function") return;
    const original = resetTask;
    resetTask = function webAiVerificationResetTask() {
      original();
      restoreBrowserInspector();
    };
  }

  ensureStyles();
  ensureDetailsContainer();
  patchTaskRenderer();
  patchReset();
  if (typeof state !== "undefined" && state.agentTask?._webaiPlane === "core") renderCoreVerification(state.agentTask);

  window.WebAiVerificationEvidence = {
    render: renderCoreVerification,
    restoreBrowser: restoreBrowserInspector,
  };
})();
