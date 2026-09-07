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
    if (!welcome || !task) return;
    // The welcome/task cards are context for the active job. They are moved
    // into the right workspace context stack by installShell(); the center
    // stays reserved for the conversation and its composer.
    welcome.classList.add("mainHeroV2");
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
    const workspaceGrid = workspace?.querySelector(".workspaceGrid");
    const tabStage = workspaceGrid?.querySelector(".tabStage");

    const contextStack = el("section", "workspaceContextStack");
    contextStack.dataset.shellRegion = "task-context";
    contextStack.setAttribute("aria-label", "Task context");
    const overview = $(".overviewBar");
    const welcome = $(".welcome");
    const tasks = $("#tasks");
    [overview, welcome, tasks].forEach((node) => {
      if (!node) return;
      node.classList.toggle("systemStripV2", node === overview);
      contextStack.appendChild(node);
    });
    if (contextStack.childElementCount) workspacePane.appendChild(contextStack);
    if (workspace) workspacePane.appendChild(workspace);
    // Browser Workspace is a sibling view of the evidence workspace. Keeping
    // it outside the tab stage makes the Files/Preview boundary explicit:
    // Preview owns only its toolbar, canvas, and iframe; Files owns the tree
    // and editor without relying on nested tab-panel visibility rules.
    if (files) {
      files.classList.add("workspaceFilesTabPanel");
      files.dataset.shellRegion = "files-tab";
      workspacePane.appendChild(files);
    }
    if (lower) workspacePane.appendChild(lower);
    appShell.appendChild(workspacePane);

    const composer = $(".newTaskCard");
    if (composer && !composer.closest(".composerDock")) {
      const dock = el("div", "composerDock");
      dock.dataset.shellHook = "composer";
      composer.replaceWith(dock);
      dock.appendChild(composer);
    }
    const conversation = el("div", "conversationPane");
    conversation.dataset.shellRegion = "conversation";
    const conversationHeader = el("header", "conversationHeader");
    conversationHeader.append(
      el("div", "conversationHeaderCopy", "WebAi Agent"),
      el("span", "conversationHeaderStatus", "พร้อมรับคำสั่ง")
    );
    conversationHeader.setAttribute("aria-label", "Conversation header");

    const answerSurface = el("section", "conversationBody messageList chatAnswerSurface");
    answerSurface.id = "chatAnswerSurface";
    answerSurface.setAttribute("aria-live", "polite");
    answerSurface.setAttribute("aria-label", "Agent answer");
    const answerTitle = el("div", "chatAnswerTitle", "คำตอบและสถานะงาน");
    const answerBody = el("div", "chatAnswerBody");
    const answerGoal = el("p", "chatAnswerGoal");
    answerGoal.dataset.chatField = "goal";
    const answerDetail = el("p", "chatAnswerDetail");
    answerDetail.dataset.chatField = "detail";
    const answerStatus = el("span", "chatAnswerStatus");
    answerStatus.dataset.chatField = "status";
    answerBody.append(answerGoal, answerDetail, answerStatus);
    answerSurface.append(answerTitle, answerBody);

    // Keep the real plan panel in the center answer stream. Moving the node
    // preserves app-core's existing #planBox/#planEmpty references and all
    // listeners while removing plan content from the right workspace stage.
    const planPanel = $("#tab-plan");
    if (planPanel) {
      planPanel.classList.add("centerPlanPanel");
      planPanel.dataset.shellRegion = "center-answer";
      answerSurface.appendChild(planPanel);
    }

    main.replaceChildren(conversation);
    conversation.append(conversationHeader, answerSurface);
    if (composer) conversation.appendChild(composer.closest(".composerDock") || composer);

    installAnswerMirror(answerSurface);

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
    wireShellControls({ root, rail, workspacePane, workspace, files, menu, toggle, reveal, resize, chatButton, workspaceButton });
    enforcePaneLayout({ appShell, rail, main, workspacePane });
  }

  function installAnswerMirror(surface) {
    if (!surface || surface.dataset.mirrorBound === "true") return;
    surface.dataset.mirrorBound = "true";
    const field = (name) => surface.querySelector(`[data-chat-field="${name}"]`);
    const read = (selector, fallback) => $(selector)?.textContent?.trim() || fallback;
    const update = () => {
      const taskId = read("#currentTaskId", "NO TASK");
      const goal = read("#currentTaskGoal", "ยังไม่มีงานที่กำลังทำ");
      const detail = read("#currentTaskDetail", "พิมพ์เป้าหมายด้านบนแล้วกด Run Task");
      const status = read("#taskStatus", "รอ Backend");
      const goalNode = field("goal");
      const detailNode = field("detail");
      const statusNode = field("status");
      if (goalNode) goalNode.textContent = taskId === "NO TASK" ? goal : `${taskId} · ${goal}`;
      if (detailNode) detailNode.textContent = detail;
      if (statusNode) statusNode.textContent = status;
    };
    ["#currentTaskId", "#currentTaskGoal", "#currentTaskDetail", "#taskStatus"].forEach((selector) => {
      const node = $(selector);
      if (node) new MutationObserver(update).observe(node, { childList: true, characterData: true, subtree: true, attributes: true });
    });
    update();
  }

  function enforcePaneLayout({ appShell, rail, main, workspacePane }) {
    if (!appShell || !rail || !main || !workspacePane) return;

    // The legacy stylesheet collapses the shell to one column below 1200px.
    // Keep that responsive behavior for phones, but explicitly preserve the
    // desktop shell for laptops/tablets that still have room for three panes.
    const apply = () => {
      const desktop = window.innerWidth > 900;
      if (desktop) {
        if (appShell.firstElementChild !== rail || rail.nextElementSibling !== main || main.nextElementSibling !== workspacePane) {
          appShell.append(rail, main, workspacePane);
        }
        appShell.style.display = "grid";
        appShell.style.gridTemplateColumns = "var(--shell-left, 240px) minmax(360px, 1fr) var(--shell-right, 520px)";
        appShell.style.gridTemplateRows = "minmax(0, 1fr)";
        appShell.style.height = "calc(100dvh - 64px)";
        appShell.style.minHeight = "0";
        appShell.style.overflow = "hidden";
        rail.style.gridColumn = "1";
        main.style.gridColumn = "2";
        workspacePane.style.gridColumn = "3";
        [rail, main, workspacePane].forEach((pane) => {
          pane.style.gridRow = "1";
          pane.style.minWidth = "0";
          pane.style.minHeight = "0";
        });
        return;
      }

      // Let the existing mobile drawer and Chat/Workspace rules take over.
      [appShell, rail, main, workspacePane].forEach((node) => {
        ["display", "grid-template-columns", "grid-template-rows", "height", "min-height", "overflow", "grid-column", "grid-row", "min-width"].forEach((property) => node.style.removeProperty(property));
      });
    };

    apply();
    window.addEventListener("resize", apply, { passive: true });
  }

  function setWorkspaceView({ root, workspacePane, workspace, files }, view) {
    const fileView = view === "files";
    if (fileView) {
      // The centered answer and the Files pane share one task identity. Let
      // app-core re-bind the active folder after IndexedDB is ready.
      if (typeof window.WebAiSyncBrowserWorkspace === "function") window.WebAiSyncBrowserWorkspace(true);
      else window.WebAiBrowserWorkspace?.revealActiveTask?.();
    }
    const workspaceGrid = workspace?.querySelector(".workspaceGrid");
    const tabStage = workspaceGrid?.querySelector(".tabStage");
    if (workspace) {
      workspace.hidden = false;
      workspace.setAttribute("aria-hidden", "false");
    }
    if (workspaceGrid) {
      workspaceGrid.hidden = fileView;
      workspaceGrid.setAttribute("aria-hidden", String(fileView));
    }
    if (tabStage) {
      tabStage.querySelectorAll(":scope > .tabPanel").forEach((panel) => {
        const isActivePanel = !fileView && panel.id === `tab-${view}`;
        panel.hidden = !isActivePanel;
        panel.setAttribute("aria-hidden", String(!isActivePanel));
      });
      const inspector = workspaceGrid?.querySelector(":scope > .inspector");
      if (inspector) {
        inspector.hidden = fileView;
        inspector.setAttribute("aria-hidden", String(fileView));
      }
    }
    if (files) {
      files.hidden = !fileView;
      files.setAttribute("aria-hidden", String(!fileView));
    }
    workspacePane.dataset.workspaceView = fileView ? "files" : view;
    root.dataset.workspaceView = fileView ? "files" : view;
    workspacePane.querySelectorAll(".tabBtn").forEach((button) => {
      const buttonView = button.dataset.workspaceTab || button.dataset.tab;
      const active = fileView ? button.dataset.workspaceTab === "files" : buttonView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  function wireShellControls({ root, rail, workspacePane, workspace, files, menu, toggle, reveal, resize, chatButton, workspaceButton }) {
    const setDrawer = (open) => { root.dataset.drawerOpen = String(open); menu.setAttribute("aria-expanded", String(open)); };
    menu.addEventListener("click", () => setDrawer(root.dataset.drawerOpen !== "true"));
    const setPanel = (panel) => {
      root.dataset.mobilePanel = panel;
      chatButton.classList.toggle("active", panel === "chat");
      workspaceButton.classList.toggle("active", panel === "workspace");
      chatButton.setAttribute("aria-pressed", String(panel === "chat"));
      workspaceButton.setAttribute("aria-pressed", String(panel === "workspace"));
    };
    const setWorkspaceCollapsed = (collapsed) => {
      root.dataset.workspaceCollapsed = String(collapsed);
      if (toggle) {
        toggle.textContent = collapsed ? "Show workspace" : "Hide workspace";
        toggle.setAttribute("aria-expanded", String(!collapsed));
      }
      reveal.textContent = collapsed ? "Show workspace" : "Workspace";
      reveal.setAttribute("aria-expanded", String(!collapsed));
      if (window.matchMedia("(max-width: 900px)").matches) setPanel(collapsed ? "chat" : "workspace");
    };
    rail.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (link?.getAttribute("href") === "#files") {
        event.preventDefault();
        setWorkspaceCollapsed(false);
        setWorkspaceView({ root, workspacePane, workspace, files }, "files");
      } else if (link?.getAttribute("href") === "#preview") {
        event.preventDefault();
        setWorkspaceCollapsed(false);
        setWorkspaceView({ root, workspacePane, workspace, files }, "preview");
      }
      if (event.target.closest("a,button")) setDrawer(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setDrawer(false);
        if (window.matchMedia("(max-width: 900px)").matches) setPanel("chat");
      }
    });
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
    chatButton.addEventListener("click", () => setPanel("chat"));
    workspaceButton.addEventListener("click", () => { setWorkspaceCollapsed(false); setPanel("workspace"); });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 900 || root.dataset.workspaceCollapsed === "true") setPanel("chat");
    });
    workspacePane.addEventListener("click", (event) => {
      const button = event.target.closest(".tabBtn");
      if (!button) return;
      const view = button.dataset.workspaceTab || button.dataset.tab || "plan";
      // app-core owns normal tabs. Re-apply after its synchronous handler for
      // the Files alias, whose markup intentionally keeps data-tab=plan.
      queueMicrotask(() => {
        setWorkspaceCollapsed(false);
        setWorkspaceView({ root, workspacePane, workspace, files }, view);
      });
    });
    setWorkspaceView({ root, workspacePane, workspace, files }, "files");
    setWorkspaceCollapsed(false);
    root.__webAiShell = { setWorkspaceCollapsed, setWorkspaceView: (view) => setWorkspaceView({ root, workspacePane, workspace, files }, view), setPanel };
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

  function installZoomControls() {
    const header = $(".topbar");
    if (!header || $("#uiZoomControls")) return;
    const controls = el("div", "uiZoomControls");
    controls.id = "uiZoomControls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "ปรับขนาดตัวอักษร");
    const decrease = el("button", "uiZoomButton", "A−");
    const value = el("button", "uiZoomValue", "100%");
    const increase = el("button", "uiZoomButton", "A+");
    [decrease, value, increase].forEach((button) => {
      button.type = "button";
      button.setAttribute("aria-label", button === decrease ? "ลดขนาดตัวอักษร" : button === increase ? "เพิ่มขนาดตัวอักษร" : "คืนขนาดตัวอักษร 100%");
    });
    controls.append(decrease, value, increase);
    const anchor = $("#systemButton") || $(".topnav");
    if (anchor) header.insertBefore(controls, anchor);
    else header.appendChild(controls);

    const levels = [0.9, 1, 1.1, 1.2];
    const stored = Number(localStorage.getItem("webai.uiZoom"));
    let index = levels.indexOf(stored);
    if (index < 0) index = 1;
    const apply = () => {
      const percent = Math.round(levels[index] * 100);
      document.documentElement.dataset.uiZoom = String(percent);
      document.documentElement.style.setProperty("--ui-font-scale", String(levels[index]));
      value.textContent = `${percent}%`;
      decrease.disabled = index === 0;
      increase.disabled = index === levels.length - 1;
      localStorage.setItem("webai.uiZoom", String(levels[index]));
    };
    decrease.addEventListener("click", () => { index = Math.max(0, index - 1); apply(); });
    increase.addEventListener("click", () => { index = Math.min(levels.length - 1, index + 1); apply(); });
    value.addEventListener("click", () => { index = 1; apply(); });
    apply();
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
    if (!continueButton && !newTaskButton) return;

    if (continueButton && continueButton.dataset.uiBound !== "true") {
      const feedback = el("small", "taskFlowFeedback");
      feedback.id = "continueCurrentTaskFeedback";
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      feedback.hidden = true;
      continueButton.insertAdjacentElement("afterend", feedback);

      const setContinueFeedback = (message, tone = "status") => {
        feedback.hidden = !message;
        feedback.textContent = message;
        feedback.dataset.tone = tone;
      };

      const handleContinueTask = async () => {
        if (continueButton.dataset.inFlight === "true") return;
        continueButton.dataset.inFlight = "true";
        const originalMarkup = continueButton.innerHTML;
        continueButton.disabled = true;
        continueButton.setAttribute("aria-busy", "true");
        continueButton.replaceChildren(document.createTextNode("กำลังทำงานต่อ…"));
        setContinueFeedback("กำลังส่งงานต่อให้ Agent…", "working");
        try {
          if (typeof window.WebAiContinueTask !== "function") {
            focusCurrentTask();
            throw new Error("Continue current task ยังไม่พร้อม กรุณาเริ่ม task ก่อน");
          }
          const result = await window.WebAiContinueTask();
          if (result !== false) setContinueFeedback("ส่งงานต่อแล้ว", "success");
        } catch (error) {
          const message = error?.message || String(error || "ไม่ทราบสาเหตุ");
          setContinueFeedback(`Continue current task ไม่สำเร็จ: ${message}`, "error");
          const agentError = $("#agentError");
          if (agentError) {
            agentError.hidden = false;
            agentError.textContent = `Continue current task ไม่สำเร็จ: ${message}`;
          }
        } finally {
          continueButton.innerHTML = originalMarkup;
          continueButton.disabled = false;
          continueButton.removeAttribute("aria-busy");
          delete continueButton.dataset.inFlight;
        }
      };

      continueButton.addEventListener("click", handleContinueTask);
      continueButton.dataset.uiBound = "true";
    }

    if (newTaskButton && newTaskButton.dataset.uiBound !== "true") {
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
    }
    ["#currentTaskId", "#taskStatus", "#workspaceCurrentFolder"].forEach((selector) => {
      const node = $(selector);
      if (node) new MutationObserver(syncTaskContext).observe(node, { childList: true, characterData: true, subtree: true });
    });
    window.addEventListener("webai:workspace-ready", syncTaskContext, { once: true });
    $("#sidebarCurrentTask")?.addEventListener("click", focusCurrentTask);
    syncTaskContext();
  }

  function installArtifactLinks() {
    const summary = $(".artifactSummary");
    if (!summary || summary.dataset.uiBound === "true") return;
    summary.dataset.uiBound = "true";
    summary.addEventListener("click", (event) => {
      if (event.target.closest("[data-artifact-action='open-files']")) {
        const shell = document.documentElement.__webAiShell;
        shell?.setWorkspaceCollapsed(false);
        shell?.setWorkspaceView("files");
        $(".workspacePane")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const row = event.target.closest("li,[data-artifact-path]");
      if (!row) return;
      const target = row.dataset.artifactPath || row.dataset.path || row.querySelector("span")?.textContent?.trim();
      if (!target) return;
      const shell = document.documentElement.__webAiShell;
      shell?.setWorkspaceCollapsed(false);
      shell?.setWorkspaceView("files");
      $(".workspacePane")?.scrollIntoView({ behavior: "smooth", block: "start" });

      const openFile = () => {
        const wanted = String(target).replace(/^\/+/, "");
        const items = [...document.querySelectorAll(".workspaceTreeItem[data-type='file']")];
        const match = items.find((item) => {
          const path = item.dataset.path || "";
          const label = item.querySelector(".workspaceTreeName")?.textContent?.trim() || "";
          return path === wanted || path.endsWith(`/${wanted}`) || label === wanted || (path.endsWith(`/${label}`) && wanted.endsWith(label));
        });
        if (match) {
          match.click();
          return true;
        }
        return false;
      };
      if (openFile()) return;
      const retry = () => {
        if (openFile()) return;
        const tree = $("#workspaceTree");
        if (!tree) return;
        const observer = new MutationObserver(() => {
          if (openFile()) observer.disconnect();
        });
        observer.observe(tree, { childList: true, subtree: true });
        window.setTimeout(() => observer.disconnect(), 3000);
      };
      const workspaceReady = window.WebAiBrowserWorkspace?.ready;
      if (workspaceReady?.then) workspaceReady.then(retry, retry);
      else retry();
    });
    summary.addEventListener("keydown", (event) => {
      if (!(["Enter", " "].includes(event.key))) return;
      const row = event.target.closest("li,[data-artifact-path]");
      if (!row) return;
      event.preventDefault();
      row.click();
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
    installZoomControls();
    addSectionLabels();
    installTaskFlowControls();
    installArtifactLinks();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
