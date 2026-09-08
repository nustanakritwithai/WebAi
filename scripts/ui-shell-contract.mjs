import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = await readFile(resolve(root, "index.html"), "utf8");
const uiSource = await readFile(resolve(root, "main-ui-v2.js"), "utf8");
const uiCss = await readFile(resolve(root, "main-ui-v2.css"), "utf8");
const workspaceSource = await readFile(resolve(root, "workspace.js"), "utf8");

// This deliberately uses the HTML structure instead of looking for CSS class text.
// It is small, dependency-free, and sufficient for the stable shell contract.
function parseHtml(source) {
  const document = { type: "root", children: [], parent: null };
  const stack = [document];
  const tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>/g) || [];
  let cursor = 0;

  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    const text = source.slice(cursor, index);
    if (text.trim()) stack.at(-1).children.push({ type: "text", value: text, parent: stack.at(-1) });
    cursor = index + token.length;
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const match = token.match(/^<([a-z][\w:-]*)([\s\S]*?)(\/?)>$/i);
    if (!match) continue;
    const [, tag, rawAttributes, selfClosing] = match;
    const attrs = {};
    for (const attribute of rawAttributes.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[attribute[1]] = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    }
    const node = { type: "element", tag: tag.toLowerCase(), attrs, children: [], parent: stack.at(-1) };
    stack.at(-1).children.push(node);
    if (!selfClosing && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(node.tag)) {
      stack.push(node);
    }
  }
  return document;
}

const document = parseHtml(html);
const descendants = (node, predicate) => {
  const found = [];
  for (const child of node.children) {
    if (child.type === "element") {
      if (!predicate || predicate(child)) found.push(child);
      found.push(...descendants(child, predicate));
    }
  }
  return found;
};
const all = descendants(document);
const directChildren = (node, predicate) => node.children.filter((child) => child.type === "element" && predicate(child));
const attr = (node, name) => node?.attrs?.[name] ?? "";
const id = (value) => all.find((node) => attr(node, "id") === value);
const className = (value) => all.find((node) => attr(node, "class").split(/\s+/).includes(value));
const hasDescendant = (node, predicate) => descendants(node, predicate).length > 0;
const textContent = (node) => node ? node.children.map((child) => child.type === "element" ? textContent(child) : child.value || "").join(" ") : "";
const hasText = (node, value) => textContent(node).includes(value);
const checks = [];

function check(name, condition, detail = "") {
  checks.push({ name, condition: Boolean(condition), detail });
}

function requireIdList(name, values) {
  check(name, values.every((value) => id(value)), values.filter((value) => !id(value)).join(", "));
}

const shell = id("home")?.parent;
const rail = className("rail");
const main = id("home");
const currentTask = className("currentTask");
const workspace = id("workspace");
const mobileNav = className("mobileNav");
const drawer = id("connectionDrawer");

check("app shell has a semantic left rail and main region", shell?.tag === "div" && directChildren(shell, (node) => node === rail).length === 1 && directChildren(shell, (node) => node === main).length === 1);
check("left rail exposes the core navigation destinations", rail && ["Home", "Tasks", "Files", "Preview"].every((label) => descendants(rail, (node) => ["a", "button"].includes(node.tag) && hasText(node, label))));
check("left rail keeps settings and plan entry points", rail && id("settingsBtn")?.parent === rail && hasDescendant(rail, (node) => node.tag === "a" && hasText(node, "Plan")));

check("central work area owns task input, mode, run action, and timeline", main && ["taskInput", "taskMode", "runTaskBtn", "timeline"].every((value) => hasDescendant(main, (node) => node === id(value))));
check("central work area has a persistent current-task conversation/activity surface", main && currentTask?.parent === main && hasDescendant(currentTask, (node) => node === id("timeline")));
check("composer input is multiline and has an adjacent send/run control", id("taskInput")?.tag === "textarea" && id("runTaskBtn")?.tag === "button");

check("right workspace region has a tablist", workspace && hasDescendant(workspace, (node) => attr(node, "role") === "tablist"));
const tablist = workspace && descendants(workspace, (node) => attr(node, "role") === "tablist")[0];
check("workspace exposes Files, Preview, Diff, and Tests tabs", tablist && ["files", "preview", "diff", "tests"].every((value) => descendants(tablist, (node) => node.tag === "button" && attr(node, "data-tab") === value).length === 1));
const filesTab = tablist && descendants(tablist, (node) => node.tag === "button" && hasText(node, "Files"))[0];
check("Files tab uses an unambiguous files destination", filesTab && (attr(filesTab, "data-tab") === "files" || attr(filesTab, "data-workspace-tab") === "files"), filesTab ? `data-tab=${attr(filesTab, "data-tab")} data-workspace-tab=${attr(filesTab, "data-workspace-tab")}` : "Files tab missing");
check("workspace keeps matching Preview, Diff, and Tests panels", workspace && ["preview", "diff", "tests"].every((tab) => id(`tab-${tab}`) && id(`tab-${tab}`).parent === workspace.children.find((node) => node.type === "element" && attr(node, "class").includes("workspaceGrid"))?.children.find((node) => node.type === "element" && attr(node, "class").includes("tabStage"))));
check("workspace includes file tree and editor hooks", workspace && id("workspaceTree")?.tag === "div" && id("workspaceEditor")?.tag === "div" && id("workspaceEditorInput")?.tag === "textarea");
check("file details editor has an explicit close control", id("closeWorkspaceEditor")?.tag === "button");
check("file details editor has dialog semantics", attr(id("workspaceEditorPath")?.parent?.parent?.parent, "role") === "dialog" && attr(id("workspaceEditorPath")?.parent?.parent?.parent, "aria-modal") === "true");
check("file details editor supports overlay dismissal", /workspaceEditorOpen/.test(uiCss) && /Escape/.test(workspaceSource));
check(
  "Browser Workspace is mounted as a sibling Files view",
  /files\)\s*\{[\s\S]{0,220}files\.classList\.add\("workspaceFilesTabPanel"\)[\s\S]{0,220}workspacePane\.appendChild\(files\)/.test(uiSource),
);

check("mobile navigation is a semantic nav with a More hook", mobileNav?.tag === "nav" && attr(mobileNav, "aria-label") && id("mobileMoreBtn")?.parent === mobileNav);
check("connection drawer has dialog semantics, label, and close hook", drawer?.tag === "div" && attr(drawer, "aria-hidden") === "true" && descendants(drawer, (node) => attr(node, "role") === "dialog" && attr(node, "aria-modal") === "true" && attr(node, "aria-labelledby") === "drawerTitle").length === 1 && hasDescendant(drawer, (node) => node === id("closeDrawer")));

requireIdList("required supervised Agent controls remain present", ["approveExecutionBtn", "verifyTaskBtn", "agentActionHint", "agentError"]);
check("required Agent controls remain actionable buttons", ["approveExecutionBtn", "verifyTaskBtn"].every((value) => id(value)?.tag === "button" && attr(id(value), "type") === "button"));
check("current-task Continue control remains a button", id("continueCurrentTaskBtn")?.tag === "button" && attr(id("continueCurrentTaskBtn"), "type") === "button");
check(
  "Plan TODO keeps retry available for failed steps",
  /steps\.find\(\(step\) => step\.status === ["']failed["']\)/.test(uiSource)
    && /!\["blocked",\s*"done"\]\.includes\(next\.status\)/.test(uiSource),
);
check(
  "Continue binds independently after the V2 DOM move",
  /const continueButton\s*=\s*\$\(["']#continueCurrentTaskBtn["']\)[\s\S]{0,260}if\s*\(continueButton\s*&&\s*continueButton\.dataset\.uiBound\s*!==\s*["']true["']\)/.test(uiSource),
);
check(
  "Continue handler awaits and catches runtime failures",
  /const handleContinueTask\s*=\s*async\s*\(\)[\s\S]{0,1200}await\s+window\.WebAiContinueTask\(\)[\s\S]{0,520}catch\s*\(error\)/.test(uiSource),
);
check(
  "Continue exposes busy state and restores the button in finally",
  /continueButton\.disabled\s*=\s*true[\s\S]{0,520}continueButton\.setAttribute\(["']aria-busy["'],\s*["']true["']\)[\s\S]{0,1800}finally\s*\{[\s\S]{0,360}continueButton\.disabled\s*=\s*false/.test(uiSource),
);
check(
  "Continue prevents duplicate in-flight clicks",
  /continueButton\.dataset\.inFlight\s*===\s*["']true["'][\s\S]{0,120}return;[\s\S]{0,120}continueButton\.dataset\.inFlight\s*=\s*["']true["']/.test(uiSource),
);
check(
  "sidebar HISTORY markup has a real renderer and resume binding",
  id("sidebarTaskHistory")?.tag === "div"
    && /function renderTaskHistory\(\)/.test(uiSource)
    && /function installTaskHistory\(\)/.test(uiSource)
    && /WebAiListBrowserTasks/.test(uiSource)
    && /WebAiResumeBrowserTask/.test(uiSource),
);
check(
  "text zoom controls persist a bounded local font scale",
  /function installZoomControls\(\)[\s\S]{0,1800}webai\.uiZoom[\s\S]{0,900}--ui-font-scale/.test(uiSource) && /uiZoomControls/.test(uiCss),
);
check(
  "mobile Chat and Workspace panes retain touch scrolling",
  /@media\(max-width:900px\)[\s\S]{0,2600}touch-action:pan-y[\s\S]{0,1200}overflow-y:auto/.test(uiCss),
);
requireIdList("task identity hooks remain present", ["currentTaskId", "currentTaskGoal", "uiCurrentTaskState", "uiCurrentTaskFolder"]);
requireIdList("workspace identity and persistence hooks remain present", ["workspaceCurrentFolder", "workspaceStatus", "workspaceTree", "workspaceEditorPath", "workspaceEditorInput", "saveWorkspaceFile", "deleteWorkspaceItem"]);
check("workspace scripts are loaded after the document structure", /<script[^>]+src=["']\.\/workspace\.js\?v=[^"']+["'][^>]*defer/i.test(html));
check("shell keeps the hero two-column composition when docking the composer", !/conversation\.appendChild\(hero\);[\s\S]{0,260}if \(composer\) \{[\s\S]{0,120}dock\.appendChild\(composer\)/.test(uiSource));
check("center pane creates an Agent answer surface", /answerSurface\.id\s*=\s*["']chatAnswerSurface["']/.test(uiSource) && /conversation\.append\(conversationHeader,\s*answerSurface\)/.test(uiSource));
check("composer is placed after the chat answer surface", /conversation\.append\(conversationHeader,\s*answerSurface\);[\s\S]{0,180}conversation\.appendChild\(composer\.closest/.test(uiSource));
check("task context moves into the right workspace before evidence", /const contextStack\s*=\s*el\(["']section["'],\s*["']workspaceContextStack["']\)[\s\S]{0,650}workspacePane\.appendChild\(contextStack\)/.test(uiSource));

// The center pane is the product's answer surface. These checks intentionally
// reject the old layout where the right workspace owns the Plan answer and the
// center merely mirrors it. The composer must remain a compact bottom dock.
check(
  "center answer is rendered before the bottom composer",
  /conversation\.append\(conversationHeader,\s*answerSurface\);\s*if\s*\(composer\)\s*conversation\.appendChild\(composer\.closest\(["']\.composerDock["']\)\s*\|\|\s*composer\)/.test(uiSource),
);
check(
  "compact composer keeps the center input short",
  /conversationPane[^\{]*>[\s\S]{0,420}composerDock[^\{]*>[\s\S]{0,520}#taskInput\s*\{[^}]*min-height\s*:\s*(?:5[0-9]|6[0-4])px/i.test(uiCss),
);
check(
  "center answer does not depend on the right plan box",
  !/read\(["']#planBox["']\)/.test(uiSource),
);
check(
  "actual Plan panel moves from the workspace into the center answer surface",
  /const planPanel\s*=\s*\$\(["']#tab-plan["']\);[\s\S]{0,420}answerSurface\.appendChild\(planPanel\);/.test(uiSource),
);
check(
  "Files is a real workspace destination instead of a Plan alias",
  filesTab && attr(filesTab, "data-tab") === "files",
  filesTab ? `data-tab=${attr(filesTab, "data-tab")}` : "Files tab missing",
);
check(
  "Files and Preview use mutually exclusive top-level views",
  /workspaceGrid\.hidden\s*=\s*fileView/.test(uiSource) && /files\.hidden\s*=\s*!fileView/.test(uiSource),
);
check(
  "desktop workspace collapse requires an explicit user action",
  /const setWorkspaceCollapsed\s*=\s*\(collapsed,\s*options\s*=\s*\{\}\)[\s\S]{0,900}nextCollapsed\s*=\s*Boolean\(collapsed && \(!desktop \|\| userInitiated\)\)/.test(uiSource)
    && /setWorkspaceCollapsed\(!collapsed,\s*\{\s*userInitiated:\s*true\s*\}\)/.test(uiSource),
);
check(
  "workspace hiding CSS is scoped to the explicit user collapse state",
  /data-workspace-collapsed="true"\]\[data-workspace-collapse-source="user"/.test(html)
    && /data-workspace-collapsed="true"\]\[data-workspace-collapse-source="user"/.test(uiCss),
);
check(
  "system shell events restore the workspace without granting collapse state",
  /setWorkspaceCollapsed\(false\)/.test(uiSource) && /delete root\.dataset\.workspaceCollapseSource/.test(uiSource),
);
check(
  "workspace exposes an explicit fullscreen control",
  id("workspaceFullscreenBtn")?.tag === "button"
    && /fullscreenToggle\?\.addEventListener\("click",\s*\(\)\s*=>\s*setWorkspaceFullscreen\(/.test(uiSource),
);
check(
  "workspace fullscreen starts normal and has an accessible restore label",
  /setWorkspaceFullscreen\(false\)/.test(uiSource)
    && /nextFullscreen\s*\?\s*["']Exit fullscreen["']\s*:\s*["']Fullscreen Workspace["']/.test(uiSource)
    && /aria-label.*คืนค่า Workspace ขนาดปกติ/.test(uiSource),
);
check(
  "Escape exits explicit workspace fullscreen",
  /if \(root\.dataset\.workspaceFullscreen === ["']true["']\)[\s\S]{0,220}setWorkspaceFullscreen\(false\)/.test(uiSource),
);
check(
  "fullscreen CSS is opt-in and keeps the normal pane size",
  /data-workspace-fullscreen="true"/.test(uiCss)
    && /position:\s*fixed\s*!important/.test(uiCss)
    && /workspacePane\s*>\s*#workspace[\s\S]{0,180}flex:\s*1 1 auto/.test(uiCss),
);
const viewHandlerSource = uiSource.slice(uiSource.indexOf("function setWorkspaceView"), uiSource.indexOf("function wireShellControls"));
const layoutHandlerSource = uiSource.slice(uiSource.indexOf("function enforcePaneLayout"), uiSource.indexOf("function setWorkspaceView"));
check(
  "tabs and resize never auto-enable workspace fullscreen",
  viewHandlerSource !== "" && layoutHandlerSource !== ""
    && !/setWorkspaceFullscreen\(true\)/.test(viewHandlerSource)
    && !/setWorkspaceFullscreen\(true\)/.test(layoutHandlerSource),
);

// The shell must remain horizontal on desktop. A viewport below this contract's
// tablet breakpoint intentionally becomes a single active pane, but the desktop
// rule must explicitly provide left rail + center chat + right workspace tracks.
check(
  "desktop shell declares three horizontal pane tracks",
  /html\[data-main-ui="v2"\]\[data-shell="three-pane"\]\s*\.appShell\s*\{[\s\S]{0,260}?grid-template-columns\s*:\s*[^;]+\s+[^;]+\s+[^;]+\s*;/i.test(uiCss),
);
check(
  "desktop shell keeps center chat and right workspace as direct regions",
  /html\[data-shell="three-pane"\]\s+\.appShell[\s\S]{0,240}?grid-template-columns\s*:\s*var\(--shell-left\)\s+minmax\(360px,\s*1fr\)\s+var\(--shell-right\)/i.test(html),
);
check(
  "desktop left rail is explicitly visible and anchored",
  /html\[data-main-ui="v2"\]\[data-shell="three-pane"\]\s+\.appShell\s*>\s*\.rail\s*\{[\s\S]{0,260}?display\s*:\s*flex\s*!important[\s\S]{0,260}?visibility\s*:\s*visible\s*!important[\s\S]{0,260}?transform\s*:\s*none\s*!important/i.test(uiCss),
);
check(
  "resize restores the desktop rail and releases mobile rail styles",
  /rail\.style\.display\s*=\s*["']flex["'][\s\S]{0,260}rail\.style\.transform\s*=\s*["']none["'][\s\S]{0,700}removeProperty\(property\)/.test(uiSource)
    && /["']visibility["']/.test(uiSource)
    && /["']transform["']/.test(uiSource),
);

// Plan now belongs to the central answer stream.  Assert the runtime move and
// the layout hooks that keep the active center/right regions vertically ordered.
check(
  "center Plan panel is marked before moving into the answer surface",
  /planPanel\.classList\.add\(["']centerPlanPanel["']\)[\s\S]{0,240}answerSurface\.appendChild\(planPanel\)/.test(uiSource),
);
check(
  "center answer surface stacks its answer and Plan vertically",
  /#chatAnswerSurface\s*\{[^}]*display\s*:\s*flex[^}]*flex-direction\s*:\s*column/i.test(uiCss),
);
check(
  "composer dock follows the center answer surface as a compact bottom control",
  /conversation\.append\(conversationHeader,\s*answerSurface\);[\s\S]{0,180}conversation\.appendChild\(composer\.closest\(["']\.composerDock["']\)\s*\|\|\s*composer\)/.test(uiSource)
    && /\.conversationPane\s*>\s*\.composerDock\s*>\s*\.newTaskCard\s*\{[^}]*padding\s*:/i.test(uiCss),
);
check(
  "right task context stack is vertical",
  /\.workspaceContextStack[^\{]*\{[^}]*display\s*:\s*flex[^}]*flex-direction\s*:\s*column/i.test(uiCss),
);
check(
  "right workspace pane is a vertical reading stack",
  /\.(?:workspacePane|workspacePanel|workspaceShell)[^\{]*\{[^}]*display\s*:\s*flex[^}]*flex-direction\s*:\s*column/i.test(uiCss),
);

const duplicateIds = [...new Set(all.map((node) => attr(node, "id")).filter(Boolean))].filter((value) => all.filter((node) => attr(node, "id") === value).length > 1);
check("DOM ids are unique for stable JavaScript hooks", duplicateIds.length === 0, duplicateIds.join(", "));

const failures = checks.filter((item) => !item.condition);
for (const item of checks) console.log(`${item.condition ? "PASS" : "FAIL"} ${item.name}${item.detail && !item.condition ? ` — ${item.detail}` : ""}`);
console.log(`\n${checks.length - failures.length}/${checks.length} UI-shell contract checks passed.`);
if (failures.length) {
  console.error("\nUI-shell contract failed. Fix the listed DOM contract gaps before relying on browser QA.");
  process.exitCode = 1;
}
