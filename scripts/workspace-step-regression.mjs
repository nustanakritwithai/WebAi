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
      return request(records.get(recordKey) ? structuredClone(records.get(recordKey)) : undefined);
    },
    delete(path) { records.delete(path); },
    getAll() { return request([...records.values()].map((value) => structuredClone(value))); }
  };
}

const database = {
  objectStoreNames: { contains: (name) => stores.has(name) },
  createObjectStore(name) { return makeStore(name); },
  transaction(names) {
    const list = Array.isArray(names) ? names : [names];
    const tx = { objectStore: (name) => makeStore(name) };
    void list;
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

const taskId = "BROWSER-24681357";
const taskFolder = "tasks/BROWSER-24681357";

const missing = await workspace.readTaskFilesOptional(taskId, ["index.html", "style.css"]);
assert.equal(missing[`${taskFolder}/index.html`], null);
assert.equal(missing[`${taskFolder}/style.css`], null);
await assert.rejects(
  () => workspace.readTaskFiles(taskId, ["index.html"]),
  /Workspace file not found/
);

await workspace.writeTaskFiles(taskId, [{
  name: "index.html",
  content: "<main>first</main>",
  expectedRevision: 0,
  expectedHash: null
}]);
const first = (await workspace.readTaskFiles(taskId, ["index.html"]))[`${taskFolder}/index.html`];
assert.equal(first.version, 1);
assert.match(first.hash, /^[a-f0-9]{64}$/);
assert.equal((await workspace.readTaskFilesOptional(taskId, ["index.html", "app.js"]))[`${taskFolder}/app.js`], null);

await assert.rejects(
  () => workspace.writeTaskFiles(taskId, [{ name: "index.html", content: "stale", expectedRevision: 0, expectedHash: first.hash }]),
  (error) => error?.code === "STALE_WORKSPACE_WRITE" && error?.path === `${taskFolder}/index.html`
);
await assert.rejects(
  () => workspace.writeTaskFiles(taskId, [{ name: "index.html", content: "bad revision", expectedRevision: -1 }]),
  /Invalid expected revision/
);
await assert.rejects(
  () => workspace.writeTaskFiles(taskId, [{ name: "index.html", content: "bad hash", expectedHash: "not-a-sha256" }]),
  /Invalid expected hash/
);

await workspace.writeTaskFiles(taskId, [{
  name: "index.html",
  content: "<main>second</main>",
  expectedRevision: first.version,
  expectedHash: first.hash
}]);
assert.equal((await workspace.readTaskFiles(taskId, ["index.html"]))[`${taskFolder}/index.html`].content, "<main>second</main>");

await assert.rejects(
  () => workspace.readTaskFilesOptional(taskId, ["../outside.txt"]),
  /Traversal segments are not allowed/
);
await assert.rejects(
  () => workspace.writeTaskFiles(taskId, [{ name: "tasks/BROWSER-99999999/escape.txt", content: "escape" }]),
  /Task file names must be relative/
);

await workspace.writeTaskFiles("BROWSER-13572468", [{ name: "index.html", content: "other task" }]);
const isolated = await workspace.readTaskFilesOptional(taskId, ["index.html", "style.css"]);
assert.equal(isolated[`${taskFolder}/index.html`].content, "<main>second</main>");
assert.equal(isolated[`${taskFolder}/style.css`], null);

console.log("PASS workspace optional missing reads, task isolation, path guard, and revision/hash validation");
