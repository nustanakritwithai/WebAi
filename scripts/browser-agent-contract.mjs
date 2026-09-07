import { readFile } from "node:fs/promises";

const [core, workspace, html, app, pages] = await Promise.all([
  readFile(new URL("../app-core.js", import.meta.url), "utf8"),
  readFile(new URL("../workspace.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8")
]);

const checks = [
  ["malformed generation is rejected", core.includes("Demo response has duplicate") && core.includes("code fences ครบ")],
  ["external URLs and network APIs are rejected", core.includes("UNSAFE_PREVIEW_PATTERNS") && /fetch\|XMLHttpRequest\|WebSocket/.test(core)],
  ["output size is bounded", core.includes("AGENT_FILE_LIMIT") && workspace.includes("MAX_FILE_BYTES")],
  ["generated files use revisioned IndexedDB records", workspace.includes('DB_VERSION = 2') && workspace.includes('REVISION_STORE_NAME') && workspace.includes('revisionsStore.put')],
  ["agent creates a deterministic task folder and plan artifact", core.includes("ensureTaskFolder") && core.includes('name: "PLAN.md"') && core.includes('name: "TASK.json"') && workspace.includes("/^BROWSER-[0-9]{8}$/")],
  ["agent artifacts stay inside the task folder", core.includes("writeTaskFiles") && core.includes("workspaceFolder") && workspace.includes("Task artifacts must stay inside their task folder")],
  ["approved generation saves immediately without an Apply step", core.includes('task.status = "applying"') && core.includes("workspace.writeTaskFiles(task.id, files") && !core.includes("applyAgentFiles") && !html.includes("applyAgentFilesBtn")],
  ["generated output is summarized instead of rendered as raw cards", core.includes("renderArtifactSummary") && !core.includes("showPlan(demo)") && html.includes("artifactSummary")],
  ["preview uses the current task folder files", core.includes('readTaskFiles(task.id, ["index.html", "style.css", "app.js"])') && core.includes("composeWorkspaceDocument")],
  ["preview is sandboxed without same-origin", core.includes('setAttribute("sandbox", "allow-scripts")') && !/setAttribute\("sandbox",\s*"[^\"]*allow-same-origin/i.test(core)],
  ["verification observes iframe load and runtime evidence", core.includes('iframe.addEventListener("load"') && core.includes("runtimeErrors") && core.includes("iframe_loaded")],
  ["recovered browser tasks return to a safe preview gate", core.includes("async function restoreBrowserMemory()") && core.includes('if (recovered.status === "completed") recovered.status = "awaiting_preview"') && core.includes("reconcileBrowserTaskEvidence")],
  ["workspace edits invalidate task-bound preview and verification evidence", core.includes("function invalidateBrowserTaskEvidence") && core.includes("workspacePreviewState = null") && core.includes('task.status = "awaiting_preview"') && core.includes("exact_revisions")],
  ["new-task control clears only active task state and preserves task folders", html.includes('id="newTaskControl"') && core.includes('document.addEventListener("webai:new-task", () => resetTask())') && !core.includes("deleteTaskFolder")],
  ["release assets are cache-busted", /(?:app|workspace)\.js\?v=dev/.test(html) && pages.includes("cache-bust.mjs") && app.includes("assetVersion")],
  ["browser agent stays out of remote browser workers", app.includes("browser-memory-client.js") && app.includes('executionTarget = "browser-agent"') && !app.toLowerCase().includes("browserpod") && !app.toLowerCase().includes("browser-linux")]
];

const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
if (failed.length) throw new Error(`Browser Agent contract failed: ${failed.join(", ")}`);
for (const [label] of checks) console.log(`pass · ${label}`);
