import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_PROMPT_CHARS = 16_000;
const MAX_CONTEXT_FILES = 24;
const MAX_TREE_FILES = 160;
const MAX_CONTEXT_CHARS = 60_000;
const MAX_CONTEXT_FILE_BYTES = 24_000;
const MAX_WRITE_FILES = 8;
const MAX_WRITE_FILE_BYTES = 120_000;
const MAX_WRITE_TOTAL_BYTES = 320_000;

const SKIP_DIRS = new Set([
  ".git",
  ".webai",
  ".github",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
]);

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".json", ".html", ".css", ".md", ".txt",
  ".yml", ".yaml", ".py", ".go", ".rs", ".java", ".cs", ".sh",
]);

const PRIORITY_FILES = new Map([
  ["package.json", 20],
  ["README.md", 18],
  ["index.html", 16],
  ["app.js", 16],
  ["app-core.js", 15],
  ["server/index.mjs", 15],
]);

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalizeRelativePath(value) {
  if (typeof value !== "string") throw httpError("native_invalid_path");
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.length > 240 || normalized.includes("\0") || normalized.startsWith("/") || isAbsolute(normalized)) {
    throw httpError("native_invalid_path");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw httpError("native_invalid_path");
  return normalized;
}

function deniedPath(path) {
  const lower = path.toLowerCase();
  const parts = lower.split("/");
  if (parts.some((part) => part.startsWith("."))) return true;
  if (parts.some((part) => ["node_modules", "secrets", "secret", "credentials", "credential"].includes(part))) return true;
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(lower)) return true;
  return false;
}

function redactText(value) {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]")
    .replace(/\bbp1_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]")
    .replace(/(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, "$1[REDACTED]");
}

function goalTokens(goal) {
  return new Set((String(goal).toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []).slice(0, 80));
}

function scorePath(path, tokens) {
  let score = PRIORITY_FILES.get(path) || 0;
  const words = path.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  for (const word of words) if (tokens.has(word)) score += 6;
  if (path.startsWith("src/")) score += 2;
  if (path.startsWith("server/")) score += 2;
  if (/test|spec/i.test(path)) score += 1;
  return score;
}

async function workspaceRoot(workspace) {
  if (typeof workspace !== "string" || !workspace.trim()) throw httpError("workspace_not_configured", 503);
  try {
    const root = await realpath(workspace);
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("not_directory");
    return root;
  } catch {
    throw httpError("workspace_not_configured", 503);
  }
}

async function walkTextFiles(root) {
  const files = [];
  async function walk(directory, prefix = "") {
    if (files.length >= MAX_TREE_FILES) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_TREE_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(resolve(directory, entry.name), rel);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      if (!TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase()) && !PRIORITY_FILES.has(rel)) continue;
      try {
        const info = await stat(resolve(directory, entry.name));
        if (info.size > MAX_CONTEXT_FILE_BYTES) continue;
      } catch {
        continue;
      }
      files.push(rel);
    }
  }
  await walk(root);
  return files;
}

async function collectContext(root, goal) {
  const files = await walkTextFiles(root);
  const tokens = goalTokens(goal);
  const selected = [...files]
    .sort((a, b) => scorePath(b, tokens) - scorePath(a, tokens) || a.localeCompare(b))
    .slice(0, MAX_CONTEXT_FILES);

  const sections = [];
  let used = 0;
  for (const rel of selected) {
    if (used >= MAX_CONTEXT_CHARS) break;
    try {
      const raw = await readFile(resolve(root, rel), "utf8");
      const remaining = MAX_CONTEXT_CHARS - used;
      const content = redactText(raw).slice(0, Math.max(0, remaining));
      sections.push(`--- FILE: ${rel} ---\n${content}`);
      used += content.length;
    } catch {
      // A transient unreadable file should not abort context collection.
    }
  }

  return {
    tree: files.slice(0, MAX_TREE_FILES),
    text: sections.join("\n\n"),
  };
}

function parseManifest(raw) {
  const text = String(raw || "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw httpError("native_manifest_invalid", 502);

  let parsed;
  try {
    parsed = JSON.parse(text.slice(first, last + 1));
  } catch {
    throw httpError("native_manifest_invalid", 502);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.files)) {
    throw httpError("native_manifest_invalid", 502);
  }
  if (parsed.files.length < 1) throw httpError("native_manifest_empty", 422);
  if (parsed.files.length > MAX_WRITE_FILES) throw httpError("native_manifest_too_many_files", 422);

  const seen = new Set();
  let totalBytes = 0;
  const files = parsed.files.map((item) => {
    if (!item || typeof item !== "object" || typeof item.path !== "string" || typeof item.content !== "string") {
      throw httpError("native_manifest_invalid", 502);
    }
    const path = normalizeRelativePath(item.path);
    if (deniedPath(path)) throw httpError("native_path_denied", 403);
    if (seen.has(path)) throw httpError("native_manifest_duplicate_path", 422);
    seen.add(path);
    const bytes = Buffer.byteLength(item.content, "utf8");
    if (bytes > MAX_WRITE_FILE_BYTES) throw httpError("native_file_too_large", 422);
    totalBytes += bytes;
    if (totalBytes > MAX_WRITE_TOTAL_BYTES) throw httpError("native_manifest_too_large", 422);
    return { path, content: item.content, bytes };
  });

  return {
    summary: String(parsed.summary || "WebAi Native Worker update").trim().slice(0, 1_200),
    files,
  };
}

function targetPath(root, relativePath) {
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw httpError("native_path_escape", 403);
  return target;
}

async function assertNoSymlinks(root, relativePath) {
  const parts = relativePath.split("/");
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw httpError("native_symlink_denied", 403);
    } catch (error) {
      if (error?.status) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function atomicWrite(target, content, runId) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.webai-${runId}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

async function applyManifest(root, manifest) {
  const runId = randomUUID();
  const changes = [];
  const applied = [];

  for (const file of manifest.files) {
    const target = targetPath(root, file.path);
    await assertNoSymlinks(root, file.path);
    let previous = null;
    let existed = true;
    try {
      previous = await readFile(target, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") existed = false;
      else throw error;
    }
    changes.push({ ...file, target, previous, existed });
  }

  try {
    for (const change of changes) {
      await atomicWrite(change.target, change.content, runId);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      try {
        if (change.existed) await atomicWrite(change.target, change.previous, `${runId}-rollback`);
        else await rm(change.target, { force: true });
      } catch {
        // Best effort rollback; original error remains authoritative.
      }
    }
    throw error;
  }

  return changes.map((change) => ({
    path: change.path,
    created: !change.existed,
    bytes: change.bytes,
    changed: !change.existed || change.previous !== change.content,
  }));
}

export function createNativeWorker({ workspace, requestModel }) {
  if (typeof requestModel !== "function") throw new TypeError("requestModel must be a function");

  async function run(prompt) {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
      throw httpError("native_invalid_prompt", 400);
    }

    const root = await workspaceRoot(workspace);
    const context = await collectContext(root, prompt);
    const response = await requestModel({
      messages: [
        {
          role: "system",
          content: "You are WebAi Native Worker V0.1. Return only JSON: {summary:string,files:[{path:string,content:string}]}. You may create or replace text source files only. Never write hidden files, credentials, .env, .git, .github, node_modules, certificates, or key files. Never request shell commands or deletions. Use the supplied workspace context and make the smallest coherent change that satisfies the approved task.",
        },
        {
          role: "user",
          content: `${prompt}\n\nWORKSPACE TREE:\n${context.tree.join("\n")}\n\nSELECTED FILE CONTENT:\n${context.text}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const manifest = parseManifest(response?.choices?.[0]?.message?.content);
    const changedFiles = await applyManifest(root, manifest);
    return {
      ok: true,
      worker: "webai-native-v0.1",
      content: manifest.summary,
      changedFiles,
    };
  }

  return {
    run,
    status: async () => {
      try {
        const root = await workspaceRoot(workspace);
        return { enabled: true, configured: true, workspace: root };
      } catch {
        return { enabled: true, configured: false };
      }
    },
  };
}
