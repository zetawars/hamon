// Builds examples/ember-outpost: a small sample game project used in the README and screenshots.
// Run: node scripts/example-project.js   (rewrites the folder from scratch)
const fs = require("node:fs");
const path = require("node:path");
const { openProject } = require("../src/store");

const dir = path.join(__dirname, "..", "examples", "ember-outpost");
fs.rmSync(dir, { recursive: true, force: true });
const proj = openProject(dir);
proj.init({ name: "Ember Outpost", description: "Sample project: a small sci-fi base builder whose models, sounds and scripts are made with AI tools." });

const created = Date.parse("2026-10-20T09:00:00Z");
const ticket = (key, title, type, props, notes = "") => proj.put("tickets", key, { key, title, type, props, notes, created });

// Disciplines: the kinds of work everything else depends on.
ticket("3DM-1", "3D Model", "Discipline", { category: "3D Model", tool: "Meshy + Blender", status: "In progress" },
  "Generated meshes, cleaned up in Blender: retopology, UVs, rig.\nStrength = how close the model is to shippable.");
ticket("SOU-1", "Sound", "Discipline", { category: "Sound", tool: "ElevenLabs SFX", status: "In progress" },
  "Voice barks, weapon and ambient sounds.\nStrength = how close the sound set is to final.");
ticket("MEC-1", "Gameplay script", "Discipline", { category: "Mechanic", tool: "Claude", status: "In progress" },
  "Stats, abilities and AI behaviour, written with Claude.\nStrength = how close the behaviour is to the design.");
ticket("ART-1", "Concept art", "Discipline", { category: "Concept Art", tool: "Midjourney", status: "Done" },
  "Reference sheets every model is generated from.");

// Content: the things in the game.
ticket("UNI-1", "Scout Drone", "Content", { category: "Unit", faction: "Colonists", tier: "1", status: "Done" }, "Fast, fragile, reveals fog.");
ticket("UNI-2", "Heavy Walker", "Content", { category: "Unit", faction: "Colonists", tier: "3", status: "In progress" }, "Slow siege unit with a shoulder cannon.");
ticket("UNI-3", "Field Engineer", "Content", { category: "Unit", faction: "Colonists", tier: "1", status: "In progress" }, "Builds and repairs.");
ticket("UNI-4", "Ash Raider", "Content", { category: "Unit", faction: "Raiders", tier: "2", status: "To do" }, "Hit-and-run bike.");
ticket("BUI-1", "Command Hub", "Content", { category: "Building", faction: "Colonists", status: "In progress" }, "Starting building. Trains engineers.");
ticket("BUI-2", "Solar Array", "Content", { category: "Building", faction: "Colonists", status: "Done" }, "Power. Panels track the sun.");
ticket("BUI-3", "Flak Turret", "Content", { category: "Building", faction: "Colonists", status: "To do" }, "Anti-air defence.");

// Links: the actual work between a thing and a discipline. Strength 0-10 says how far along it is,
// and the notes keep the AI iteration history, which is what decides how many passes are left.
let n = 0;
const link = (a, b, strength, status, passes, notes) => {
  const key = `LNK-${++n}`;
  const title = `${proj.load().tickets.find(([k]) => k === a)[1].title} · ${proj.load().tickets.find(([k]) => k === b)[1].title}`;
  proj.put("links", key, { key, title, a, b, strength, comment: notes, props: { status, ai_passes: String(passes) }, created });
};
link("UNI-1", "3DM-1", 10, "Done", 3, "Pass 1: wrong proportions.\nPass 2: good silhouette, messy topology.\nPass 3: retopo in Blender, rigged. Shipped.");
link("UNI-1", "SOU-1", 9, "In progress", 2, "Hover loop is great. The death sound is too long; one more pass.");
link("UNI-1", "MEC-1", 10, "Done", 1, "Scouting behaviour worked first try.");
link("UNI-1", "ART-1", 10, "Done", 2, "");
link("UNI-2", "3DM-1", 4, "In progress", 5, "Pass 5: legs still clip when walking. The generator keeps merging the cannon into the shoulder.\nNext: generate the cannon as a separate mesh.");
link("UNI-2", "SOU-1", 2, "In progress", 1, "Only a placeholder footstep so far.");
link("UNI-2", "MEC-1", 6, "In progress", 3, "Siege mode works. The turn rate is wrong when deployed.");
link("UNI-2", "ART-1", 9, "In progress", 4, "Final sheet pending a colour pass.");
link("UNI-3", "3DM-1", 7, "In progress", 2, "Good model. The tool belt needs a texture fix.");
link("UNI-3", "SOU-1", 5, "In progress", 2, "Repair loop OK, voice barks too robotic.");
link("UNI-3", "MEC-1", 8, "In progress", 4, "Builds correctly; repair priority still picks walls over turrets.");
link("UNI-4", "3DM-1", 0, "To do", 0, "");
link("UNI-4", "SOU-1", 0, "To do", 0, "");
link("UNI-4", "MEC-1", 3, "In progress", 1, "First draft of hit-and-run logic. Retreats too early.");
link("UNI-4", "ART-1", 6, "In progress", 2, "");
link("BUI-1", "3DM-1", 8, "In progress", 3, "Looks right. Too many polygons for the RTS camera, needs a decimate pass.");
link("BUI-1", "SOU-1", 10, "Done", 1, "");
link("BUI-1", "MEC-1", 9, "In progress", 2, "Training queue done; rally point pending.");
link("BUI-2", "3DM-1", 10, "Done", 2, "");
link("BUI-2", "SOU-1", 10, "Done", 1, "");
link("BUI-2", "MEC-1", 10, "Done", 1, "");
link("BUI-3", "3DM-1", 1, "To do", 1, "One rough generation for scale.");
link("BUI-3", "MEC-1", 0, "To do", 0, "");
link("UNI-2", "BUI-1", 5, "In progress", 0, "The Walker needs the Hub's tier-3 upgrade before it can be trained.");

const d = proj.load();
console.log(`Wrote ${d.tickets.length} tickets and ${d.links.length} links to ${dir}`, d.problems.length ? d.problems : "");
