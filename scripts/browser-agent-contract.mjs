import { readFile } from "node:fs/promises";

const [core, workspace, html, app, pages, mainUi, mainCss] = await Promise.all([
  readFile(new URL("../app-core.js", import.meta.url), "utf8"),
  readFile(new URL("../workspace.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
  readFile(new URL("../main-ui-v2.js", import.meta.url), "utf8"),
  readFile(new URL("../main-ui-v2.css", import.meta.url), "utf8")
]);

const checks = [
  ["malformed generation is rejected", core.includes("Demo response has duplicate") && core.includes("code fences ครบ")],
  ["external URLs and network APIs are rejected", core.includes("UNSAFE_PREVIEW_PATTERNS") && /fetch\|XMLHttpRequest\|WebSocket/.test(core)],
  ["local interactive forms work without navigation", core.includes("document.addEventListener('submit',function(e){e.preventDefault();},true)") && core.includes("forms cannot specify action, method, target, or formaction") && !core.includes("(?:form|iframe|object|embed|base)")],
  ["output size is bounded", core.includes("AGENT_FILE_LIMIT") && workspace.includes("MAX_FILE_BYTES")],
  ["generated files use revisioned IndexedDB records", workspace.includes('DB_VERSION = 2') && workspace.includes('REVISION_STORE_NAME') && workspace.includes('revisionsStore.put')],
  ["agent creates a deterministic task folder and plan artifact", core.includes("ensureTaskFolder") && core.includes('name: "PLAN.md"') && core.includes('name: "TASK.json"') && workspace.includes("/^BROWSER-[0-9]{8}$/")],
  ["agent artifacts stay inside the task folder", core.includes("writeTaskFiles") && core.includes("workspaceFolder") && workspace.includes("Task artifacts must stay inside their task folder")],
  ["agent generation saves each plan step immediately without an Apply step", core.includes('task.status = "applying"') && core.includes("executeBrowserPlanSteps") && core.includes('source: "browser-agent-step"') && core.includes("workspace.readTaskFiles(task.id, [file.name])") && !core.includes("applyAgentFiles") && !html.includes("applyAgentFilesBtn")],
  ["agent requests a compact manifest then creates files one at a time", core.includes('"browser-manifest"') && core.includes('"browser-artifact"') && core.includes("task.artifactProgress.pending") && core.includes("maxTokens: 3500")],
  ["browser tasks use a fixed runnable file set", core.includes("BROWSER_ARTIFACT_MANIFEST") && core.includes('name: "index.html"') && core.includes('name: "style.css"') && core.includes('name: "app.js"') && core.includes("isDocumentOnlyRequest")],
  ["local JavaScript aliases resolve to the saved app.js file", core.includes("normalizeBrowserScriptReference") && core.includes('"$1app.js$2"') && core.includes("sanitizeBrowserPreviewFile(block.code, file.name)")],
  ["local stylesheets are inlined while external stylesheets stay blocked", core.includes("normalizeBrowserStylesheetReference") && core.includes("external stylesheet links are not allowed") && core.includes("./style.css")],
  ["policy-invalid generated files receive one local-only repair", core.includes("const requestFile = (repairError") && core.includes("file_repair_requested") && core.includes("retrying once") && core.includes("Use local in-memory data and DOM events only")],
  ["token and quota failures keep saved files resumable", core.includes("isRecoverableArtifactError") && core.includes('task.status = recoverable ? "awaiting_resume" : "failed"') && core.includes("Continue saving files")],
  ["new task cannot accept stale generation output", core.includes("function isCurrentGeneration") && core.includes("if (!isCurrentGeneration(task, generationId)) return;") && core.includes("state.busy = false;")],
  ["document tasks are saved without requiring browser preview", core.includes('artifactKind === "document"') && core.includes('task.status = task.artifactKind === "browser" ? "awaiting_preview" : "saved"')],
  ["agent automatically creates artifacts after planning", core.includes('await generateAndSaveBrowserDemo(task, "automatic")') && core.includes("async function generateAndSaveBrowserDemo")],
  ["browser artifacts automatically open and run Preview after saving", core.includes("let autoPreviewRequested = false") && core.includes('autoPreviewRequested = true') && core.includes('selectTab("preview")') && core.includes("await runWorkspacePreview()")],
  ["plans cannot render model source as chat code cards", core.includes("function browserPlanWithoutSource") && core.includes("browserDemoBlocks") && core.includes("source is generated and saved into the task folder")],
  ["generated output is summarized instead of rendered as raw cards", core.includes("renderArtifactSummary") && !core.includes("showPlan(demo)") && html.includes("artifactSummary")],
  ["preview uses the current task folder files", core.includes('readTaskFiles(task.id, ["index.html", "style.css", "app.js"])') && core.includes("composeWorkspaceDocument")],
  ["preview is sandboxed without same-origin", core.includes('setAttribute("sandbox", "allow-scripts")') && !/setAttribute\("sandbox",\s*"[^\"]*allow-same-origin/i.test(core)],
  ["verification observes iframe load and runtime evidence", core.includes('iframe.addEventListener("load"') && core.includes("runtimeErrors") && core.includes("iframe_loaded")],
  ["recovered browser tasks return to a safe preview gate", core.includes("async function restoreBrowserMemory()") && core.includes('if (recovered.status === "completed") recovered.status = "awaiting_preview"') && core.includes("reconcileBrowserTaskEvidence")],
  ["workspace edits invalidate task-bound preview and verification evidence", core.includes("function invalidateBrowserTaskEvidence") && core.includes("workspacePreviewState = null") && core.includes('task.status = "awaiting_preview"') && core.includes("exact_revisions")],
  ["new-task control clears task UI but preserves task folders", html.includes('id="newTaskControl"') && core.includes('document.addEventListener("webai:new-task", () => resetTask())') && core.includes("els.planBox.replaceChildren()") && core.includes("els.artifactSummary.replaceChildren()") && !core.includes("deleteTaskFolder")],
  ["browser agent tasks persist a bounded resumable history", core.includes("BROWSER_AGENT_HISTORY_STORAGE_KEY") && core.includes("persistBrowserAgentTaskHistory") && core.includes("BROWSER_AGENT_HISTORY_LIMIT")],
  ["history selection restores the saved task before Continue", core.includes("window.WebAiResumeBrowserTask = async") && core.includes("state.agentTask = JSON.parse(JSON.stringify(task))") && core.includes("webai:task-selected")],
  ["preview stays unavailable until task artifacts exist", core.includes("const canPreview") && core.includes("task?.appliedFiles") && core.includes("els.runWorkspacePreview.disabled = !canPreview")],
  ["browser task controls do not depend on the currently selected run mode", core.includes("const canPreview = !state.busy && isBrowserAgentTask(task)") && core.includes("const canVerify = (!state.busy && isBrowserAgentTask(task)") && !core.includes("const canPreview = isBrowserAgentMode")],
  ["continue task advances the saved browser task instead of only focusing chat", core.includes("window.WebAiContinueTask = async") && core.includes('task.status === "awaiting_preview"') && core.includes("return runWorkspacePreview()") && core.includes("Complete the next unfinished implementation step")],
  ["follow-up keeps existing saved revisions until replacement artifacts are ready", core.includes("Preserve the last saved revisions") && core.includes("task.artifactManifest = []") && !core.includes("task.appliedFiles = [];\n  task.preview")],
  ["main UI renders a plan-backed TODO without requiring the runtime state object", mainUi.includes('id = "planTodoPanel"') && mainUi.includes('PLAN_TODO_STORAGE_KEY = "webai.browserAgentTask"') && mainUi.includes("parsePlanSteps") && mainUi.includes("task?.steps")],
  ["TODO supports the shared step status contract and dependency gating", mainUi.includes('"pending", "running", "blocked", "failed", "done"') && mainUi.includes("dependencies") && mainUi.includes("dependencyBlocked") && mainUi.includes("nextStepId")],
  ["TODO continue action delegates to the existing Continue task control", mainUi.includes("dataset.planTodoAction") && mainUi.includes("continueButton.click()") && mainUi.includes("nextButton.disabled")],
  ["TODO has accessible status, acceptance, evidence, and responsive styles", mainUi.includes('aria-labelledby", "planTodoTitle"') && mainUi.includes("planTodoAcceptance") && mainUi.includes("planTodoEvidence") && mainCss.includes(".planTodoPanel") && mainCss.includes("@media(max-width:520px)")],
  ["release assets are cache-busted", /(?:app|workspace)\.js\?v=dev/.test(html) && pages.includes("cache-bust.mjs") && app.includes("assetVersion")],
  ["browser agent stays out of remote browser workers", app.includes("browser-memory-client.js") && app.includes('executionTarget = "browser-agent"') && !app.toLowerCase().includes("browserpod") && !app.toLowerCase().includes("browser-linux")]
];

const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
if (failed.length) throw new Error(`Browser Agent contract failed: ${failed.join(", ")}`);
for (const [label] of checks) console.log(`pass · ${label}`);
