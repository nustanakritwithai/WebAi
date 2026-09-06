(() => {
  "use strict";

  const DB_NAME = "webai-browser-workspace";
  const DB_VERSION = 2;
  const STORE_NAME = "items";
  const REVISION_STORE_NAME = "revisions";
  const MAX_FILE_BYTES = 100_000;
  const MAX_FILES_PER_WRITE = 12;
  const root = document.querySelector("#fileWorkspace");
  if (!root) return;

  const els = {
    status: root.querySelector("#workspaceStatus"),
    currentFolder: root.querySelector("#workspaceCurrentFolder"),
    tree: root.querySelector("#workspaceTree"),
    treeEmpty: root.querySelector("#workspaceTreeEmpty"),
    newFolder: root.querySelector("#newWorkspaceFolder"),
    newFile: root.querySelector("#newWorkspaceFile"),
    path: root.querySelector("#workspaceEditorPath"),
    editorEmpty: root.querySelector("#workspaceEditorEmpty"),
    editor: root.querySelector("#workspaceEditor"),
    input: root.querySelector("#workspaceEditorInput"),
    meta: root.querySelector("#workspaceEditorMeta"),
    save: root.querySelector("#saveWorkspaceFile"),
    delete: root.querySelector("#deleteWorkspaceItem")
  };

  let db;
  let items = [];
  let selectedPath = null;
  let selectedFolder = "";
  let activeTaskFolder = "";
  const listeners = new Set();

  class WorkspacePathError extends Error {
    constructor(message) {
      super(message);
      this.name = "WorkspacePathError";
    }
  }

  function setStatus(message, kind = "") {
    els.status.textContent = message;
    els.status.className = kind ? `workspaceStatus ${kind}` : "";
  }

  function normalizePath(value, allowRoot = false) {
    if (typeof value !== "string") throw new WorkspacePathError("Path must be text.");
    const raw = value.trim();
    if (!raw) {
      if (allowRoot) return "";
      throw new WorkspacePathError("A name is required.");
    }
    if (raw.includes("\\") || raw.startsWith("/") || raw.endsWith("/")) {
      throw new WorkspacePathError("Use a relative path with forward-slash separators.");
    }
    const parts = raw.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw new WorkspacePathError("Traversal segments are not allowed.");
    }
    for (const part of parts) {
      if (part.length > 80 || part.startsWith(".")) throw new WorkspacePathError("Hidden or overly long names are not allowed.");
      if (/[\u0000-\u001f<>:\"|?*]/.test(part) || /[. ]$/.test(part)) throw new WorkspacePathError("That name contains invalid characters.");
    }
    const normalized = parts.join("/");
    if (normalized.length > 240) throw new WorkspacePathError("The path is too long.");
    return normalized;
  }

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function parentPath(path) {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
  }

  function baseName(path) {
    return path.slice(path.lastIndexOf("/") + 1);
  }

  function taskFolderForId(taskId) {
    const id = String(taskId || "").trim();
    if (!/^BROWSER-[0-9]{8}$/.test(id)) throw new WorkspacePathError("Invalid Browser Agent task id.");
    return normalizePath(`tasks/${id}`);
  }

  function setCurrentFolderLabel() {
    if (els.currentFolder) els.currentFolder.textContent = `Current task folder: ${activeTaskFolder || "—"} · Persisted in this browser with IndexedDB`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: "path" });
        if (!store.indexNames.contains("parent")) store.createIndex("parent", "parent", { unique: false });
        if (!database.objectStoreNames.contains(REVISION_STORE_NAME)) {
          const revisions = database.createObjectStore(REVISION_STORE_NAME, { keyPath: ["path", "version"] });
          revisions.createIndex("path", "path", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the browser workspace."));
    });
  }

  function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, mode);
      const store = request.objectStore(STORE_NAME);
      let result;
      try { result = action(store); } catch (error) { reject(error); return; }
      request.oncomplete = () => resolve(result);
      request.onerror = () => reject(request.error || new Error("Workspace storage failed."));
      request.onabort = () => reject(request.error || new Error("Workspace storage was aborted."));
    });
  }

  function getAllItems() {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("Could not read the workspace."));
    });
  }

  function notify(change) {
    for (const listener of listeners) {
      try { listener(change); } catch { /* UI listeners must not break storage. */ }
    }
  }

  function itemAt(path) { return items.find((item) => item.path === path) || null; }

  function ensureParentFolder(path) {
    const parent = parentPath(path);
    if (parent && itemAt(parent)?.type !== "folder") throw new Error(`Folder not found: ${parent}`);
  }

  function childPath(rawName) {
    const name = normalizePath(rawName);
    return normalizePath(selectedFolder ? `${selectedFolder}/${name}` : name);
  }

  async function refresh() {
    items = (await getAllItems()).sort((a, b) => a.path.localeCompare(b.path));
    if (selectedPath && !itemAt(selectedPath)) selectedPath = null;
    if (selectedFolder && !itemAt(selectedFolder)) selectedFolder = "";
    renderTree();
    renderEditor();
    setCurrentFolderLabel();
  }

  function folderChildren(folder) {
    return items.filter((item) => parentPath(item.path) === folder).sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  function renderTree() {
    els.tree.replaceChildren();
    const fragment = document.createDocumentFragment();
    const renderFolder = (folder, depth, parent) => {
      folderChildren(folder).forEach((item) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "workspaceTreeItem";
        row.dataset.path = item.path;
        row.dataset.type = item.type;
        row.style.setProperty("--tree-depth", depth);
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-label", `${item.type}: ${item.path}`);
        if (item.path === selectedPath || item.path === selectedFolder) row.classList.add("selected");
        row.innerHTML = `<span class="workspaceTreeIcon" aria-hidden="true">${item.type === "folder" ? "▸" : "□"}</span><span class="workspaceTreeName"></span>`;
        row.querySelector(".workspaceTreeName").textContent = baseName(item.path);
        row.addEventListener("click", () => {
          if (item.type === "folder") {
            selectedFolder = item.path;
            selectedPath = null;
          } else {
            selectedPath = item.path;
            selectedFolder = parentPath(item.path);
          }
          renderTree();
          renderEditor();
        });
        parent.appendChild(row);
        if (item.type === "folder") renderFolder(item.path, depth + 1, parent);
      });
    };
    renderFolder("", 0, fragment);
    els.tree.appendChild(fragment);
    els.treeEmpty.hidden = items.length > 0;
  }

  function renderEditor() {
    const item = selectedPath ? itemAt(selectedPath) : null;
    const editable = item?.type === "file";
    els.editorEmpty.hidden = editable;
    els.editor.hidden = !editable;
    els.save.disabled = !editable;
    els.delete.disabled = !item;
    els.path.textContent = item?.path || (selectedFolder ? `${selectedFolder}/` : "No file selected");
    if (!editable) {
      els.input.value = "";
      els.meta.textContent = selectedFolder ? `Folder selected · ${selectedFolder}` : "Select a text file to edit";
      return;
    }
    els.input.value = item.content || "";
    els.meta.textContent = `Saved ${new Date(item.updatedAt).toLocaleString()}`;
  }

  async function createItem(type) {
    const label = type === "folder" ? "New folder name or relative path" : "New text file name or relative path";
    const raw = window.prompt(label, type === "folder" ? "notes" : "readme.txt");
    if (raw === null) return;
    let path;
    try { path = childPath(raw); ensureParentFolder(path); }
    catch (error) { setStatus(error.message, "error"); return; }
    if (itemAt(path)) { setStatus("That workspace path already exists.", "error"); return; }
    const now = Date.now();
    await transaction("readwrite", (store) => store.add({ path, parent: parentPath(path), name: baseName(path), type, content: type === "file" ? "" : null, version: 1, createdAt: now, updatedAt: now }));
    selectedFolder = type === "folder" ? path : parentPath(path);
    selectedPath = type === "file" ? path : null;
    await refresh();
    notify({ type: "created", paths: [path] });
    setStatus(`${type === "folder" ? "Folder" : "File"} created`, "success");
  }

  async function saveFile() {
    const item = selectedPath ? itemAt(selectedPath) : null;
    if (!item || item.type !== "file") return;
    const content = els.input.value;
    if (byteLength(content) > MAX_FILE_BYTES) throw new Error(`File is larger than ${MAX_FILE_BYTES.toLocaleString()} bytes.`);
    const version = (Number(item.version) || 0) + 1;
    await transaction("readwrite", (store) => store.put({ ...item, content, version, updatedAt: Date.now() }));
    await refresh();
    notify({ type: "saved", paths: [item.path], version });
    setStatus("File saved locally", "success");
  }

  async function deleteSelected() {
    const item = selectedPath ? itemAt(selectedPath) : itemAt(selectedFolder);
    if (!item) return;
    const descendants = items.filter((candidate) => candidate.path.startsWith(`${item.path}/`));
    const suffix = descendants.length ? ` This will also remove ${descendants.length} nested item${descendants.length === 1 ? "" : "s"}.` : "";
    if (!window.confirm(`Delete ${item.type} “${item.path}”?${suffix}`)) return;
    await transaction("readwrite", (store) => {
      store.delete(item.path);
      descendants.forEach((candidate) => store.delete(candidate.path));
    });
    selectedPath = null;
    selectedFolder = parentPath(item.path);
    await refresh();
    notify({ type: "deleted", paths: [item.path, ...descendants.map((candidate) => candidate.path)] });
    setStatus("Item deleted", "success");
  }

  function disableActions() {
    els.newFolder.disabled = true;
    els.newFile.disabled = true;
    els.save.disabled = true;
    els.delete.disabled = true;
  }

  async function ensureFolder(path) {
    const normalized = normalizePath(path);
    const parts = normalized.split("/");
    const missing = [];
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!itemAt(currentPath)) missing.push(currentPath);
      else if (itemAt(currentPath).type !== "folder") throw new Error(`Workspace path is not a folder: ${currentPath}`);
    }
    if (!missing.length) return normalized;
    const now = Date.now();
    await transaction("readwrite", (store) => missing.forEach((folder) => store.add({ path: folder, parent: parentPath(folder), name: baseName(folder), type: "folder", content: null, version: 1, createdAt: now, updatedAt: now })));
    await refresh();
    notify({ type: "folders_created", paths: missing.slice() });
    return normalized;
  }

  async function writeFiles(files, metadata = {}) {
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES_PER_WRITE) throw new Error("Invalid workspace file batch.");
    if (!db) await ready;
    const records = files.map((file) => {
      const path = normalizePath(file?.path);
      const content = typeof file?.content === "string" ? file.content : "";
      if (byteLength(content) > MAX_FILE_BYTES) throw new Error(`${path} is larger than ${MAX_FILE_BYTES.toLocaleString()} bytes.`);
      return { path, content };
    });
    const now = Date.now();
    const taskId = typeof metadata.taskId === "string" ? metadata.taskId.slice(0, 80) : "";
    const source = typeof metadata.source === "string" ? metadata.source.slice(0, 40) : "browser-agent";
    const taskFolder = taskId ? taskFolderForId(taskId) : "";
    if (taskFolder && records.some((record) => !record.path.startsWith(`${taskFolder}/`))) throw new WorkspacePathError("Task artifacts must stay inside their task folder.");
    const versions = records.map(({ path }) => (Number(itemAt(path)?.version) || 0) + 1);
    await new Promise((resolve, reject) => {
      const request = db.transaction([STORE_NAME, REVISION_STORE_NAME], "readwrite");
      const itemsStore = request.objectStore(STORE_NAME);
      const revisionsStore = request.objectStore(REVISION_STORE_NAME);
      records.forEach(({ path, content }, index) => {
        const current = itemAt(path);
        const version = versions[index];
        itemsStore.put({
          ...(current || {}), path, parent: parentPath(path), name: baseName(path), type: "file", content,
          version, source, taskId, createdAt: current?.createdAt || now, updatedAt: now
        });
        revisionsStore.put({ path, version, content, source, taskId, createdAt: now });
      });
      request.oncomplete = resolve;
      request.onerror = () => reject(request.error || new Error("Workspace storage failed."));
      request.onabort = () => reject(request.error || new Error("Workspace storage was aborted."));
    });
    await refresh();
    selectedFolder = "";
    selectedPath = records[0].path;
    renderTree();
    renderEditor();
    notify({ type: "applied", paths: records.map((record) => record.path), versions: versions.slice(), source, taskId });
    setStatus(`Applied ${records.length} file${records.length === 1 ? "" : "s"} · revisioned locally`, "success");
    return records.map(({ path }, index) => ({ path, version: versions[index] }));
  }

  async function readFiles(paths) {
    if (!Array.isArray(paths)) throw new Error("Workspace paths must be an array.");
    if (!db) await ready;
    const result = {};
    for (const rawPath of paths) {
      const path = normalizePath(rawPath);
      const item = itemAt(path);
      if (!item || item.type !== "file") throw new Error(`Workspace file not found: ${path}`);
      result[path] = { path, content: item.content || "", version: Number(item.version) || 1, updatedAt: item.updatedAt || null };
    }
    return result;
  }

  async function ensureTaskFolder(taskId) {
    const folder = taskFolderForId(taskId);
    await ensureFolder(folder);
    activeTaskFolder = folder;
    selectedFolder = folder;
    selectedPath = null;
    renderTree();
    renderEditor();
    setCurrentFolderLabel();
    return folder;
  }

  function taskFileName(value) {
    const name = normalizePath(value);
    if (name.startsWith("tasks/") || name === "tasks") throw new WorkspacePathError("Task file names must be relative to the task folder.");
    return name;
  }

  async function writeTaskFiles(taskId, files, metadata = {}) {
    const folder = await ensureTaskFolder(taskId);
    if (!Array.isArray(files) || files.length < 1) throw new Error("Invalid task file batch.");
    const taskFiles = files.map((file) => ({ path: `${folder}/${taskFileName(file?.name ?? file?.path)}`, content: typeof file?.content === "string" ? file.content : "" }));
    return writeFiles(taskFiles, { ...metadata, taskId, source: metadata.source || "browser-agent" });
  }

  async function readTaskFiles(taskId, names) {
    const folder = taskFolderForId(taskId);
    if (!Array.isArray(names)) throw new Error("Task file names must be an array.");
    return readFiles(names.map((name) => `${folder}/${taskFileName(name)}`));
  }

  async function listTaskFiles(taskId) {
    const folder = taskFolderForId(taskId);
    if (!db) await ready;
    return items.filter((item) => item.type === "file" && item.path.startsWith(`${folder}/`)).map((item) => ({
      path: item.path.slice(folder.length + 1), content: item.content || "", version: Number(item.version) || 1, updatedAt: item.updatedAt || null
    }));
  }

  function setActiveTask(taskId) {
    try {
      activeTaskFolder = taskFolderForId(taskId);
      selectedFolder = activeTaskFolder;
      selectedPath = null;
      renderTree();
      renderEditor();
      setCurrentFolderLabel();
      return activeTaskFolder;
    } catch {
      activeTaskFolder = "";
      selectedFolder = "";
      selectedPath = null;
      renderTree();
      renderEditor();
      setCurrentFolderLabel();
      return "";
    }
  }

  async function listFiles() {
    if (!db) await ready;
    return items.filter((item) => item.type === "file").map((item) => ({ path: item.path, content: item.content || "", version: Number(item.version) || 1, updatedAt: item.updatedAt || null }));
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  els.newFolder.addEventListener("click", () => createItem("folder").catch((error) => setStatus(error.message, "error")));
  els.newFile.addEventListener("click", () => createItem("file").catch((error) => setStatus(error.message, "error")));
  els.save.addEventListener("click", () => saveFile().catch((error) => setStatus(error.message, "error")));
  els.delete.addEventListener("click", () => deleteSelected().catch((error) => setStatus(error.message, "error")));
  els.input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveFile().catch((error) => setStatus(error.message, "error"));
    }
  });

  const ready = (async () => {
    try {
      db = await openDatabase();
      await refresh();
      els.newFolder.disabled = false;
      els.newFile.disabled = false;
      setStatus("Ready · browser-only storage", "success");
    } catch (error) {
      disableActions();
      setStatus(error.message, "error");
      els.treeEmpty.hidden = false;
      els.treeEmpty.querySelector("small").textContent = "Enable IndexedDB to use this local workspace.";
      throw error;
    }
  })();
  ready.catch(() => {});

  window.WebAiBrowserWorkspace = { ready, readFiles, writeFiles, listFiles, ensureTaskFolder, writeTaskFiles, readTaskFiles, listTaskFiles, taskFolderForId, setActiveTask, getActiveTaskFolder: () => activeTaskFolder, subscribe, maxFileBytes: MAX_FILE_BYTES };
  window.dispatchEvent(new CustomEvent("webai:workspace-ready"));
})();
