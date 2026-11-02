// Captures the README screenshots from the sample project (examples/ember-outpost). Read-only: nothing is written.
// Run: npm run docs:screenshots
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const OUT = path.join(__dirname, "..", "docs", "images");
const wait = (ms) => new Promise(r => setTimeout(r, ms));

exports.run = (win) => {
  win.setContentSize(1440, 900);
  win.webContents.once("did-finish-load", async () => {
    try {
      fs.mkdirSync(OUT, { recursive: true });
      const js = (code) => win.webContents.executeJavaScript(code);
      const shot = async (name) => fs.writeFileSync(path.join(OUT, name + ".png"), (await win.webContents.capturePage()).toPNG());
      await js(`localStorage.clear()`);
      await wait(1000); await shot("projects");
      await js(`document.querySelector('[data-act="open"]').click()`);
      await wait(800);
      await js(`view = "graph"; render(); setTimeout(fit, 50)`);
      await wait(3000); await js(`fit()`); await wait(700); await shot("graph");
      await js(`select("UNI-2")`);
      await wait(1500); await shot("graph-focus");
      await js(`select(null); view = "board"; boardShow = "tickets"; render()`);
      await wait(800); await shot("board");
      await js(`boardShow = "links"; render()`);
      await wait(800); await shot("board-links");
      await js(`boardShow = "tickets"; render(); openRelation("LNK-5", "UNI-2")`);
      await wait(900); await shot("link");
      await js(`relCard.querySelector(".passes").scrollIntoView({ block: "start" })`);
      await wait(900); await shot("link-passes");
      await js(`openLightbox(5, 0)`);
      await wait(900); await shot("pass-compare");
      await js(`lightbox.hidden = true; closeRelation(); openRelation("LNK-10", "UNI-3")`);
      await wait(900); await js(`relCard.querySelector(".passes").scrollIntoView({ block: "start" })`);
      await wait(500); await shot("link-stuck");
      console.log("screenshots written to", OUT);
    } catch (err) {
      console.log("screenshots failed:", err.stack || err);
    }
    app.quit();
  });
};
