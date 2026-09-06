import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshotStore } from "../server/snapshot-store.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "webai-snapshot-"));
  const workspace = join(root, "workspace");
  const snapshots = join(root, "snapshot-store");
  mkdirSync(join(workspace, "src"), { recursive: true });
  return {
    root,
    workspace,
    snapshots,
    store: createSnapshotStore({ workspace, snapshotRoot: snapshots }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function context(executionId = "exec-1") {
  return { ownerId: "owner_AA112233445566", taskId: "task-123", executionId };
}

async function testExistingFileRollbackAndPersistence() {
  const h = fixture();
  const original = "export const value = 'before';\nSECRET-SNAPSHOT-CONTENT";
  const changed = "export const value = 'after';\n";
  const file = join(h.workspace, "src", "app.js");
  writeFileSync(file, original);
  try {
    const captured = await h.store.createSnapshot({ ...context(), files: ["src/app.js"] });
    assert.equal(captured.snapshot.status, "captured");
    assert.equal(JSON.stringify(captured.snapshot).includes("SECRET-SNAPSHOT-CONTENT"), false, "public snapshot metadata must not contain raw content");

    writeFileSync(file, changed);
    const applied = await h.store.recordAfter(captured.ref);
    assert.equal(applied.status, "applied");
    assert.notEqual(applied.files[0].beforeSha256, applied.files[0].afterSha256);

    // Prove a Core restart can reconstruct the store from disk and rollback with the persisted ref.
    const restarted = createSnapshotStore({ workspace: h.workspace, snapshotRoot: h.snapshots });
    const rolled = await restarted.rollback(captured.ref);
    assert.equal(rolled.status, "rolled_back");
    assert.equal(rolled.rollback.verified, true);
    assert.equal(readFileSync(file, "utf8"), original);
  } finally {
    h.cleanup();
  }
}

async function testCreatedFileRollbackDeletesIt() {
  const h = fixture();
  const file = join(h.workspace, "src", "new.js");
  try {
    const captured = await h.store.createSnapshot({ ...context("exec-new"), files: ["src/new.js"] });
    assert.equal(captured.snapshot.files[0].existed, false);
    writeFileSync(file, "export const created = true;\n");
    await h.store.recordAfter(captured.ref);
    const rolled = await h.store.rollback(captured.ref);
    assert.equal(rolled.rollback.restoredFiles, 1);
    assert.equal(existsSync(file), false);
  } finally {
    h.cleanup();
  }
}

async function testMultiFileRollback() {
  const h = fixture();
  const a = join(h.workspace, "src", "a.js");
  const b = join(h.workspace, "src", "b.js");
  writeFileSync(a, "A-before\n");
  writeFileSync(b, "B-before\n");
  try {
    const captured = await h.store.createSnapshot({ ...context("exec-multi"), files: ["src/a.js", "src/b.js"] });
    writeFileSync(a, "A-after\n");
    writeFileSync(b, "B-after\n");
    await h.store.recordAfter(captured.ref);
    await h.store.rollback(captured.ref);
    assert.equal(readFileSync(a, "utf8"), "A-before\n");
    assert.equal(readFileSync(b, "utf8"), "B-before\n");
  } finally {
    h.cleanup();
  }
}

async function testDriftConflictIsAllOrNothing() {
  const h = fixture();
  const a = join(h.workspace, "src", "a.js");
  const b = join(h.workspace, "src", "b.js");
  writeFileSync(a, "A-before\n");
  writeFileSync(b, "B-before\n");
  try {
    const captured = await h.store.createSnapshot({ ...context("exec-conflict"), files: ["src/a.js", "src/b.js"] });
    writeFileSync(a, "A-after\n");
    writeFileSync(b, "B-after\n");
    await h.store.recordAfter(captured.ref);

    // A newer task modifies B after this execution. Old rollback must refuse to touch A as well.
    writeFileSync(b, "B-newer-change\n");
    await assert.rejects(() => h.store.rollback(captured.ref), (error) => {
      assert.equal(error?.status, 409);
      assert.equal(error?.message, "rollback_conflict");
      assert.deepEqual(error?.files, ["src/b.js"]);
      return true;
    });
    assert.equal(readFileSync(a, "utf8"), "A-after\n", "conflict must cause zero rollback mutations");
    assert.equal(readFileSync(b, "utf8"), "B-newer-change\n");
  } finally {
    h.cleanup();
  }
}

async function testDeniedPathsAndSymlink() {
  const h = fixture();
  writeFileSync(join(h.workspace, ".env"), "TOKEN=secret\n");
  const real = join(h.workspace, "src", "real.js");
  const link = join(h.workspace, "src", "link.js");
  writeFileSync(real, "safe\n");
  symlinkSync(real, link);
  try {
    await assert.rejects(
      () => h.store.createSnapshot({ ...context("exec-env"), files: [".env"] }),
      (error) => error?.status === 403 && error?.message === "snapshot_path_denied",
    );
    await assert.rejects(
      () => h.store.createSnapshot({ ...context("exec-traversal"), files: ["../escape.js"] }),
      (error) => error?.status === 400 && error?.message === "snapshot_invalid_path",
    );
    await assert.rejects(
      () => h.store.createSnapshot({ ...context("exec-link"), files: ["src/link.js"] }),
      (error) => error?.status === 403 && error?.message === "snapshot_symlink_denied",
    );
  } finally {
    h.cleanup();
  }
}

async function testSnapshotRootCannotLiveInsideWorkspace() {
  const h = fixture();
  try {
    const unsafe = createSnapshotStore({ workspace: h.workspace, snapshotRoot: join(h.workspace, ".webai-snapshots") });
    await assert.rejects(
      () => unsafe.createSnapshot({ ...context("exec-inside"), files: ["src/app.js"] }),
      (error) => error?.status === 500 && error?.message === "snapshot_store_inside_workspace",
    );
  } finally {
    h.cleanup();
  }
}

await testExistingFileRollbackAndPersistence();
await testCreatedFileRollbackDeletesIt();
await testMultiFileRollback();
await testDriftConflictIsAllOrNothing();
await testDeniedPathsAndSymlink();
await testSnapshotRootCannotLiveInsideWorkspace();

console.log("SNAPSHOT SMOKE PASS: persistence, rollback, created-file removal, multi-file restore, drift conflict, path/symlink boundaries");
