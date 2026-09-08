import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const core = await readFile(new URL("app-core.js", root), "utf8");
const css = await readFile(new URL("main-ui-v2.css", root), "utf8");

// Exercise the same pure sanitizer used by artifact writes and by Run Preview.
// This catches the regression without booting the DOM-heavy app shell.
const start = core.indexOf("function normalizeBrowserScriptReference");
const end = core.indexOf("\nfunction artifactFileContent", start);
assert.ok(start >= 0 && end > start, "preview sanitizer source is present");
const previewHelpers = new Function(
  `${core.slice(start, end)}; return { sanitizeBrowserPreviewFile };`,
)();

const unsafeHtml = `<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.test/theme.css"><script src="https://cdn.example.test/widget.js"></script></head><body style="background:url(https://cdn.example.test/bg.png)"><img src="https://cdn.example.test/image.png"></body></html>`;
const repairedHtml = previewHelpers.sanitizeBrowserPreviewFile(unsafeHtml, "index.html");
assert.doesNotMatch(repairedHtml, /https?:|<link\b/i, "HTML preview removes remote resources");
assert.doesNotMatch(repairedHtml, /\burl\s*\(/i, "HTML preview removes remote CSS url expressions");

const repairedCss = previewHelpers.sanitizeBrowserPreviewFile(".hero{background:url('https://cdn.example.test/hero.png');}", "style.css");
assert.doesNotMatch(repairedCss, /\burl\s*\(/i, "CSS preview removes resource URLs");

assert.match(core, /repairStoredPreviewFiles\(workspace, task, records\)/, "Run Preview repairs stored task files");
assert.match(core, /source: "browser-preview-repair"/, "preview repair is persisted as a task revision");
assert.match(core, /frameStyle = .*html,body\{width:100%/, "generated document receives a full-viewport frame style");
assert.match(core, /body>:first-child\.webai-fluid-root/, "sparse first-child layouts receive full-height treatment");
assert.match(core, /#root\.webai-fluid-root/, "generated #root layouts receive full-height treatment");
assert.match(core, /#app\.webai-fluid-root/, "generated #app layouts receive full-height treatment");
assert.match(core, /main\.webai-fluid-root/, "generated main layouts receive full-height treatment");
assert.match(core, /data-webai-fixed-size/, "fixed-size demos can opt out of fluid root treatment");
assert.match(core, /classList\.add\('webai-fluid-root'\)/, "preview runtime marks sparse roots before app code runs");
assert.match(css, /#tab-preview\.active\{[\s\S]*?display:flex/, "preview panel becomes a vertical flex region");
assert.match(css, /#tab-preview \.previewCanvas\{[\s\S]*?flex:1 1 auto/, "preview canvas consumes remaining panel height");
assert.match(css, /#tab-preview \.workspacePreviewFrame\{[\s\S]*?height:100%/, "preview iframe fills the canvas");

console.log("PASS browser preview regression: local-only repair and full-frame rendering");
