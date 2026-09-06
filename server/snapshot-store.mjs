import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_TARGETS = 32;
const MAX_PATH_CHARS = 240;

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function idHash(value) {
  return sha256(String(value || "")).slice(0, 32);
}

function normalizeRelativePath(value) {
  if (typeof value !== "string") throw httpError("snapshot_invalid_path");
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.length > MAX_PATH_CHARS || normalized.includes("\0") || normalized.startsWith("/") || isAbsolute(normalized)) {
    throw httpError("snapshot_invalid_path");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw httpError("snapshot_invalid_path");
  return normalized;
}

function deniedPath(path) {
  const lower = path.toLowerCase();
  const parts = lower.split("/");
  if (parts.some((part) => part.startsWith("."))) return true;
  if (parts.some((part) => ["node_modules", "secret", "secrets", "credential", "credentials"].includes(part))) return true;
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(lower)) return true;
  return false;
}

function targetPath(root, relativePath) {
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw httpError("snapshot_path_escape", 403);
  return target;
}

async function assertNoSymlinks(root, relativePath) {
  const parts = relativePath.split("/");
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw httpError("snapshot_symlink_denied", 403);
    } catch (error) {
      if (error?.status) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function fileState(root, relativePath, { includeContent = false } = {}) {
  const target = targetPath(root, relativePath);
  await assertNoSymlinks(root, relativePath);
  try {
    const info = await stat(target);
    if (!info.isFile()) throw httpError("snapshot_target_not_file", 403);
    const content = await readFile(target);
    return {
      exists: true,
      sha256: sha256(content),
      mode: info.mode & 0o777,
      bytes: content.length,
      ...(includeContent ? { content } : {}),
    };
  } catch (error) {
    if (error?.status) throw error;
    if (error?.code === "ENOENT") return { exists: false, sha256: null, mode: null, bytes: 0, ...(includeContent ? { content: null } : {}) };
    throw error;
  }
}

async function atomicWrite(target, content, tag) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.webai-${tag}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, target);
}

function publicManifest(manifest) {
  return {
    snapshotId: manifest.snapshotId,
    executionId: manifest.executionId,
    status: manifest.status,
    createdAt: manifest.createdAt,
    appliedAt: manifest.appliedAt || null,
    rolledBackAt: manifest.rolledBackAt || null,
    files: manifest.files.map((file) => ({
      path: file.path,
      existed: file.existed,
      beforeSha256: file.beforeSha256,
      afterSha256: file.afterSha256 ?? null,
      beforeMode: file.beforeMode,
      afterMode: file.afterMode ?? null,
      bytesBefore: file.bytesBefore,
      bytesAfter: file.bytesAfter ?? null,
    })),
    rollback: manifest.rollback || null,
  };
}

export function createSnapshotStore({ workspace, snapshotRoot }) {
  let rootsPromise = null;

  async function roots() {
    if (rootsPromise) return rootsPromise;
    rootsPromise = (async () => {
      if (typeof workspace !== "string" || !workspace.trim()) throw httpError("workspace_not_configured", 503);
      if (typeof snapshotRoot !== "string" || !snapshotRoot.trim()) throw httpError("snapshot_store_not_configured", 503);
      let workspaceRoot;
      try {
        workspaceRoot = await realpath(workspace);
        const info = await stat(workspaceRoot);
        if (!info.isDirectory()) throw new Error("not_directory");
      } catch {
        throw httpError("workspace_not_configured", 503);
      }
      await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
      const storeRoot = await realpath(snapshotRoot);
      const rel = relative(workspaceRoot, storeRoot);
      if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
        throw httpError("snapshot_store_inside_workspace", 500);
      }
      return { workspaceRoot, storeRoot };
    })();
    return rootsPromise;
  }

  function location(storeRoot, ref) {
    const owner = idHash(ref.ownerId);
    const task = idHash(ref.taskId);
    const execution = idHash(ref.executionId);
    const snapshot = idHash(ref.snapshotId);
    const directory = resolve(storeRoot, owner, task, execution, snapshot);
    return { directory, manifestPath: resolve(directory, "manifest.json"), filesDir: resolve(directory, "files") };
  }

  function validateRef(ref) {
    if (!ref || typeof ref !== "object") throw httpError("snapshot_ref_required");
    for (const key of ["ownerId", "taskId", "executionId", "snapshotId"]) {
      if (typeof ref[key] !== "string" || !ref[key].trim() || ref[key].length > 160) throw httpError("snapshot_ref_invalid");
    }
    return ref;
  }

  async function load(ref) {
    validateRef(ref);
    const { storeRoot } = await roots();
    const paths = location(storeRoot, ref);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw httpError("snapshot_not_found", 404);
      throw httpError("snapshot_manifest_invalid", 500);
    }
    if (manifest?.version !== 1 || manifest.snapshotId !== ref.snapshotId || manifest.executionId !== ref.executionId) {
      throw httpError("snapshot_manifest_invalid", 500);
    }
    return { manifest, paths };
  }

  async function persist(manifest, paths) {
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    const temporary = `${paths.manifestPath}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, paths.manifestPath);
    try { await chmod(paths.manifestPath, 0o600); } catch {}
  }

  async function createSnapshot({ ownerId, taskId, executionId, files }) {
    if (typeof ownerId !== "string" || !ownerId.trim()) throw httpError("snapshot_owner_required");
    if (typeof taskId !== "string" || !taskId.trim()) throw httpError("snapshot_task_required");
    if (typeof executionId !== "string" || !executionId.trim()) throw httpError("snapshot_execution_required");
    if (!Array.isArray(files) || !files.length || files.length > MAX_TARGETS) throw httpError("snapshot_targets_invalid", 422);

    const normalized = files.map(normalizeRelativePath);
    if (new Set(normalized).size !== normalized.length) throw httpError("snapshot_duplicate_target", 422);
    for (const path of normalized) if (deniedPath(path)) throw httpError("snapshot_path_denied", 403);

    const { workspaceRoot, storeRoot } = await roots();
    const snapshotId = `snap-${randomUUID()}`;
    const ref = { ownerId, taskId, executionId, snapshotId };
    const paths = location(storeRoot, ref);
    await mkdir(paths.filesDir, { recursive: true, mode: 0o700 });

    const manifest = {
      version: 1,
      snapshotId,
      executionId,
      createdAt: new Date().toISOString(),
      status: "captured",
      files: [],
      rollback: null,
    };

    for (let index = 0; index < normalized.length; index += 1) {
      const path = normalized[index];
      const state = await fileState(workspaceRoot, path, { includeContent: true });
      const blob = state.exists ? `${String(index).padStart(3, "0")}.bin` : null;
      if (blob) await writeFile(resolve(paths.filesDir, blob), state.content, { mode: 0o600 });
      manifest.files.push({
        path,
        existed: state.exists,
        beforeSha256: state.sha256,
        beforeMode: state.mode,
        bytesBefore: state.bytes,
        blob,
        afterSha256: null,
        afterMode: null,
        bytesAfter: null,
      });
    }

    await persist(manifest, paths);
    return { ref, snapshot: publicManifest(manifest) };
  }

  async function recordAfter(ref) {
    const { workspaceRoot } = await roots();
    const { manifest, paths } = await load(ref);
    if (manifest.status !== "captured") throw httpError("snapshot_not_captured", 409);

    for (const file of manifest.files) {
      const state = await fileState(workspaceRoot, file.path);
      file.afterExists = state.exists;
      file.afterSha256 = state.sha256;
      file.afterMode = state.mode;
      file.bytesAfter = state.bytes;
    }
    manifest.status = "applied";
    manifest.appliedAt = new Date().toISOString();
    await persist(manifest, paths);
    return publicManifest(manifest);
  }

  async function restoreBefore(manifest, paths, workspaceRoot, reason = "rollback") {
    const restored = [];
    const tag = `${reason}-${randomUUID()}`;
    for (const file of manifest.files) {
      const target = targetPath(workspaceRoot, file.path);
      await assertNoSymlinks(workspaceRoot, file.path);
      if (file.existed) {
        if (!file.blob) throw httpError("snapshot_blob_missing", 500);
        const content = await readFile(resolve(paths.filesDir, file.blob));
        await atomicWrite(target, content, tag);
        if (Number.isInteger(file.beforeMode)) {
          try { await chmod(target, file.beforeMode); } catch {}
        }
      } else {
        await rm(target, { force: true });
      }
      restored.push(file.path);
    }

    const verificationFailures = [];
    for (const file of manifest.files) {
      const state = await fileState(workspaceRoot, file.path);
      const expectedExists = file.existed === true;
      const hashMatches = state.sha256 === (file.beforeSha256 ?? null);
      const modeMatches = !expectedExists || state.mode === (file.beforeMode ?? null);
      if (state.exists !== expectedExists || !hashMatches || !modeMatches) verificationFailures.push(file.path);
    }
    if (verificationFailures.length) throw httpError("rollback_verification_failed", 500, { files: verificationFailures });
    return restored;
  }

  async function restoreCaptured(ref) {
    const { workspaceRoot } = await roots();
    const { manifest, paths } = await load(ref);
    if (manifest.status !== "captured") throw httpError("snapshot_not_captured", 409);
    const restored = await restoreBefore(manifest, paths, workspaceRoot, "emergency-restore");
    manifest.status = "rolled_back";
    manifest.rolledBackAt = new Date().toISOString();
    manifest.rollback = { status: "passed", restoredFiles: restored.length, verified: true, reason: "emergency_restore" };
    await persist(manifest, paths);
    return publicManifest(manifest);
  }

  async function validateApplied(ref) {
    const { workspaceRoot } = await roots();
    const { manifest } = await load(ref);
    if (manifest.status !== "applied") throw httpError("snapshot_not_applied", 409);
    const conflicts = [];
    for (const file of manifest.files) {
      const state = await fileState(workspaceRoot, file.path);
      const expectedExists = file.afterExists === true;
      const hashMatches = state.sha256 === (file.afterSha256 ?? null);
      const modeMatches = state.mode === (file.afterMode ?? null);
      if (state.exists !== expectedExists || !hashMatches || !modeMatches) conflicts.push(file.path);
    }
    return { ok: conflicts.length === 0, conflicts, snapshot: publicManifest(manifest) };
  }

  async function rollback(ref) {
    const { workspaceRoot } = await roots();
    const { manifest, paths } = await load(ref);
    if (manifest.status !== "applied") throw httpError("snapshot_not_rollbackable", 409);

    const current = new Map();
    const conflicts = [];
    for (const file of manifest.files) {
      const state = await fileState(workspaceRoot, file.path, { includeContent: true });
      current.set(file.path, state);
      const expectedExists = file.afterExists === true;
      const hashMatches = state.sha256 === (file.afterSha256 ?? null);
      const modeMatches = state.mode === (file.afterMode ?? null);
      if (state.exists !== expectedExists || !hashMatches || !modeMatches) conflicts.push(file.path);
    }
    if (conflicts.length) throw httpError("rollback_conflict", 409, { files: conflicts });

    let restored;
    try {
      restored = await restoreBefore(manifest, paths, workspaceRoot, "rollback");
    } catch (error) {
      // Best-effort transaction repair: restore the exact post-execution state captured before rollback.
      for (const file of manifest.files) {
        const state = current.get(file.path);
        const target = targetPath(workspaceRoot, file.path);
        try {
          if (state?.exists) {
            await atomicWrite(target, state.content, `rollback-undo-${randomUUID()}`);
            if (Number.isInteger(state.mode)) await chmod(target, state.mode);
          } else {
            await rm(target, { force: true });
          }
        } catch {}
      }
      throw error;
    }

    manifest.status = "rolled_back";
    manifest.rolledBackAt = new Date().toISOString();
    manifest.rollback = { status: "passed", restoredFiles: restored.length, verified: true };
    await persist(manifest, paths);
    return publicManifest(manifest);
  }

  async function getSnapshot(ref) {
    const { manifest } = await load(ref);
    return publicManifest(manifest);
  }

  return { createSnapshot, recordAfter, restoreCaptured, validateApplied, rollback, getSnapshot };
}
