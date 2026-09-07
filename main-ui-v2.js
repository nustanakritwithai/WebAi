(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function makeToolLink(href, iconText, title, subtitle) {
    const a = el("a", "intelligenceTool");
    a.href = href;
    const copy = el("span", "intelligenceToolCopy");
    copy.append(el("b", "", title), el("small", "", subtitle));
    a.append(el("span", "intelligenceToolIcon", iconText), copy, el("i", "", "→"));
    return a;
  }

  function addRailLink(group, href, iconText, label) {
    if (!group || group.querySelector(`a[href="${href}"]`)) return;
    const a = el("a", "railItem");
    a.href = href;
    a.append(el("span", "", iconText), el("b", "", label));
    group.appendChild(a);
  }

  function findRailGroup(title) {
    return [...document.querySelectorAll(".railGroup")].find((group) =>
      group.querySelector(".railTitle")?.textContent?.trim().toUpperCase() === title
    );
  }

  function buildHero(main) {
    const welcome = $(".welcome");
    const task = $(".newTaskCard");
    const overview = $(".overviewBar");
    if (!welcome || !task || !overview || $(".mainHeroV2")) return;
    const hero = el("section", "mainHeroV2");
    main.insertBefore(hero, overview);
    hero.append(welcome, task);
    overview.classList.add("systemStripV2");
    const eyebrow = welcome.querySelector(".eyebrow");
    const title = welcome.querySelector("h1");
    const paragraph = welcome.querySelector("p");
    if (eyebrow) eyebrow.textContent = "WEB AI · AI SOFTWARE ENGINEERING CPU";
    if (title) title.replaceChildren(document.createTextNode("โมเดลเล็ก "), el("span", "", "แต่คิดเป็นระบบ"));
    if (paragraph) paragraph.textContent = "สั่งงานครั้งเดียว แล้ว WebAi จะแยกปัญหา วางแผน ลงมือ ตรวจผล และเก็บหลักฐานให้เป็นขั้นตอน";
    welcome.querySelector(".modelMini")?.classList.add("modelMiniV2");
    if (!welcome.querySelector(".intelligenceDock")) {
      const dock = el("div", "intelligenceDock");
      dock.append(
        makeToolLink("./reasoning.html", "◈", "Reasoning Engine", "Decompose · Verify · Revise"),
        makeToolLink("./benchmark-v11.html", "◎", "Capability Lab", "Raw vs Engine benchmark"),
        makeToolLink("./roadmap.html", "↗", "Roadmap", "Architecture & next stages")
      );
      welcome.appendChild(dock);
    }
    const headTitle = task.querySelector("#newTaskTitle");
    if (headTitle) headTitle.textContent = "สั่งงาน WebAi";
    const input = task.querySelector("#taskInput");
    if (input) input.placeholder = "เช่น: ตรวจบั๊กหน้า Login วางแผนแก้ ทำโค้ด และยืนยันว่าไม่ทำส่วนอื่นพัง";
  }

  function installShell(main) {
    const root = document.documentElement;
    const appShell = $(".appShell");
    const rail = $(".rail");
    if (!appShell || !rail || $(".workspacePane")) return;
    root.dataset.shell = "three-pane";
    appShell.dataset.shell = "three-pane";
    appShell.dataset.resize = "workspace";
    rail.dataset.collapse = "mobile-drawer";

    const workspacePane = el("aside", "workspacePane");
    workspacePane.dataset.shellRegion = "right";
    workspacePane.setAttribute("aria-label", "Task workspace");
    const workspace = $("#workspace");
    const files = $("#fileWorkspace");
    const lower = $(".lowerGrid");
    if (workspace) workspacePane.appendChild(workspace);
    if (files) workspacePane.appendChild(files);
    if (lower) workspacePane.appendChild(lower);
    appShell.appendChild(workspacePane);

    const conversation = el("div", "conversationPane");
    conversation.dataset.shellRegion = "conversation";
    const hero = $(".mainHeroV2");
    const overview = $(".overviewBar");
    const composer = $(".newTaskCard");
    const task = $("#tasks");
    if (hero) conversation.appendChild(hero);
    if (overview) conversation.appendChild(overview);
    if (task) conversation.appendChild(task);
    if (composer) {
      const dock = el("div", "composerDock");
      dock.dataset.shellHook = "composer";
      dock.appendChild(composer);
      conversation.appendChild(dock);
    }
    main.replaceChildren(conversation);

    const header = $(".topbar");
    const menu = el("button", "shellMenuToggle", "☰");
    menu.id = "mobileTaskMenuBtn";
    menu.type = "button";
    menu.setAttribute("aria-label", "Open task and project menu");
    menu.setAttribute("aria-expanded", "false");
    header?.insertBefore(menu, header.firstChild);

    const workspaceHead = workspace?.querySelector(".sectionHead");
    let toggle;
    if (workspaceHead) {
      toggle = el("button", "shellWorkspaceToggle", "Hide workspace");
      toggle.id = "workspaceCollapseBtn";
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "true");
      toggle.dataset.action = "collapse-workspace";
      const actions = workspaceHead.querySelector(".sectionActions");
      (actions || workspaceHead).appendChild(toggle);
    }

    const resize = el("div", "shellResizeHandle");
    resize.dataset.resizeHandle = "workspace";
    resize.tabIndex = 0;
    resize.setAttribute("role", "separator");
    resize.setAttribute("aria-label", "Resize workspace");
    resize.setAttribute("aria-orientation", "vertical");
    workspacePane.appendChild(resize);

    const mobileSwitch = el("div", "shellMobileSwitch");
    mobileSwitch.dataset.shellHook = "mobile-panel-switcher";
    const chatButton = el("button", "active", "Chat");
    const workspaceButton = el("button", "", "Workspace");
    [chatButton, workspaceButton].forEach((button) => { button.type = "button"; mobileSwitch.appendChild(button); });
    header?.appendChild(mobileSwitch);
    const reveal = el("button", "shellWorkspaceReveal", "Workspace");
    reveal.id = "workspaceRevealBtn";
    reveal.type = "button";
    reveal.setAttribute("aria-controls", "workspace");
    reveal.setAttribute("aria-expanded", "true");
    header?.appendChild(reveal);
    wireShellControls({ root, rail, workspacePane, menu, toggle, reveal, resize, chatButton, workspaceButton });
  }

  function wireShellControls({ root, rail, workspacePane, menu, toggle, reveal, resize, chatButton, workspaceButton }) {
    const setDrawer = (open) => { root.dataset.drawerOpen = String(open); menu.setAttribute("aria-expanded", String(open)); };
    menu.addEventListener("click", () => setDrawer(root.dataset.drawerOpen !== "true"));
    rail.addEventListener("click", (event) => { if (event.target.closest("a")) setDrawer(false); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") setDrawer(false); });
    const setWorkspaceCollapsed = (collapsed) => {
      root.dataset.workspaceCollapsed = String(collapsed);
      if (toggle) {
        toggle.textContent = collapsed ? "Show workspace" : "Hide workspace";
        toggle.setAttribute("aria-expanded", String(!collapsed));
      }
      reveal.textContent = collapsed ? "Show workspace" : "Workspace";
      reveal.setAttribute("aria-expanded", String(!collapsed));
    };
    const toggleWorkspace = () => {
      const collapsed = root.dataset.workspaceCollapsed === "true";
      setWorkspaceCollapsed(!collapsed);
    };
    toggle?.addEventListener("click", toggleWorkspace);
    reveal.addEventListener("click", toggleWorkspace);
    let resizing = false;
    const stop = () => { resizing = false; document.body.style.removeProperty("user-select"); };
    resize.addEventListener("pointerdown", (event) => { resizing = true; resize.setPointerCapture?.(event.pointerId); document.body.style.userSelect = "none"; });
    resize.addEventListener("pointermove", (event) => {
      if (!resizing) return;
      const width = Math.max(400, Math.min(760, window.innerWidth - event.clientX));
      root.style.setProperty("--shell-right", `${width}px`);
    });
    resize.addEventListener("pointerup", stop);
    resize.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const current = parseInt(getComputedStyle(root).getPropertyValue("--shell-right"), 10) || 520;
      root.style.setProperty("--shell-right", `${Math.max(400, Math.min(760, current + (event.key === "ArrowLeft" ? 24 : -24)))}px`);
    });
    const setPanel = (panel) => {
      root.dataset.mobilePanel = panel;
      chatButton.classList.toggle("active", panel === "chat");
      workspaceButton.classList.toggle("active", panel === "workspace");
    };
    chatButton.addEventListener("click", () => setPanel("chat"));
    workspaceButton.addEventListener("click", () => setPanel("workspace"));
    window.addEventListener("resize", () => { if (window.innerWidth > 900) setPanel("chat"); });
    workspacePane.addEventListener("click", (event) => {
      const button = event.target.closest(".tabBtn");
      if (!button) return;
      if ((button.dataset.workspaceTab || button.dataset.tab) === "files") {
        ["plan", "preview", "diff", "tests"].forEach((name) => $(`#tab-${name}`)?.classList.toggle("active", name === "plan"));
      }
      if (window.innerWidth <= 900) setPanel("workspace");
    });
  }

  function upgradeNavigation() {
    $(".brand small")?.replaceChildren(document.createTextNode("AI SOFTWARE ENGINEERING CPU · UI V2"));
    addRailLink(findRailGroup("INTELLIGENCE"), "./reasoning.html", "◈", "Reasoning");
    addRailLink(findRailGroup("INTELLIGENCE"), "./benchmark-v11.html", "◎", "Benchmark");
    const topnav = $(".topnav");
    if (topnav && !topnav.querySelector('a[href="./reasoning.html"]')) {
      const link = el("a", "", "AI Lab"); link.href = "./reasoning.html"; topnav.appendChild(link);
    }
  }

  function addSectionLabels() {
    $("#tasks")?.classList.add("surfaceSectionV2");
    $("#workspace")?.classList.add("surfaceSectionV2");
    $("#fileWorkspace")?.classList.add("surfaceSectionV2");
    $(".timelineCard")?.classList.add("timelineCardV2");
    $(".inspector")?.classList.add("inspectorV2");
  }

  function syncTaskContext() {
    const taskId = $("#currentTaskId")?.textContent?.trim() || "NO TASK";
    const status = $("#taskStatus")?.textContent?.trim() || "Waiting";
    const folderSource = $("#workspaceCurrentFolder")?.textContent?.trim() || "Current task folder: —";
    const hasTask = taskId !== "NO TASK" && taskId !== "AGENT TASK";
    if ($("#uiCurrentTaskState")) $("#uiCurrentTaskState").textContent = hasTask ? `${taskId} · ${status}` : "No active task";
    if ($("#uiCurrentTaskFolder")) $("#uiCurrentTaskFolder").textContent = folderSource.split(" · ")[0];
    if ($("#sidebarTaskState")) $("#sidebarTaskState").textContent = hasTask ? `${taskId} · ${status}` : "No active task";
    if ($("#sidebarCurrentTask b")) $("#sidebarCurrentTask b").textContent = hasTask ? taskId : "Current task";
  }

  function focusCurrentTask() {
    $("#tasks")?.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#taskInput")?.focus({ preventScroll: true });
  }

  function installTaskFlowControls() {
    const continueButton = $("#continueCurrentTaskBtn");
    const newTaskButton = $("#newTaskControl");
    if (!continueButton || !newTaskButton || newTaskButton.dataset.uiBound === "true") return;
    continueButton.addEventListener("click", () => typeof window.WebAiContinueTask === "function" ? window.WebAiContinueTask() : focusCurrentTask());
    if (typeof window.WebAiNewTask !== "function") {
      window.WebAiNewTask = () => {
        const previousTaskId = $("#currentTaskId")?.textContent?.trim() || null;
        document.dispatchEvent(new CustomEvent("webai:new-task", { detail: { previousTaskId, source: "main-ui-v2" } }));
        focusCurrentTask();
        syncTaskContext();
      };
    }
    newTaskButton.addEventListener("click", () => window.WebAiNewTask());
    newTaskButton.dataset.uiBound = "true";
    ["#currentTaskId", "#taskStatus", "#workspaceCurrentFolder"].forEach((selector) => {
      const node = $(selector);
      if (node) new MutationObserver(syncTaskContext).observe(node, { childList: true, characterData: true, subtree: true });
    });
    window.addEventListener("webai:workspace-ready", syncTaskContext, { once: true });
    $("#sidebarCurrentTask")?.addEventListener("click", focusCurrentTask);
    syncTaskContext();
  }

  function installArtifactLinks() {
    $(".artifactSummary")?.addEventListener("click", (event) => {
      const row = event.target.closest("li");
      if (!row) return;
      const name = row.querySelector("span")?.textContent?.trim();
      $("#workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
      [...document.querySelectorAll(".workspaceTreeItem")].find((item) => item.querySelector(".workspaceTreeName")?.textContent?.trim() === name)?.click();
    });
  }

  function init() {
    if (document.documentElement.dataset.mainUi === "v2") return;
    const main = $(".main");
    if (!main) return;
    document.documentElement.dataset.mainUi = "v2";
    document.body.classList.add("mainUiV2");
    buildHero(main);
    installShell(main);
    upgradeNavigation();
    addSectionLabels();
    installTaskFlowControls();
    installArtifactLinks();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
