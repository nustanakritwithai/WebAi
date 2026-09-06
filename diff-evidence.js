(() => {
  const $ = (selector, root = document) => root.querySelector(selector);

  function ensureStyles() {
    if (document.querySelector('link[data-webai-diff-evidence]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./diff-evidence.css";
    link.dataset.webaiDiffEvidence = "1";
    document.head.appendChild(link);
  }

  function latestExecution(task) {
    return Array.isArray(task?.executions) && task.executions.length
      ? task.executions[task.executions.length - 1]
      : null;
  }

  function boundedHash(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : "—";
  }

  function numberOrNull(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function ensureContainer() {
    const panel = $("#tab-diff");
    if (!panel) return null;
    let list = $("#diffEvidenceList", panel);
    if (!list) {
      list = document.createElement("div");
      list.id = "diffEvidenceList";
      list.className = "diffEvidenceList";
      list.hidden = true;
      panel.appendChild(list);
    }
    return list;
  }

  function resetDiffEvidence() {
    const panel = $("#tab-diff");
    const list = ensureContainer();
    if (list) {
      list.replaceChildren();
      list.hidden = true;
    }
    const empty = panel?.querySelector(".emptyState");
    if (empty) empty.hidden = false;
    const headline = $("#diffHeadline");
    const stats = $("#diffStats");
    if (headline) headline.textContent = "0 files changed";
    if (stats) stats.textContent = "+0 −0";
  }

  function makeStat(text, className) {
    const span = document.createElement("span");
    span.className = `diffEvidenceStat ${className}`;
    span.textContent = text;
    return span;
  }

  function makeHash(label, hash) {
    const box = document.createElement("div");
    box.className = "diffHash";
    const small = document.createElement("small");
    small.textContent = label;
    const code = document.createElement("code");
    code.textContent = boundedHash(hash);
    box.append(small, code);
    return box;
  }

  function kindFor(file) {
    if (file?.existed !== true && file?.changed === true) return { label: "CREATED", className: "created" };
    if (file?.changed !== true) return { label: "UNCHANGED", className: "unchanged" };
    return { label: "MODIFIED", className: "modified" };
  }

  function renderFile(file) {
    const card = document.createElement("article");
    card.className = "diffEvidenceCard";

    const head = document.createElement("div");
    head.className = "diffEvidenceHead";
    const path = document.createElement("div");
    path.className = "diffEvidencePath";
    path.textContent = String(file?.path || "(unknown file)").slice(0, 240);
    const kind = kindFor(file);
    const badge = document.createElement("span");
    badge.className = `diffEvidenceKind ${kind.className}`;
    badge.textContent = kind.label;
    head.append(path, badge);

    const stats = document.createElement("div");
    stats.className = "diffEvidenceStats";
    const additions = numberOrNull(file?.additions);
    const deletions = numberOrNull(file?.deletions);
    stats.append(
      makeStat(additions == null ? "+—" : `+${additions}`, "add"),
      makeStat(deletions == null ? "−—" : `−${deletions}`, "del"),
    );
    const beforeBytes = numberOrNull(file?.bytesBefore);
    const afterBytes = numberOrNull(file?.bytesAfter);
    if (beforeBytes != null || afterBytes != null) {
      stats.append(makeStat(`${beforeBytes ?? 0}B → ${afterBytes ?? 0}B`, "neutral"));
    }

    const hashes = document.createElement("div");
    hashes.className = "diffEvidenceHashes";
    hashes.append(makeHash("BEFORE SHA-256", file?.beforeSha256), makeHash("AFTER SHA-256", file?.afterSha256));

    const note = document.createElement("div");
    note.className = "diffEvidenceNote";
    if (file?.diffKind === "non-text") note.textContent = "Non-text file · เก็บ hash/bytes แต่ไม่เดา line diff";
    else if (file?.diffExact === true) note.textContent = "Exact line diff · evidence มาจาก server-side snapshot transaction";
    else note.textContent = "Bounded line estimate · hash ยังเป็น exact SHA-256";

    card.append(head, stats, hashes, note);
    return card;
  }

  function renderDiffEvidence(task) {
    const execution = latestExecution(task);
    const files = Array.isArray(execution?.files) ? execution.files.slice(0, 32) : [];
    if (!execution || !files.length) {
      resetDiffEvidence();
      return;
    }

    const list = ensureContainer();
    const panel = $("#tab-diff");
    if (!list || !panel) return;
    const empty = panel.querySelector(".emptyState");
    if (empty) empty.hidden = true;
    list.hidden = false;
    list.replaceChildren();

    const changed = files.filter((file) => file?.changed === true);
    const additions = changed.reduce((sum, file) => sum + (numberOrNull(file?.additions) ?? 0), 0);
    const deletions = changed.reduce((sum, file) => sum + (numberOrNull(file?.deletions) ?? 0), 0);
    const unavailable = changed.filter((file) => numberOrNull(file?.additions) == null || numberOrNull(file?.deletions) == null).length;
    const bounded = changed.filter((file) => file?.diffExact !== true && file?.diffKind !== "non-text").length;

    const headline = $("#diffHeadline");
    const summary = $("#diffStats");
    if (headline) headline.textContent = `${changed.length} file${changed.length === 1 ? "" : "s"} changed`;
    if (summary) {
      const suffix = [bounded ? `${bounded} bounded` : "", unavailable ? `${unavailable} non-text` : ""].filter(Boolean).join(" · ");
      summary.textContent = `+${additions} −${deletions}${suffix ? ` · ${suffix}` : ""}`;
    }

    const meta = document.createElement("div");
    meta.className = "diffEvidenceMeta";
    const left = document.createElement("div");
    const kicker = document.createElement("small");
    kicker.textContent = "TRANSACTION EVIDENCE";
    const id = document.createElement("b");
    id.textContent = String(execution.executionId || "execution").slice(0, 120);
    left.append(kicker, id);
    const right = document.createElement("em");
    right.textContent = `${String(execution.status || "unknown")} · ${files.length} tracked file(s)`;
    meta.append(left, right);
    list.appendChild(meta);

    for (const file of files) list.appendChild(renderFile(file));
  }

  function patchTaskRenderer() {
    if (typeof applyAgentTask !== "function") return;
    const original = applyAgentTask;
    applyAgentTask = function patchedApplyAgentTask(task) {
      original(task);
      renderDiffEvidence(task);
    };
  }

  function patchReset() {
    if (typeof resetTask !== "function") return;
    const original = resetTask;
    resetTask = function patchedResetTask() {
      original();
      resetDiffEvidence();
    };
  }

  ensureStyles();
  ensureContainer();
  patchTaskRenderer();
  patchReset();
  if (typeof state !== "undefined" && state.agentTask) renderDiffEvidence(state.agentTask);
  else resetDiffEvidence();

  window.WebAiDiffEvidence = {
    render: renderDiffEvidence,
    reset: resetDiffEvidence,
  };
})();
