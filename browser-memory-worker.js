import {
  MAX_CACHE_ITEMS,
  boundedText,
  buildRelatedContext,
  defaultSnapshot,
  exactCacheKey,
  isFreshRequest,
  recoverSnapshot,
  sanitizeSnapshot,
  sanitizeTask,
  tokenize
} from "./browser-memory-core.js";
import { buildBoundedModelMessages, selectEccPolicy } from "./ecc-policy-core.js";

const DB_NAME = "webai-browser-memory";
const DB_VERSION = 1;
let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("checkpoints")) db.createObjectStore("checkpoints", { keyPath: "id" });
      if (!db.objectStoreNames.contains("journal")) db.createObjectStore("journal", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("responseCache")) db.createObjectStore("responseCache", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("เปิด Browser memory ไม่สำเร็จ"));
  });
  return dbPromise;
}

function transaction(storeNames, mode, work) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("บันทึก Browser memory ไม่สำเร็จ"));
    tx.onabort = () => reject(tx.error || new Error("ยกเลิก Browser memory transaction"));
    try { result = work(tx); } catch (error) { tx.abort(); reject(error); }
  }));
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("อ่าน Browser memory ไม่สำเร็จ"));
  });
}

async function currentSnapshot() {
  const requests = await transaction(["checkpoints"], "readonly", (tx) => [
    requestValue(tx.objectStore("checkpoints").get("current")),
    requestValue(tx.objectStore("checkpoints").get("previous"))
  ]);
  const [primary, previous] = await Promise.all(requests);
  return recoverSnapshot(primary?.snapshot, previous?.snapshot);
}

async function writeSnapshot(snapshot, event) {
  const safe = sanitizeSnapshot(snapshot) || defaultSnapshot();
  await transaction(["checkpoints", "journal"], "readwrite", (tx) => {
    const checkpoints = tx.objectStore("checkpoints");
    checkpoints.get("current").onsuccess = (result) => {
      const current = result.target.result;
      if (current?.snapshot) checkpoints.put({ id: "previous", snapshot: current.snapshot, savedAt: new Date().toISOString() });
      checkpoints.put({ id: "current", snapshot: safe, savedAt: new Date().toISOString() });
    };
    const ecc = event?.ecc && typeof event.ecc === "object" ? {
      version: boundedText(event.ecc.version || "", 80),
      ids: Array.isArray(event.ecc.ids) ? event.ecc.ids.slice(0, 4).map((id) => boundedText(id, 80)) : [],
      taskClass: boundedText(event.ecc.taskClass || "", 80),
      risk: boundedText(event.ecc.risk || "", 40),
      signals: Array.isArray(event.ecc.signals) ? event.ecc.signals.slice(0, 3).map((signal) => boundedText(signal, 80)) : []
    } : null;
    tx.objectStore("journal").add({ at: new Date().toISOString(), type: boundedText(event?.type || "update", 80), detail: boundedText(event?.detail || "", 500), ...(ecc ? { ecc } : {}) });
  });
  return safe;
}

async function trimCache() {
  const entries = await (await transaction(["responseCache"], "readonly", (tx) => requestValue(tx.objectStore("responseCache").getAll())));
  const stale = entries.sort((left, right) => (right.lastUsedAt || "").localeCompare(left.lastUsedAt || "")).slice(MAX_CACHE_ITEMS);
  if (!stale.length) return;
  await transaction(["responseCache"], "readwrite", (tx) => stale.forEach((entry) => tx.objectStore("responseCache").delete(entry.key)));
}

async function prepare({ prompt, mode, model }) {
  const safePrompt = boundedText(prompt, 8_000);
  const ecc = selectEccPolicy({ prompt: safePrompt, mode });
  const snapshot = await currentSnapshot();
  const key = exactCacheKey({ prompt: safePrompt, mode, model, memoryRevision: snapshot.memoryRevision, eccFingerprint: ecc.fingerprint });
  const requests = await transaction(["responseCache"], "readonly", (tx) => [
    requestValue(tx.objectStore("responseCache").get(key)),
    requestValue(tx.objectStore("responseCache").getAll())
  ]);
  const [exact, entries] = await Promise.all(requests);
  if (exact && !isFreshRequest(safePrompt)) {
    exact.lastUsedAt = new Date().toISOString();
    await transaction(["responseCache"], "readwrite", (tx) => tx.objectStore("responseCache").put(exact));
    return { prompt: safePrompt, exact: { answer: boundedText(exact.answer), key }, relatedContext: "", snapshot, ecc };
  }
  return { prompt: safePrompt, exact: null, relatedContext: buildRelatedContext(safePrompt, entries), snapshot, ecc };
}

function composeMessages({ system, ecc, relatedContext, history, prompt, mode }) {
  const safePrompt = boundedText(prompt, 8_000);
  const selectedEcc = ecc?.fingerprint ? ecc : selectEccPolicy({ prompt: safePrompt, mode });
  return { ecc: selectedEcc, ...buildBoundedModelMessages({
    system: boundedText(system, 4_000),
    ecc: selectedEcc,
    relatedContext: boundedText(relatedContext, 8_000),
    history: Array.isArray(history) ? history.map((message) => ({ role: message?.role, content: boundedText(message?.content, 8_000) })) : [],
    prompt: safePrompt
  }) };
}

async function recordExchange({ user, answer, mode, model, task, ecc }) {
  const snapshot = await currentSnapshot();
  const safeUser = boundedText(user, 8_000);
  const safeAnswer = boundedText(answer, 8_000);
  const selectedEcc = ecc?.fingerprint ? ecc : selectEccPolicy({ prompt: safeUser, mode });
  const next = {
    ...snapshot,
    memoryRevision: snapshot.memoryRevision + 1,
    updatedAt: new Date().toISOString(),
    messages: [...snapshot.messages, { role: "user", content: safeUser }, { role: "assistant", content: safeAnswer }].slice(-48),
    task: sanitizeTask(task || snapshot.task)
  };
  const saved = await writeSnapshot(next, { type: "exchange", detail: safeUser, ecc: selectedEcc });
  if (!isFreshRequest(safeUser)) {
    const entry = {
      key: exactCacheKey({ prompt: safeUser, mode, model, memoryRevision: saved.memoryRevision, eccFingerprint: selectedEcc.fingerprint }),
      prompt: safeUser,
      answer: safeAnswer,
      mode: boundedText(mode || "ask", 40),
      model: boundedText(model || "OpenTyphoon", 120),
      memoryRevision: saved.memoryRevision,
      ecc: { version: selectedEcc.version, ids: selectedEcc.ids },
      tokens: tokenize(safeUser),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    await transaction(["responseCache"], "readwrite", (tx) => tx.objectStore("responseCache").put(entry));
    await trimCache();
  }
  return { snapshot: saved, answer: safeAnswer };
}

async function saveTask({ task }) {
  const snapshot = await currentSnapshot();
  const next = { ...snapshot, task: sanitizeTask(task), updatedAt: new Date().toISOString() };
  return { snapshot: await writeSnapshot(next, { type: "task", detail: next.task?.status || "" }) };
}

async function dispatch(type, payload) {
  if (type === "init") return { snapshot: await currentSnapshot() };
  if (type === "sanitize") return { text: boundedText(payload?.text, payload?.limit || 8_000) };
  if (type === "prepare") return prepare(payload || {});
  if (type === "selectEcc") return { ecc: selectEccPolicy(payload || {}) };
  if (type === "composeMessages") return composeMessages(payload || {});
  if (type === "recordExchange") return recordExchange(payload || {});
  if (type === "saveTask") return saveTask(payload || {});
  throw new Error("คำสั่ง Browser memory ไม่รองรับ");
}

self.onmessage = async ({ data }) => {
  try { self.postMessage({ id: data?.id, ok: true, result: await dispatch(data?.type, data?.payload) }); }
  catch (error) { self.postMessage({ id: data?.id, ok: false, error: error?.message || "Browser memory ล้มเหลว" }); }
};
