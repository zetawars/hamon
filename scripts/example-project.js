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

// Links: the actual work between a thing and a discipline. Strength 0-10 says how far along it is.
// (The fifth argument, a rough pass count, is just for reading; the main links get real passes below.)
let n = 0;
const link = (a, b, strength, status, passes, notes) => {
  const key = `LNK-${++n}`;
  const title = `${proj.load().tickets.find(([k]) => k === a)[1].title} · ${proj.load().tickets.find(([k]) => k === b)[1].title}`;
  proj.put("links", key, { key, title, a, b, strength, comment: notes, props: { status }, created });
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

// Passes: the iteration history of the main links, with the "renders" each pass produced.
// The renders are simple SVG sketches written into art/; a real project would reference its own files.
const artDir = path.join(dir, "art");
fs.mkdirSync(artDir, { recursive: true });
const svg = (name, body, label) => {
  const file = path.join(artDir, name);
  fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="640" height="480">
<rect width="320" height="240" fill="#e9edf2"/><ellipse cx="160" cy="214" rx="96" ry="10" fill="#cfd6df"/>
${body}
<text x="12" y="228" font-family="monospace" font-size="11" fill="#5b6878">${label}</text></svg>\n`);
  return `art/${name}`;
};
// Heavy Walker sketches: a blob, then legs, then a body with the cannon fused on, then a separate cannon.
const legs = (bend) => `<path d="M128 150 L${118 - bend} 182 L124 212 M192 150 L${202 + bend} 182 L196 212" stroke="#46505e" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const hull = `<rect x="108" y="96" width="104" height="60" rx="14" fill="#6b7a8f"/><rect x="138" y="108" width="44" height="14" rx="4" fill="#9fd3ff"/>`;
const walker = [
  svg("heavy-walker-1.svg", `<ellipse cx="160" cy="140" rx="70" ry="62" fill="#7d8796"/><ellipse cx="190" cy="110" rx="30" ry="22" fill="#8c96a5"/>`, "pass 1: blob, no legs"),
  svg("heavy-walker-2.svg", `${legs(12)}${hull}<ellipse cx="214" cy="100" rx="26" ry="20" fill="#7d8796"/>`, "pass 2: legs, cannon is a lump"),
  svg("heavy-walker-3.svg", `${legs(6)}${hull}<path d="M200 98 Q236 86 268 92 L268 106 Q232 104 206 116 Z" fill="#596678"/>`, "pass 3: cannon fused into shoulder"),
  svg("heavy-walker-4.svg", `${legs(16)}${hull}<path d="M200 98 Q236 86 268 92 L268 106 Q232 104 206 116 Z" fill="#596678"/><path d="M118 182 L150 184" stroke="#c8333f" stroke-width="3"/>`, "pass 4: still fused, legs clip"),
  svg("heavy-walker-5.svg", `${legs(8)}${hull}<rect x="214" y="78" width="62" height="16" rx="6" fill="#4b5768"/><rect x="204" y="74" width="20" height="24" rx="5" fill="#596678"/>`, "pass 5: separate cannon mesh"),
];
const drone = (wings, detail, label, name) => svg(name, `<ellipse cx="160" cy="120" rx="44" ry="24" fill="#6b7a8f"/>
${wings ? `<rect x="70" y="104" width="62" height="8" rx="4" fill="#46505e"/><rect x="188" y="104" width="62" height="8" rx="4" fill="#46505e"/><ellipse cx="86" cy="104" rx="22" ry="5" fill="#9aa6b5"/><ellipse cx="234" cy="104" rx="22" ry="5" fill="#9aa6b5"/>` : ""}
${detail ? `<circle cx="160" cy="124" r="9" fill="#9fd3ff"/><rect x="146" y="140" width="28" height="6" rx="3" fill="#46505e"/>` : ""}`, label);
const droneArt = [
  drone(false, false, "pass 1: wrong proportions", "scout-drone-1.svg"),
  drone(true, false, "pass 2: good silhouette", "scout-drone-2.svg"),
  drone(true, true, "pass 3: retopo + rig", "scout-drone-3.svg"),
];

const history = (key, start, passes) => {
  const l = proj.load().links.find(([k]) => k === key)[1];
  proj.put("links", key, { ...l, strength: start });
  for (const p of passes) proj.addPass(key, p);
};
history("LNK-5", 0, [
  { date: "2026-10-21", strength: 1, tool: "Meshy v4", by: "claude", assets: [walker[0]], notes: "First generation from the concept sheet. One blob, no legs." },
  { date: "2026-10-23", strength: 3, tool: "Meshy v4", by: "claude", assets: [walker[1]], notes: "Legs are there. The cannon is a lump on the shoulder." },
  { date: "2026-10-26", strength: 3, tool: "Meshy v4", by: "claude", assets: [walker[2]], notes: "Better silhouette, but the cannon is fused into the shoulder." },
  { date: "2026-10-29", strength: 3, tool: "Meshy v4", by: "you", assets: [walker[3], "Art/Units/HeavyWalker/walker_v4.fbx"], notes: "Prompted for a detachable cannon. Still fused, and now the legs clip when walking." },
  { date: "2026-11-01", strength: 4, tool: "Meshy v4 + Blender", by: "you", assets: [walker[4], "Art/Units/HeavyWalker/walker_v5.fbx", "https://www.meshy.ai/"],
    code: ["9c41e07", "Assets/Scripts/Units/HeavyWalkerRig.cs"], notes: "Generated the cannon as a separate mesh and parented it in Blender. Legs still clip.\nNext: fix the knee pivot, then retopo." },
]);
history("LNK-1", 0, [
  { date: "2026-10-20", strength: 4, tool: "Meshy v4", by: "claude", assets: [droneArt[0]], notes: "Wrong proportions: body too long." },
  { date: "2026-10-22", strength: 7, tool: "Meshy v4", by: "claude", assets: [droneArt[1]], notes: "Good silhouette, messy topology." },
  { date: "2026-10-24", strength: 10, tool: "Blender", by: "you", assets: [droneArt[2], "Art/Units/ScoutDrone/drone_final.fbx"], code: ["2b7d9aa"], notes: "Retopo, UVs and rig in Blender. Shipped." },
]);
history("LNK-10", 2, [
  { date: "2026-10-22", strength: 5, tool: "ElevenLabs SFX", by: "claude", assets: ["Audio/Units/Engineer/repair_loop_v1.wav"], notes: "Repair loop works. Voice barks sound robotic." },
  { date: "2026-10-25", strength: 5, tool: "ElevenLabs SFX", by: "claude", assets: ["Audio/Units/Engineer/barks_v2.wav"], notes: "Tried a warmer voice prompt. Still robotic." },
  { date: "2026-10-28", strength: 5, tool: "ElevenLabs SFX", by: "claude", assets: ["Audio/Units/Engineer/barks_v3.wav"], notes: "Third try at the barks, same problem. Probably needs a different voice model." },
  { date: "2026-10-31", strength: 5, tool: "ElevenLabs SFX", by: "claude", assets: ["Audio/Units/Engineer/barks_v4.wav"], notes: "Fourth try, no better. Stuck: switch to recorded voice lines or another voice model." },
]);
history("LNK-7", 2, [
  { date: "2026-10-24", strength: 4, tool: "Claude", by: "claude", code: ["a13f5c2", "Assets/Scripts/Units/HeavyWalker.cs"], notes: "Movement and attack. No siege mode yet." },
  { date: "2026-10-27", strength: 6, tool: "Claude", by: "claude", code: ["e88b101", "Assets/Scripts/Units/SiegeMode.cs"], notes: "Siege mode works. Turn rate is wrong while deployed." },
]);

const d = proj.load();
console.log(`Wrote ${d.tickets.length} tickets and ${d.links.length} links to ${dir}`, d.problems.length ? d.problems : "");
