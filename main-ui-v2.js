(() => {
  "use strict";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function makeToolLink(href, iconText, title, subtitle) {
    const a = el("a", "intelligenceTool");
    a.href = href;
    const icon = el("span", "intelligenceToolIcon", iconText);
    const copy = el("span", "intelligenceToolCopy");
    copy.append(el("b", "", title), el("small", "", subtitle));
    const arrow = el("i", "", "→");
    a.append(icon, copy, arrow);
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
    const welcome = document.querySelector(".welcome");
    const task = document.querySelector(".newTaskCard");
    const overview = document.querySelector(".overviewBar");
    if (!welcome || !task || !overview || document.querySelector(".mainHeroV2")) return;

    const hero = el("section", "mainHeroV2");
    main.insertBefore(hero, overview);
    hero.append(welcome, task);
    hero.insertAdjacentElement("afterend", overview);
    overview.classList.add("systemStripV2");

    const eyebrow = welcome.querySelector(".eyebrow");
    const title = welcome.querySelector("h1");
    const paragraph = welcome.querySelector("p");
    if (eyebrow) eyebrow.textContent = "WEB AI · AI SOFTWARE ENGINEERING CPU";
    if (title) {
      title.replaceChildren(
        document.createTextNode("โมเดลเล็ก "),
        el("span", "", "แต่คิดเป็นระบบ"),
      );
    }
    if (paragraph) paragraph.textContent = "สั่งงานครั้งเดียว แล้ว WebAi จะแยกปัญหา วางแผน ลงมือ ตรวจผล และเก็บหลักฐานให้เป็นขั้นตอน";

    const modelMini = welcome.querySelector(".modelMini");
    if (modelMini) modelMini.classList.add("modelMiniV2");

    if (!welcome.querySelector(".intelligenceDock")) {
      const dock = el("div", "intelligenceDock");
      dock.append(
        makeToolLink("./reasoning.html", "◈", "Reasoning Engine", "Decompose · Verify · Revise"),
        makeToolLink("./benchmark-v11.html", "◎", "Capability Lab", "Raw vs Engine benchmark"),
        makeToolLink("./roadmap.html", "↗", "Roadmap", "Architecture & next stages"),
      );
      welcome.appendChild(dock);
    }

    const headTitle = task.querySelector("#newTaskTitle");
    if (headTitle) headTitle.textContent = "สั่งงาน WebAi";
    const input = task.querySelector("#taskInput");
    if (input) input.placeholder = "เช่น: ตรวจบั๊กหน้า Login วางแผนแก้ ทำโค้ด และยืนยันว่าไม่ทำส่วนอื่นพัง";
  }

  function upgradeNavigation() {
    const brandSmall = document.querySelector(".brand small");
    if (brandSmall) brandSmall.textContent = "AI SOFTWARE ENGINEERING CPU · UI V2";

    const intelligence = findRailGroup("INTELLIGENCE");
    addRailLink(intelligence, "./reasoning.html", "◈", "Reasoning");
    addRailLink(intelligence, "./benchmark-v11.html", "◎", "Benchmark");

    const topnav = document.querySelector(".topnav");
    if (topnav && !topnav.querySelector('a[href="./reasoning.html"]')) {
      const link = el("a", "", "AI Lab");
      link.href = "./reasoning.html";
      topnav.appendChild(link);
    }
  }

  function addSectionLabels() {
    const current = document.querySelector(".currentTask");
    const workspace = document.querySelector(".workspaceSection");
    const files = document.querySelector(".fileWorkspaceSection");
    current?.classList.add("surfaceSectionV2");
    workspace?.classList.add("surfaceSectionV2");
    files?.classList.add("surfaceSectionV2");

    const timeline = document.querySelector(".timelineCard");
    timeline?.classList.add("timelineCardV2");

    const inspector = document.querySelector(".inspector");
    inspector?.classList.add("inspectorV2");
  }

  function init() {
    if (document.documentElement.dataset.mainUi === "v2") return;
    const main = document.querySelector(".main");
    if (!main) return;
    document.documentElement.dataset.mainUi = "v2";
    document.body.classList.add("mainUiV2");
    buildHero(main);
    upgradeNavigation();
    addSectionLabels();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
