(() => {
  "use strict";

  const DB_NAME = "webai-browser-workspace";
  const DB_VERSION = 1;
  const STORE_NAME = "items";
  const root = document.querySelector("#fileWorkspace");
  if (!root) return;

  const els = {
    status: root.querySelector("#workspaceStatus"),
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

  function parentPath(path) {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
  }

  function baseName(path) {
    return path.slice(path.lastIndexOf("/") + 1);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: "path" });
        store.createIndex("parent", "parent", { unique: false });
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
    await transaction("readwrite", (store) => store.add({ path, parent: parentPath(path), name: baseName(path), type, content: type === "file" ? "" : null, createdAt: now, updatedAt: now }));
    selectedFolder = type === "folder" ? path : parentPath(path);
    selectedPath = type === "file" ? path : null;
    await refresh();
    setStatus(`${type === "folder" ? "Folder" : "File"} created`, "success");
  }

  async function saveFile() {
    const item = selectedPath ? itemAt(selectedPath) : null;
    if (!item || item.type !== "file") return;
    const content = els.input.value;
    await transaction("readwrite", (store) => store.put({ ...item, content, updatedAt: Date.now() }));
    await refresh();
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
    setStatus("Item deleted", "success");
  }

  function disableActions() {
    els.newFolder.disabled = true;
    els.newFile.disabled = true;
    els.save.disabled = true;
    els.delete.disabled = true;
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

  (async () => {
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
    }
  })();
})();
