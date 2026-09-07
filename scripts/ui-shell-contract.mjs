import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = await readFile(resolve(root, "index.html"), "utf8");
const uiSource = await readFile(resolve(root, "main-ui-v2.js"), "utf8");
const uiCss = await readFile(resolve(root, "main-ui-v2.css"), "utf8");

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
check(
  "Browser Workspace is mounted into the Files tab stage",
  /files\s*&&\s*tabStage[\s\S]{0,260}tabStage\.appendChild\(files\)/.test(uiSource),
);

check("mobile navigation is a semantic nav with a More hook", mobileNav?.tag === "nav" && attr(mobileNav, "aria-label") && id("mobileMoreBtn")?.parent === mobileNav);
check("connection drawer has dialog semantics, label, and close hook", drawer?.tag === "div" && attr(drawer, "aria-hidden") === "true" && descendants(drawer, (node) => attr(node, "role") === "dialog" && attr(node, "aria-modal") === "true" && attr(node, "aria-labelledby") === "drawerTitle").length === 1 && hasDescendant(drawer, (node) => node === id("closeDrawer")));

requireIdList("required supervised Agent controls remain present", ["approveExecutionBtn", "verifyTaskBtn", "agentActionHint", "agentError"]);
check("required Agent controls remain actionable buttons", ["approveExecutionBtn", "verifyTaskBtn"].every((value) => id(value)?.tag === "button" && attr(id(value), "type") === "button"));
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
  "Files view keeps its workspace grid mounted while showing the file panel",
  /const nestedFiles\s*=\s*Boolean\([\s\S]{0,220}files\.parentElement\s*===\s*tabStage\)[\s\S]{0,420}workspaceGrid\.hidden\s*=\s*nestedFiles\s*\?\s*false\s*:\s*fileView/.test(uiSource),
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
