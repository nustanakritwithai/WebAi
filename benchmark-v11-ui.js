(() => {
  "use strict";

  const HISTORY_KEY = "webai.benchmark.cb11.history";
  const WEIGHTS = { reasoning: 50, planning: 40, protocol: 10 };
  const els = {
    scoreRing: document.querySelector("#scoreRing"),
    validatedScore: document.querySelector("#validatedScore"),
    validatedScope: document.querySelector("#validatedScope"),
    dataQualityBadge: document.querySelector("#dataQualityBadge"),
    reasoningValidity: document.querySelector("#reasoningValidity"),
    planningValidity: document.querySelector("#planningValidity"),
    protocolValidity: document.querySelector("#protocolValidity"),
    qualityBanner: document.querySelector("#qualityBanner"),
    qualityTitle: document.querySelector("#qualityTitle"),
    qualityText: document.querySelector("#qualityText"),
    rawReasoning: document.querySelector("#rawReasoningSummary"),
    engineReasoning: document.querySelector("#engineReasoningSummary"),
    reasoningDelta: document.querySelector("#reasoningDeltaSummary"),
    compareStatus: document.querySelector("#compareStatus"),
    compareNote: document.querySelector("#compareNote"),
    quickReadTitle: document.querySelector("#quickReadTitle"),
    quickReadText: document.querySelector("#quickReadText"),
    filters: document.querySelector("#resultFilters"),
    resultCount: document.querySelector("#resultCount"),
    results: document.querySelector("#results"),
    history: document.querySelector("#history"),
    totalScore: document.querySelector("#totalScore"),
    upliftScore: document.querySelector("#upliftScore"),
    reasoningScore: document.querySelector("#reasoningScore"),
    planningScore: document.querySelector("#planningScore"),
    protocolScore: document.querySelector("#protocolScore"),
    reasoningPct: document.querySelector("#reasoningPct"),
    planningPct: document.querySelector("#planningPct"),
    protocolPct: document.querySelector("#protocolPct"),
    reasoningBar: document.querySelector("#reasoningBar"),
    planningBar: document.querySelector("#planningBar"),
    protocolBar: document.querySelector("#protocolBar"),
    reasoningMeta: document.querySelector("#reasoningMeta"),
    planningMeta: document.querySelector("#planningMeta"),
    protocolMeta: document.querySelector("#protocolMeta"),
    taxonomy: document.querySelector("#taxonomy"),
  };

  let selectedRun = null;
  let activeFilter = "all";

  function historyData() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function rowsFor(run, category) {
    return Array.isArray(run?.results) ? run.results.filter((row) => row.category === category) : [];
  }

  function categoryQuality(run, category) {
    const rows = rowsFor(run, category);
    const missing = rows.filter((row) => row.errorType === "MISSING_ANSWER" || !String(row.answer || "").trim()).length;
    const total = rows.length;
    const coverage = total ? (total - missing) / total : 0;
    const invalid = total > 0 && missing >= Math.ceil(total / 2);
    return { total, missing, coverage, valid: total > 0 && !invalid };
  }

  function validatedScoreOf(run) {
    if (!run) return null;
    const rq = categoryQuality(run, "reasoning");
    const pq = categoryQuality(run, "planning");
    let earned = Number(run.protocolScore || 0);
    let possible = WEIGHTS.protocol;
    if (rq.valid) { earned += Number(run.reasoningScore || 0); possible += WEIGHTS.reasoning; }
    if (pq.valid) { earned += Number(run.planningScore || 0); possible += WEIGHTS.planning; }
    return possible ? (earned / possible) * 100 : null;
  }

  function setValidity(el, quality) {
    if (!el) return;
    el.className = "validityBadge";
    if (!quality.total) {
      el.classList.add("neutral");
      el.textContent = "NO DATA";
    } else if (!quality.valid) {
      el.classList.add("bad");
      el.textContent = "INVALID";
    } else if (quality.coverage < 1) {
      el.classList.add("warn");
      el.textContent = `${Math.round(quality.coverage * 100)}% DATA`;
    } else {
      el.classList.add("good");
      el.textContent = "VALID";
    }
  }

  function latestPair() {
    const all = historyData();
    return {
      raw: all.find((run) => run.mode === "raw") || null,
      engine: all.find((run) => run.mode === "engine") || null,
    };
  }

  function updateComparison() {
    const { raw, engine } = latestPair();
    if (!raw || !engine) {
      els.rawReasoning.textContent = raw ? Number(raw.reasoningScore).toFixed(1) : "—";
      els.engineReasoning.textContent = engine ? Number(engine.reasoningScore).toFixed(1) : "—";
      els.reasoningDelta.textContent = "—";
      els.compareStatus.textContent = "WAITING";
      els.compareNote.textContent = "ต้องมีอย่างน้อย 1 Raw และ 1 Engine run";
      return null;
    }
    const delta = Number(engine.reasoningScore || 0) - Number(raw.reasoningScore || 0);
    els.rawReasoning.textContent = Number(raw.reasoningScore || 0).toFixed(1);
    els.engineReasoning.textContent = Number(engine.reasoningScore || 0).toFixed(1);
    els.reasoningDelta.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
    els.compareStatus.textContent = delta > 0 ? "UPLIFT" : delta < 0 ? "REGRESSION" : "FLAT";
    els.compareStatus.className = `miniBadge ${delta > 0 ? "good" : delta < 0 ? "bad" : "neutral"}`;
    const relative = Number(raw.reasoningScore || 0) > 0 ? (delta / Number(raw.reasoningScore)) * 100 : 0;
    els.compareNote.textContent = `${delta >= 0 ? "Engine ดีขึ้น" : "Engine ลดลง"} ${Math.abs(delta).toFixed(1)} คะแนนจาก 50 (${relative >= 0 ? "+" : ""}${relative.toFixed(1)}% เทียบ Raw)`;
    return { raw, engine, delta };
  }

  function decorateTaxonomy() {
    if (!els.taxonomy) return;
    els.taxonomy.querySelectorAll(".tax").forEach((chip) => {
      const text = chip.textContent.toUpperCase();
      chip.classList.remove("pass", "missing", "format", "error");
      if (text.includes("PASS")) chip.classList.add("pass");
      else if (text.includes("MISSING")) chip.classList.add("missing");
      else if (text.includes("FORMAT")) chip.classList.add("format");
      else chip.classList.add("error");
    });
  }

  function decorateResults(run) {
    const nodes = [...els.results.querySelectorAll("details.result")];
    const rows = Array.isArray(run?.results) ? run.results : [];
    nodes.forEach((node, index) => {
      const row = rows[index] || {};
      node.dataset.category = row.category || "";
      node.dataset.error = row.errorType || "";
      node.dataset.pass = Number(row.semantic || 0) >= .999 ? "true" : "false";
    });
    applyFilter();
  }

  function applyFilter() {
    const nodes = [...els.results.querySelectorAll("details.result")];
    let visible = 0;
    nodes.forEach((node) => {
      const category = node.dataset.category;
      const error = node.dataset.error;
      const pass = node.dataset.pass === "true";
      let show = true;
      if (activeFilter === "failed") show = !pass;
      else if (activeFilter === "missing") show = error === "MISSING_ANSWER";
      else if (activeFilter === "reasoning") show = category === "reasoning";
      else if (activeFilter === "planning") show = category === "planning";
      node.hidden = !show;
      if (show) visible += 1;
    });
    if (els.resultCount) els.resultCount.textContent = `${visible} / ${nodes.length} results`;
  }

  function updateQuickRead(run, rq, pq, comparison) {
    if (!run) return;
    if (!pq.valid && pq.total) {
      els.quickReadTitle.textContent = "Planning ยังวัดไม่ได้";
      const upliftText = comparison && comparison.delta > 0 ? `Reasoning Engine เพิ่ม Reasoning ${comparison.delta.toFixed(1)}/50 แต่ ` : "";
      els.quickReadText.textContent = `${upliftText}Planning มีคำตอบหาย ${pq.missing}/${pq.total} ข้อ จึงต้องแก้ harness ก่อนตีความความสามารถด้านการวางแผน`;
      return;
    }
    if (!rq.valid && rq.total) {
      els.quickReadTitle.textContent = "Reasoning data ไม่สมบูรณ์";
      els.quickReadText.textContent = `มีคำตอบ Reasoning หาย ${rq.missing}/${rq.total} ข้อ คะแนนรอบนี้ไม่ควรใช้เป็น baseline`;
      return;
    }
    if (comparison && comparison.delta > 0) {
      els.quickReadTitle.textContent = "Reasoning Engine ช่วยได้จริง";
      els.quickReadText.textContent = `รอบล่าสุด Engine สูงกว่า Raw ${comparison.delta.toFixed(1)} คะแนนจาก 50; ใช้ Planning ต่อเมื่อ data quality ผ่าน`;
      return;
    }
    els.quickReadTitle.textContent = "ข้อมูลพร้อมเปรียบเทียบ";
    els.quickReadText.textContent = "ดู Failed และ Missing แยกกัน เพื่อไม่เอาปัญหา formatter ไปปนกับความสามารถของโมเดล";
  }

  function renderEnhancements(run) {
    if (!run) {
      els.validatedScore.textContent = "—";
      els.scoreRing?.style.setProperty("--score", 0);
      updateComparison();
      return;
    }
    selectedRun = run;
    const rq = categoryQuality(run, "reasoning");
    const pq = categoryQuality(run, "planning");
    const validated = validatedScoreOf(run);
    const comparison = updateComparison();

    els.totalScore.textContent = Number(run.totalScore || 0).toFixed(1);
    els.protocolScore.textContent = Number(run.protocolScore || 0).toFixed(1);
    els.protocolPct.textContent = `${Math.round((Number(run.protocolScore || 0) / WEIGHTS.protocol) * 100)}%`;
    els.protocolBar.style.width = `${Math.round((Number(run.protocolScore || 0) / WEIGHTS.protocol) * 100)}%`;
    els.protocolMeta.textContent = `JSON ${Math.round(Number(run.protocol?.jsonRate || 0) * 100)}% · IDs ${Math.round(Number(run.protocol?.completeness || 0) * 100)}%`;

    setValidity(els.reasoningValidity, rq);
    setValidity(els.planningValidity, pq);
    if (els.protocolValidity) {
      const ok = Number(run.protocolScore || 0) >= 9;
      els.protocolValidity.className = `validityBadge ${ok ? "good" : "warn"}`;
      els.protocolValidity.textContent = ok ? "STABLE" : "FORMAT";
    }

    if (rq.valid) {
      els.reasoningScore.textContent = Number(run.reasoningScore || 0).toFixed(1);
      els.reasoningPct.textContent = `${Math.round((Number(run.reasoningScore || 0) / WEIGHTS.reasoning) * 100)}%`;
      els.reasoningBar.style.width = `${Math.round((Number(run.reasoningScore || 0) / WEIGHTS.reasoning) * 100)}%`;
      els.reasoningMeta.textContent = `${run.category?.reasoning?.passed ?? 0}/${rq.total} full-pass${rq.missing ? ` · ${rq.missing} missing` : ""}`;
    } else {
      els.reasoningScore.textContent = "—";
      els.reasoningPct.textContent = "INVALID";
      els.reasoningBar.style.width = "0%";
      els.reasoningMeta.textContent = `${rq.missing}/${rq.total} answers missing · excluded`;
    }

    if (pq.valid) {
      els.planningScore.textContent = Number(run.planningScore || 0).toFixed(1);
      els.planningPct.textContent = `${Math.round((Number(run.planningScore || 0) / WEIGHTS.planning) * 100)}%`;
      els.planningBar.style.width = `${Math.round((Number(run.planningScore || 0) / WEIGHTS.planning) * 100)}%`;
      els.planningMeta.textContent = `${run.category?.planning?.passed ?? 0}/${pq.total} full-pass${pq.missing ? ` · ${pq.missing} missing` : ""}`;
    } else {
      els.planningScore.textContent = "—";
      els.planningPct.textContent = "INVALID";
      els.planningBar.style.width = "0%";
      els.planningMeta.textContent = `${pq.missing}/${pq.total} answers missing · not a model score`;
    }

    els.validatedScore.textContent = validated == null ? "—" : validated.toFixed(1);
    els.scoreRing?.style.setProperty("--score", validated == null ? 0 : Math.max(0, Math.min(100, validated)));
    const included = [rq.valid ? "Reasoning" : null, pq.valid ? "Planning" : null, "Protocol"].filter(Boolean);
    const excluded = [!rq.valid && rq.total ? "Reasoning" : null, !pq.valid && pq.total ? "Planning" : null].filter(Boolean);
    els.validatedScope.textContent = excluded.length ? `คำนวณจาก ${included.join(" + ")} · ตัด ${excluded.join(" + ")} ออกเพราะ data invalid` : `คำนวณจาก ${included.join(" + ")} ครบทุกหมวด`;

    els.dataQualityBadge.className = "qualityBadge";
    if (excluded.length) {
      els.dataQualityBadge.classList.add("warn");
      els.dataQualityBadge.textContent = "PARTIAL DATA";
      els.qualityBanner.hidden = false;
      els.qualityTitle.textContent = `${excluded.join(" + ")} result invalid`;
      const details = [];
      if (!rq.valid && rq.total) details.push(`Reasoning missing ${rq.missing}/${rq.total}`);
      if (!pq.valid && pq.total) details.push(`Planning missing ${pq.missing}/${pq.total}`);
      els.qualityText.textContent = `${details.join(" · ")} — หมวดนี้ถูกตัดออกจาก Validated capability และไม่ควรอ่านเป็น 0%`;
    } else {
      els.dataQualityBadge.classList.add("good");
      els.dataQualityBadge.textContent = "DATA VALID";
      els.qualityBanner.hidden = true;
    }

    const raw = latestPair().raw;
    if (run.mode === "engine" && raw) {
      const baseValidated = validatedScoreOf(raw);
      const delta = baseValidated == null || validated == null ? null : validated - baseValidated;
      els.upliftScore.textContent = delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`;
    } else {
      els.upliftScore.textContent = "—";
    }

    decorateTaxonomy();
    decorateResults(run);
    updateQuickRead(run, rq, pq, comparison);
  }

  els.filters?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter || "all";
    els.filters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    applyFilter();
  });

  els.history?.addEventListener("click", (event) => {
    const row = event.target.closest(".historyRow");
    if (!row) return;
    const rows = [...els.history.querySelectorAll(".historyRow")];
    const index = rows.indexOf(row);
    const run = historyData()[index];
    if (run) setTimeout(() => renderEnhancements(run), 0);
  });

  if (els.history) {
    const observer = new MutationObserver(() => {
      const latest = historyData()[0] || null;
      if (latest) setTimeout(() => renderEnhancements(latest), 0);
    });
    observer.observe(els.history, { childList: true });
  }

  renderEnhancements(historyData()[0] || null);
})();
