// Smoke test: TG_HOME=<test home> TG_SMOKE=<output dir> npx electron .
// Opens the first project with tickets, then saves screenshots of the picker, graph, focus mode, board,
// a link popup and the board's link view, and checks that an outside edit to a ticket file shows up live.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { openProject } = require("../src/store");

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(process.env.TG_SMOKE, name + ".png"), img.toPNG());
}

exports.run = (win) => {
  win.webContents.on("console-message", (e) => { if (e.level === "error") console.log("renderer error:", e.message); });
  win.webContents.once("did-finish-load", async () => {
    try {
      fs.mkdirSync(process.env.TG_SMOKE, { recursive: true });
      const js = (code) => win.webContents.executeJavaScript(code);
      await wait(1000); await shot(win, "1-picker");
      const opened = await js(`(() => { const b = [...document.querySelectorAll('[data-act="open"]')].find(x => !/\\b0 tickets/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
      if (!opened) throw new Error("No project to open");
      await js(`document.querySelector('[data-view="graph"]').click()`);
      await wait(2500); await shot(win, "2-graph");
      await js(`select([...tickets.keys()].find(id => tickets.get(id).type === "Content"))`);
      await wait(1800); await shot(win, "3-focus");
      await js(`document.querySelector('[data-view="board"]').click(); boardShow = "tickets"; render();`);
      await wait(800); await shot(win, "4-board");
      console.log("popup:", await js(`(() => { const b = document.querySelector('.bars button[data-act="rel"]'); b.click(); return JSON.stringify({ chip: b.textContent, link: rel?.lid, hidden: relModal.hidden }); })()`));
      await wait(500); await shot(win, "5-link-popup");
      await js(`closeRelation(); boardShow = "links"; render();`);
      await wait(800); await shot(win, "6-board-links");

      // Edit a ticket file from outside the app, as Claude or a text editor would.
      const dir = await js("projectId");
      const proj = openProject(dir);
      const [tid, body] = proj.load().tickets[0];
      proj.put("tickets", tid, { ...body, title: body.title.replace(/ \(edited outside\)$/, "") + " (edited outside)" });
      await wait(2000);
      console.log("live refresh:", await js(`tickets.get(${JSON.stringify(tid)}).title`));
      console.log("smoke ok:", await js(`JSON.stringify({ tickets: tickets.size, links: links.size, project: $("projectName").value, banner: $("banner").hidden ? "" : $("banner").textContent })`));
    } catch (err) {
      console.log("smoke failed:", err.stack || err);
    }
    app.quit();
  });
};
