(() => {
  "use strict";

  const VERSION = "CB-1.1";
  const BATCH_SIZE = 4;
  const HISTORY_KEY = "webai.benchmark.cb11.history";
  const RAW_KEY = "webai.benchmark.cb11.raw";
  const WEIGHTS = { reasoning: 50, planning: 40, protocol: 10 };

  const R = (id, prompt, grader) => ({ id, category: "reasoning", prompt, grader });
  const P = (id, prompt, grader) => ({ id, category: "planning", prompt, grader });
  const TESTS = [
    R("R-01", "เครื่องจักร 1 เครื่องผลิต 24 ชิ้นใน 3 ชั่วโมง ถ้ามี 17 เครื่องทำพร้อมกัน 5 ชั่วโมง ผลิตได้กี่ชิ้น ตอบจำนวนสุดท้าย", { type: "number", value: 680 }),
    R("R-02", "เงื่อนไข: Alice ก่อน Bob, Cara หลัง Bob, Dan ก่อน Alice เรียงทั้ง 4 คน ตอบ D>A>B>C รูปแบบเดียวกัน", { type: "exactCI", value: "D>A>B>C" }),
    R("R-03", "มีผู้ใช้ 40 คน ใช้ A=23 ใช้ B=18 ใช้ทั้งสอง=7 มีกี่คนใช้ A หรือ B อย่างน้อยหนึ่งอย่าง", { type: "number", value: 34 }),
    R("R-04", "ถุงมีแดง 3 น้ำเงิน 2 สุ่ม 2 โดยไม่คืน ความน่าจะเป็นได้แดงทั้งสอง ตอบเศษส่วนอย่างต่ำสุดหรือทศนิยม", { type: "oneOf", values: ["3/10", "0.3", "0.30"] }),
    R("R-05", "ลำดับ 2, 6, 12, 20, 30, ? ตัวถัดไป", { type: "number", value: 42 }),
    R("R-06", "START ได้เมื่อ database_ready=true และ cache_healthy=true เท่านั้น ตอนนี้ true,false ควร START หรือ DO_NOT_START", { type: "exactCI", value: "DO_NOT_START" }),
    R("R-07", "ราคา 1200 ลด 15% แล้วคิดภาษี 7% จากราคาหลังลด ราคาสุทธิเท่าไร", { type: "number", value: 1091.4 }),
    R("R-08", "คะแนน 5 ครั้ง: 3 ครั้งแรกได้ 80 และ 2 ครั้งหลังได้ 95 ค่าเฉลี่ยเท่าไร", { type: "number", value: 86 }),
    R("R-09", "แบ่ง 64 หน่วยในอัตราส่วน 3:5 ส่วนเล็กและส่วนใหญ่ได้เท่าไร ตอบ 24,40", { type: "compactOneOf", values: ["24,40", "24:40", "24and40", "24และ40"] }),
    R("R-10", "งาน A ใช้ 2 ชม. งาน B ใช้ 3 ชม.และเริ่มหลัง A เท่านั้น งาน C อิสระใช้ 4 ชม. มีคนทำพร้อมกันได้ไม่จำกัด งานทั้งหมดเสร็จเร็วสุดกี่ชั่วโมง", { type: "number", value: 5 }),
    R("R-11", "ให้ A=false, B=true, C=false ค่าของ (A OR B) AND NOT C เป็น TRUE หรือ FALSE", { type: "exactCI", value: "TRUE" }),
    R("R-12", "ทุก M เป็น N และไม่มี N ใดเป็น P เป็นไปได้ไหมที่ M บางตัวเป็น P ตอบ YES หรือ NO", { type: "exactCI", value: "NO" }),
    R("R-13", "กราฟมี A-B=2, B-D=4, A-C=5, C-D=1 ระยะทางสั้นสุดจาก A ไป D เท่าไร", { type: "number", value: 6 }),
    R("R-14", "มีของ 257 ชิ้น กล่องละได้สูงสุด 24 ชิ้น ต้องใช้กล่องอย่างน้อยกี่ใบ", { type: "number", value: 11 }),
    R("R-15", "x=5, y=2x+3, z=y-x ค่า z เท่าไร", { type: "number", value: 8 }),
    R("R-16", "แต่ละ replica รับได้ 120 requests/s แต่ต้องเผื่อ headroom 25% ต้องรองรับ 500 requests/s อย่างปลอดภัย ต้องมีอย่างน้อยกี่ replica", { type: "number", value: 6 }),
    R("R-17", "backup ล่าสุด 10:00 ระบบล้ม 10:07 มีข้อมูลหลัง backup เสี่ยงสูญหายกี่นาที", { type: "number", value: 7 }),
    R("R-18", "Plan A ราคา 15 + 0.02 ต่อครั้ง, Plan B ราคา 8 + 0.04 ต่อครั้ง ที่ 500 ครั้ง plan ไหนถูกกว่า ตอบ A หรือ B", { type: "exactCI", value: "A" }),
    R("R-19", "จักรวาลมี 10 คน A=6 B=4 overlap=2 มีกี่คนที่ไม่อยู่ทั้ง A และ B", { type: "number", value: 2 }),
    R("R-20", "กฎบอกว่า IF test_passes THEN deploy_allowed ตอนนี้ test ไม่ผ่าน เราสรุปได้ไหมว่า deploy ไม่อนุญาต ตอบ CANNOT_CONCLUDE ถ้าสรุปไม่ได้จากกฎนี้เพียงอย่างเดียว", { type: "exactCI", value: "CANNOT_CONCLUDE" }),

    P("P-01", "ต้องเปลี่ยนชื่อ field ใน API response ที่ frontend และ mobile ใช้อยู่ วางแผน migration ที่ลด regression และถอด field เก่าได้ปลอดภัย", { type: "rubric", groups: [["consumer", "ผู้ใช้ field", "ค้นหา", "inventory"], ["compat", "backward", "dual", "รองรับ field เก่า"], ["test", "ทดสอบ"], ["staged", "canary", "ทยอย", "rollout"], ["remove", "deprecated", "ถอด field เก่า", "ลบ field เก่า"]] }),
    P("P-02", "production database latency พุ่งหลัง deploy ล่าสุด วางแผน incident response แบบลดผลกระทบก่อนหาสาเหตุ", { type: "rubric", groups: [["monitor", "metric", "วัด", "ตรวจอาการ"], ["rollback", "stabil", "ลดผลกระทบ", "ย้อน deploy"], ["cause", "root", "สาเหตุ"], ["verify", "ยืนยัน", "ตรวจหลังแก้"]] }),
    P("P-03", "ต้องทำ zero-downtime database migration เปลี่ยน schema ที่ app เก่ายังใช้อยู่ วางลำดับแบบ expand/contract", { type: "rubric", groups: [["additive", "expand", "เพิ่ม schema"], ["dual", "compatible", "รองรับเก่าใหม่", "read/write"], ["backfill", "ย้ายข้อมูล"], ["verify", "ตรวจ"], ["contract", "remove old", "ลบของเก่า"]] }),
    P("P-04", "พบ API secret หลุดใน log production วางแผนตอบสนองทันทีและปิดเหตุให้ครบ", { type: "rubric", groups: [["revoke", "rotate", "เพิกถอน", "หมุน key"], ["audit", "log", "ตรวจการใช้"], ["replace", "deploy new", "เปลี่ยน secret"], ["verify", "ตรวจยืนยัน"]] }),
    P("P-05", "ฟีเจอร์ Login ต้อง reject invalid email, credentials ถูกต้อง redirect /dashboard, และ empty password ต้อง reject วาง acceptance/test plan", { type: "rubric", groups: [["invalid email", "อีเมลไม่ถูก"], ["/dashboard"], ["empty password", "password ว่าง", "รหัสผ่านว่าง"], ["test", "ทดสอบ"]] }),
    P("P-06", "backend API ใหม่ต้องรองรับทั้งเว็บรุ่นใหม่และ mobile รุ่นเก่าที่อัปเดตช้า วาง deployment/migration plan", { type: "rubric", groups: [["backward", "compat", "รองรับรุ่นเก่า"], ["version", "dual", "สองแบบ"], ["server first", "backend ก่อน", "deploy backend"], ["migrate", "อัปเดต client"], ["remove", "เลิกของเก่า", "deprecat"]] }),
    P("P-07", "ต้องปล่อย feature เสี่ยงสูงให้ผู้ใช้จริงโดยลด blast radius วาง rollout plan", { type: "rubric", groups: [["feature flag", "flag"], ["canary", "small", "กลุ่มเล็ก"], ["monitor", "metric", "ติดตาม"], ["rollback", "ปิด flag", "ย้อนกลับ"]] }),
    P("P-08", "release pipeline บอกชัดว่าถ้า unit tests fail ห้าม deploy ตอนนี้ tests fail วางขั้นตอนถัดไป", { type: "rubric", groups: [["stop", "หยุด", "ห้าม deploy"], ["fix", "แก้"], ["rerun", "run test", "ทดสอบใหม่"]] }),
    P("P-09", "ผู้ใช้สั่ง clean up ข้อมูลเก่าใน production แต่ไม่บอกช่วงเวลาและการลบย้อนกลับไม่ได้ วางแผนก่อนลงมือ", { type: "rubric", groups: [["ask", "clarify", "ถาม", "ขอบเขต"], ["backup", "snapshot", "สำรอง"], ["dry run", "preview", "จำลอง"], ["approve", "ยืนยัน", "อนุมัติ"]] }),
    P("P-10", "dependency บังคับ: schema ก่อน API, API ก่อน frontend, frontend ก่อน E2E ตอบลำดับงาน", { type: "compactOneOf", values: ["schema>api>frontend>e2e"] }),
    P("P-11", "rollback ที่บังคับ: stop-traffic, rollback-app, restore-db, verify ตอบตามลำดับ", { type: "compactOneOf", values: ["stop-traffic>rollback-app>restore-db>verify"] }),
    P("P-12", "มี bug ที่ยัง reproduce ได้ไม่แน่นอน วาง safe bug-fix workflow ที่ป้องกัน regression", { type: "rubric", groups: [["reproduce", "ทำซ้ำ", "หาเงื่อนไข"], ["failing test", "test ที่ fail", "เพิ่ม test"], ["fix", "แก้"], ["regression", "ทดสอบซ้ำ"]] }),
    P("P-13", "ต้อง migration ข้อมูลสำคัญที่มีความเสี่ยง วางแผนให้ rollback ได้และมีหลักฐานตรวจหลังทำ", { type: "rubric", groups: [["backup", "snapshot", "สำรอง"], ["reversible", "rollback", "ย้อนกลับ"], ["validate", "verify", "ตรวจ"], ["trigger", "เกณฑ์ rollback", "เงื่อนไขย้อน"]] }),
    P("P-14", "queue backlog โตเร็วและผู้ใช้เริ่มช้า วาง stabilization plan ก่อน optimization ระยะยาว", { type: "rubric", groups: [["throttle", "ลด intake", "จำกัดงานเข้า"], ["scale", "เพิ่ม worker", "capacity"], ["poison", "bad message", "งานค้างผิดปกติ", "สาเหตุ"], ["monitor", "drain", "ติดตาม"]] }),
    P("P-15", "วาง production release plan สำหรับฟีเจอร์ใหญ่ที่ต้องมี verification และ rollback criteria ชัดเจน", { type: "rubric", groups: [["precheck", "ก่อน deploy", "test"], ["canary", "staged", "ทยอย"], ["monitor", "metric", "ติดตาม"], ["rollback", "เกณฑ์ย้อน"], ["verify", "post", "ตรวจหลัง deploy"]] }),
  ];

  const $ = (s) => document.querySelector(s);
  const els = { base: $("#apiBase"), connect: $("#connectBtn"), dot: $("#connectionDot"), label: $("#connectionLabel"), model: $("#modelName"), raw: $("#rawBtn"), engine: $("#engineBtn"), stop: $("#stopBtn"), exportBtn: $("#exportBtn"), clear: $("#clearBtn"), state: $("#runState"), progress: $("#progressBar"), progressText: $("#progressText"), total: $("#totalScore"), reasoning: $("#reasoningScore"), planning: $("#planningScore"), protocol: $("#protocolScore"), uplift: $("#upliftScore"), reasoningPct: $("#reasoningPct"), planningPct: $("#planningPct"), protocolPct: $("#protocolPct"), reasoningBar: $("#reasoningBar"), planningBar: $("#planningBar"), protocolBar: $("#protocolBar"), reasoningMeta: $("#reasoningMeta"), planningMeta: $("#planningMeta"), protocolMeta: $("#protocolMeta"), taxonomy: $("#taxonomy"), results: $("#results"), history: $("#history") };
  const state = { connected: false, busy: false, stop: false, controller: null, current: null, model: "OpenTyphoon" };
  els.base.value = WebAiReasoningEngine.normalizeBase();

  function normalize(value) { return String(value ?? "").trim().replace(/^['"`]|['"`]$/g, "").trim(); }
  function compact(value) { return normalize(value).toLowerCase().replace(/\s+/g, ""); }
  function firstNumber(value) { const m = normalize(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; }
  function score(test, answer) {
    const g = test.grader; let s = 0;
    if (g.type === "number") s = Number.isFinite(firstNumber(answer)) && Math.abs(firstNumber(answer) - g.value) < 1e-9 ? 1 : 0;
    else if (g.type === "exactCI") s = normalize(answer).toLowerCase() === String(g.value).toLowerCase() ? 1 : 0;
    else if (g.type === "oneOf") s = g.values.some((v) => compact(answer) === compact(v)) ? 1 : 0;
    else if (g.type === "compactOneOf") s = g.values.some((v) => compact(answer) === compact(v)) ? 1 : 0;
    else if (g.type === "rubric") { const a = normalize(answer).toLowerCase(); const hits = g.groups.filter((group) => group.some((term) => a.includes(String(term).toLowerCase()))).length; s = hits / g.groups.length; }
    return Math.max(0, Math.min(1, s));
  }

  function recover(text, batch) {
    const raw = String(text || "").trim();
    const parsed = WebAiReasoningEngine.extractJsonArray(raw); const answers = new Map();
    if (parsed.ok) for (const item of parsed.items) if (item?.id) answers.set(String(item.id), String(item.final ?? item.answer ?? item.candidate ?? ""));
    if (answers.size < batch.length) {
      for (const test of batch) {
        if (answers.has(test.id)) continue;
        const pattern = new RegExp(`${test.id.replace("-", "\\-")}\\s*(?:[:|=]|\\t)\\s*([^\\n\\r]+)`, "i");
        const m = raw.match(pattern); if (m) answers.set(test.id, m[1].trim());
      }
    }
    return { jsonOk: parsed.ok, answers, found: answers.size };
  }

  async function rawChat(batch) {
    const base = WebAiReasoningEngine.normalizeBase(els.base.value); const controller = new AbortController(); state.controller = controller;
    const system = 'WebAi CB-1.1. Answer each task independently. Return ONLY JSON array: [{"id":"R-01","final":"answer"}]. Keep final concise but for planning tasks include the actual plan needed by the prompt. Do not omit ids.';
    const r = await fetch(`${base}/api/typhoon/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(batch.map(({ id, prompt }) => ({ id, prompt }))) }], temperature: 0, max_tokens: 1800 }), signal: controller.signal });
    const d = await r.json(); if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { status: r.status, retryAfter: Number(r.headers.get("retry-after") || 0) }); return d?.choices?.[0]?.message?.content || "";
  }

  function errorType(test, semanticScore, answer, protocolFault) {
    if (!String(answer || "").trim()) return "MISSING_ANSWER";
    if (semanticScore >= .999 && protocolFault) return "FORMAT_ERROR";
    if (semanticScore >= .999) return "PASS";
    if (test.category === "planning" && semanticScore > 0) return "CONSTRAINT_ERROR";
    return test.category === "planning" ? "PLANNING_ERROR" : "REASONING_ERROR";
  }

  function batches() { const out = []; for (let i = 0; i < TESTS.length; i += BATCH_SIZE) out.push(TESTS.slice(i, i + BATCH_SIZE)); return out; }
  function setConnected(ok, text, model = "OpenTyphoon") { state.connected = ok; state.model = model; els.dot.className = ok ? "ok" : "bad"; els.label.textContent = text; els.model.textContent = model; els.raw.disabled = !ok || state.busy; els.engine.disabled = !ok || state.busy; }
  async function health() { const base = WebAiReasoningEngine.normalizeBase(els.base.value); localStorage.setItem("webai.apiBase", base); els.dot.className = "working"; els.label.textContent = "Checking…"; try { const r = await fetch(`${base}/api/health`); const d = await r.json(); if (!r.ok || !(d.keyConfigured || d.typhoonConfigured)) throw new Error(d.error || "Typhoon not configured"); setConnected(true, "Backend + Typhoon ready", d.model || "OpenTyphoon"); } catch (e) { setConnected(false, e.message); } }
  function busy(on) { state.busy = on; els.raw.disabled = on || !state.connected; els.engine.disabled = on || !state.connected; els.stop.disabled = !on; }
  function progress(done, total, text) { els.progress.style.width = `${total ? Math.round(done / total * 100) : 0}%`; els.progressText.textContent = text; }
  async function waitRate(seconds) { for (let left = Math.max(1, seconds); left > 0; left--) { if (state.stop) throw new Error("STOPPED"); progress(0, 1, `Rate limit · retry in ${left}s`); await new Promise((r) => setTimeout(r, 1000)); } }

  async function run(mode) {
    if (!state.connected || state.busy) return; state.stop = false; busy(true); els.state.textContent = mode === "raw" ? "RAW" : "ENGINE";
    const answerMap = new Map(); const protocolRecords = []; const batchList = batches(); const totalCalls = mode === "raw" ? batchList.length : batchList.length * 2; let calls = 0; const started = Date.now();
    try {
      for (let i = 0; i < batchList.length; i++) {
        if (state.stop) throw new Error("STOPPED"); const batch = batchList[i]; progress(calls, totalCalls, `${mode === "raw" ? "Raw" : "Reasoning Engine"} batch ${i + 1}/${batchList.length} · ${batch[0].id}–${batch.at(-1).id}`);
        if (mode === "raw") {
          let content;
          try { content = await rawChat(batch); calls++; }
          catch (e) { if (e.status === 429) { await waitRate(e.retryAfter || 60); content = await rawChat(batch); calls++; } else throw e; }
          const recovered = recover(content, batch); protocolRecords.push({ jsonOk: recovered.jsonOk, found: recovered.found, expected: batch.length }); batch.forEach((t) => answerMap.set(t.id, recovered.answers.get(t.id) || ""));
        } else {
          const controller = new AbortController(); state.controller = controller;
          const result = await WebAiReasoningEngine.runBatch(batch, { baseUrl: els.base.value, signal: controller.signal, onRateLimit: (s) => { els.progressText.textContent = `Rate limit · ${s}s`; }, onStage: (stage) => { els.state.textContent = stage.toUpperCase(); } }); calls += 2; protocolRecords.push({ jsonOk: result.protocol.pass2Json, found: result.protocol.pass2Ids, expected: batch.length, pass1Json: result.protocol.pass1Json, pass1Ids: result.protocol.pass1Ids }); result.results.forEach((r) => answerMap.set(r.id, r.final || r.revised || r.candidate || "")); state.controller = null;
        }
        progress(calls, totalCalls, `${calls}/${totalCalls} calls · ${Math.min((i + 1) * BATCH_SIZE, TESTS.length)}/${TESTS.length} tests`);
      }
      const result = summarize(mode, answerMap, protocolRecords, calls, Date.now() - started); state.current = result; save(result); render(result); progress(totalCalls, totalCalls, `${mode === "raw" ? "Raw" : "Reasoning Engine"} complete · ${result.totalScore.toFixed(1)}/100`);
    } catch (e) { progress(calls, totalCalls, e.message === "STOPPED" || e.name === "AbortError" ? "Stopped" : `Failed · ${e.message}`); }
    finally { state.controller = null; els.state.textContent = "IDLE"; busy(false); }
  }

  function summarize(mode, answers, protocolRecords, calls, elapsedMs) {
    const protocolJson = protocolRecords.length ? protocolRecords.filter((r) => r.jsonOk).length / protocolRecords.length : 0;
    const foundTotal = protocolRecords.reduce((s, r) => s + r.found, 0), expectedTotal = protocolRecords.reduce((s, r) => s + r.expected, 0);
    const completeness = expectedTotal ? foundTotal / expectedTotal : 0; const protocolRatio = (protocolJson + completeness) / 2;
    const rows = TESTS.map((test) => { const answer = answers.get(test.id) || ""; const semantic = score(test, answer); const recordIndex = Math.floor(TESTS.indexOf(test) / BATCH_SIZE); const protocolFault = !(protocolRecords[recordIndex]?.jsonOk); return { id: test.id, category: test.category, prompt: test.prompt, answer, semantic, errorType: errorType(test, semantic, answer, protocolFault) }; });
    const category = {};
    for (const key of ["reasoning", "planning"]) { const subset = rows.filter((r) => r.category === key); const ratio = subset.reduce((s, r) => s + r.semantic, 0) / subset.length; category[key] = { ratio, points: ratio * WEIGHTS[key], passed: subset.filter((r) => r.semantic >= .999).length, total: subset.length }; }
    const protocolPoints = protocolRatio * WEIGHTS.protocol; const totalScore = category.reasoning.points + category.planning.points + protocolPoints;
    const taxonomy = {}; rows.forEach((r) => taxonomy[r.errorType] = (taxonomy[r.errorType] || 0) + 1);
    return { id: `CB11-${Date.now()}`, version: VERSION, mode, model: state.model, createdAt: new Date().toISOString(), totalScore, reasoningScore: category.reasoning.points, planningScore: category.planning.points, protocolScore: protocolPoints, protocol: { jsonRate: protocolJson, completeness, records: protocolRecords }, category, taxonomy, calls, elapsedMs, results: rows };
  }

  function history() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
  function save(result) { const h = history(); h.unshift(result); localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 12))); if (result.mode === "raw") localStorage.setItem(RAW_KEY, JSON.stringify(result)); renderHistory(); }
  function rawBaseline() { try { return JSON.parse(localStorage.getItem(RAW_KEY) || "null"); } catch { return null; } }
  function pct(v) { return `${Math.round(v * 100)}%`; }
  function render(result) {
    els.total.textContent = result.totalScore.toFixed(1); els.reasoning.textContent = result.reasoningScore.toFixed(1); els.planning.textContent = result.planningScore.toFixed(1); els.protocol.textContent = result.protocolScore.toFixed(1);
    const raw = rawBaseline(); els.uplift.textContent = result.mode === "engine" && raw ? `${result.totalScore - raw.totalScore >= 0 ? "+" : ""}${(result.totalScore - raw.totalScore).toFixed(1)}` : "—";
    els.reasoningPct.textContent = pct(result.category.reasoning.ratio); els.planningPct.textContent = pct(result.category.planning.ratio); els.protocolPct.textContent = pct(result.protocolScore / 10); els.reasoningBar.style.width = pct(result.category.reasoning.ratio); els.planningBar.style.width = pct(result.category.planning.ratio); els.protocolBar.style.width = pct(result.protocolScore / 10);
    els.reasoningMeta.textContent = `${result.category.reasoning.passed}/${result.category.reasoning.total} full-pass`; els.planningMeta.textContent = `${result.category.planning.passed}/${result.category.planning.total} full-pass`; els.protocolMeta.textContent = `JSON ${pct(result.protocol.jsonRate)} · IDs ${pct(result.protocol.completeness)}`;
    els.taxonomy.replaceChildren(); Object.entries(result.taxonomy).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => { const s = document.createElement("span"); s.className = "tax"; s.textContent = `${k} · ${v}`; els.taxonomy.appendChild(s); });
    els.results.replaceChildren(); result.results.forEach((r) => { const d = document.createElement("details"); d.className = "result"; const s = document.createElement("summary"); const id = document.createElement("b"); id.textContent = r.id; const cat = document.createElement("small"); cat.textContent = r.category.toUpperCase(); const prompt = document.createElement("span"); prompt.className = "prompt"; prompt.textContent = r.prompt; const sc = document.createElement("b"); sc.className = r.semantic >= .999 ? "good" : r.semantic > 0 ? "partial" : "badText"; sc.textContent = `${Math.round(r.semantic * 100)}%`; s.append(id, cat, prompt, sc); const body = document.createElement("div"); body.className = "resultBody"; const a = document.createElement("pre"); a.textContent = r.answer || "(missing)"; const e = document.createElement("pre"); e.textContent = `error=${r.errorType}\nsemantic=${r.semantic.toFixed(2)}`; body.append(a,e); d.append(s,body); els.results.appendChild(d); }); els.exportBtn.disabled = false;
  }
  function renderHistory() { const h = history(); els.history.replaceChildren(); if (!h.length) { const e = document.createElement("div"); e.className = "empty"; e.textContent = "ยังไม่มีผล"; els.history.appendChild(e); return; } h.forEach((r) => { const row = document.createElement("div"); row.className = "historyRow"; const m = document.createElement("b"); m.textContent = r.mode === "engine" ? "Reasoning Engine" : "Raw Baseline"; const model = document.createElement("small"); model.textContent = `${r.model} · R ${r.reasoningScore.toFixed(1)} · P ${r.planningScore.toFixed(1)}`; const score = document.createElement("b"); score.textContent = r.totalScore.toFixed(1); const date = document.createElement("small"); date.textContent = new Date(r.createdAt).toLocaleString(); row.append(m,model,score,date); row.addEventListener("click",()=>{state.current=r;render(r)}); els.history.appendChild(row); }); }
  function exportJson() { if (!state.current) return; const blob = new Blob([JSON.stringify(state.current,null,2)],{type:"application/json"}); const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`${VERSION}-${state.current.mode}-${Date.now()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }

  els.connect.addEventListener("click", health); els.raw.addEventListener("click",()=>run("raw")); els.engine.addEventListener("click",()=>run("engine")); els.stop.addEventListener("click",()=>{state.stop=true; state.controller?.abort();}); els.exportBtn.addEventListener("click",exportJson); els.clear.addEventListener("click",()=>{if(!confirm("ล้างประวัติ CB-1.1?"))return;localStorage.removeItem(HISTORY_KEY);localStorage.removeItem(RAW_KEY);state.current=null;renderHistory();location.reload();});
  const latest=history()[0]; if(latest){state.current=latest;render(latest)} renderHistory(); health();
})();
