import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = await readFile(new URL("../workspace.js", import.meta.url), "utf8");
const itemRecords = new Map();
const revisionRecords = new Map();
const stores = new Set();

function request(value, delay = 0) {
  const result = {};
  setTimeout(() => {
    result.result = value;
    result.onsuccess?.();
  }, delay);
  return result;
}

function makeStore(name) {
  stores.add(name);
  const records = name === "revisions" ? revisionRecords : itemRecords;
  return {
    indexNames: { contains: () => false },
    createIndex() {},
    add(value) {
      if (records.has(value.path)) throw new Error("ConstraintError");
      records.set(value.path, structuredClone(value));
    },
    put(value) {
      const key = name === "revisions" ? `${value.path}\u0000${value.version}` : value.path;
      records.set(key, structuredClone(value));
    },
    get(key) {
      const recordKey = name === "revisions" && Array.isArray(key) ? `${key[0]}\u0000${key[1]}` : key;
      return request(records.get(recordKey) ? structuredClone(records.get(recordKey)) : undefined, 0);
    },
    delete(path) {
      records.delete(path);
    },
    getAll() {
      return request([...records.values()].map((value) => structuredClone(value)), 0);
    }
  };
}

const database = {
  objectStoreNames: { contains: (name) => stores.has(name) },
  createObjectStore(name) {
    return makeStore(name);
  },
  transaction(names) {
    const list = Array.isArray(names) ? names : [names];
    const tx = { objectStore: (name) => makeStore(name) };
    setTimeout(() => tx.oncomplete?.(), 0);
    return tx;
  }
};

const indexedDB = {
  open() {
    const result = {};
    setTimeout(() => {
      result.result = database;
      result.onupgradeneeded?.();
      result.onsuccess?.();
    }, 0);
    return result;
  }
};

function element() {
  return {
    disabled: false,
    hidden: false,
    value: "",
    textContent: "",
    className: "",
    classList: { add() {}, remove() {}, contains: () => false },
    dataset: {},
    innerHTML: "",
    style: { setProperty() {} },
    querySelector: () => element(),
    addEventListener() {},
    focus() {},
    replaceChildren() {},
    setAttribute() {},
    appendChild() {}
  };
}

const root = element();
root.querySelector = () => element();
const context = {
  window: {
    indexedDB,
    crypto: webcrypto,
    TextEncoder,
    prompt: () => null,
    confirm: () => false,
    dispatchEvent() {}
  },
  document: { querySelector: () => root, createDocumentFragment: () => element(), createElement: () => element(), addEventListener() {} },
  indexedDB,
  crypto: webcrypto,
  TextEncoder,
  CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
  console,
  setTimeout,
  clearTimeout
};
vm.runInNewContext(source, context, { filename: "workspace.js" });
const workspace = context.window.WebAiBrowserWorkspace;
await workspace.ready;

const taskId = "BROWSER-12345678";
await workspace.writeTaskFiles(taskId, [
  { name: "PLAN.md", content: "authoritative plan" },
  { name: "src/app.js", content: "export default 1;" }
]);
const taskContext = await workspace.readTaskContext(taskId);
assert.equal(taskContext.folder, "tasks/BROWSER-12345678");
assert.deepEqual(structuredClone(taskContext.files.map(({ path, content, version }) => ({ path, content, version }))), [
  { path: "PLAN.md", content: "authoritative plan", version: 1 },
  { path: "src/app.js", content: "export default 1;", version: 1 }
]);

await workspace.writeTaskFiles("BROWSER-87654321", [{ name: "PLAN.md", content: "other job" }]);
const originalTaskPlan = await workspace.readTaskFiles(taskId, ["PLAN.md"]);
const otherTaskPlan = await workspace.readTaskFiles("BROWSER-87654321", ["PLAN.md"]);
assert.equal(originalTaskPlan["tasks/BROWSER-12345678/PLAN.md"].content, "authoritative plan");
assert.equal(otherTaskPlan["tasks/BROWSER-87654321/PLAN.md"].content, "other job");

const guardedPath = "tasks/BROWSER-12345678/PLAN.md";
const guarded = originalTaskPlan[guardedPath];
await workspace.writeTaskFiles(taskId, [{ name: "PLAN.md", content: "newer plan", expectedRevision: guarded.version, expectedHash: guarded.hash }]);
await assert.rejects(
  () => workspace.writeTaskFiles(taskId, [{ name: "PLAN.md", content: "stale plan", expectedRevision: guarded.version, expectedHash: guarded.hash }]),
  (error) => error?.code === "STALE_WORKSPACE_WRITE" && error?.path === guardedPath
);
assert.equal((await workspace.readTaskFiles(taskId, ["PLAN.md"]))[guardedPath].content, "newer plan");

const current = (await workspace.readTaskFiles(taskId, ["PLAN.md"]))[guardedPath];
const rolled = await workspace.rollbackFiles([{ path: guardedPath, version: guarded.version, expectedRevision: current.version, expectedHash: current.hash }]);
assert.equal(rolled[0].version, current.version + 1);
assert.equal((await workspace.readTaskFiles(taskId, ["PLAN.md"]))[guardedPath].content, "authoritative plan");
await assert.rejects(
  () => workspace.rollbackFiles([{ path: guardedPath, version: 1, expectedRevision: current.version, expectedHash: current.hash }]),
  (error) => error?.code === "STALE_WORKSPACE_WRITE"
);

const tooMuch = "x".repeat(workspace.maxTaskContextBytes);
await workspace.writeTaskFiles(taskId, [{ name: "large.txt", content: tooMuch.slice(0, workspace.maxFileBytes) }]);
const bounded = await workspace.readTaskContext(taskId);
assert.ok(bounded.files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).byteLength, 0) <= workspace.maxTaskContextBytes);
assert.equal(bounded.files.find((file) => file.path === "PLAN.md")?.content, "authoritative plan");
console.log("pass · task-scoped context, expected revision/hash guards, stale-write rejection, and rollback safety");
