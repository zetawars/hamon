// End-to-end test of the MCP server against a throwaway app home: node test/mcp-test.mjs
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.join(root, ".smoke", "mcp-home");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, "projects.json"), JSON.stringify({ root: path.join(home, "Projects"), projects: [] }));

const client = new Client({ name: "tg-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "mcp", "server.mjs")], env: { ...process.env, TG_HOME: home } }));

let failures = 0;
const check = (cond, what) => { if (!cond) { failures++; console.log("FAIL", what); } };
async function call(name, args, expectError = false) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  const bad = !!r.isError !== expectError;
  if (bad) failures++;
  console.log(`${bad ? "FAIL" : "ok  "} ${name}${expectError ? " (expected error)" : ""}: ${text.replace(/\s+/g, " ").slice(0, 150)}`);
  try { return JSON.parse(text); } catch { return text; }
}

console.log("tools:", (await client.listTools()).tools.map(t => t.name).join(", "));
const made = await call("create_project", { name: "MCP Test", description: "throwaway" });
await call("create_ticket", { project: "mcp test", title: "Sound / Music", type: "Discipline", category: "Sound" });
await call("create_ticket", { project: "MCP Test", title: "Archer unit", type: "Content", category: "Unit", notes: "Ranged infantry.",
  link_to: [{ ticket: "SOU-1", strength: 3, notes: "needs bow sfx" }] });
await call("create_ticket", { project: "MCP Test", title: "Bad", type: "Content", status: "Blocked" }, true);
await call("set_link", { project: "MCP Test", a: "Archer", b: "SOU-1", strength: 9, props: { status: "In progress" } });
const link = await call("get_ticket", { project: "MCP Test", ticket: "LNK-1" });
check(link.title === "Archer unit · Sound / Music" && link.strength === 9 && link.notes === "needs bow sfx" && link.status === "In progress", "link ticket contents");
await call("update_ticket", { project: "MCP Test", ticket: "UNI-1", title: "Archer", props: { faction: "Human" } });
const t = await call("get_ticket", { project: "MCP Test", ticket: "UNI-1" });
check(t.notes === "Ranged infantry." && t.links[0].key === "LNK-1" && t.props.faction === "Human", "ticket contents");
check((await call("get_ticket", { project: "MCP Test", ticket: "LNK-1" })).title === "Archer · Sound / Music", "link title follows rename");
await call("update_ticket", { project: "MCP Test", ticket: "LNK-1", strength: 10, notes: "final mix in" });
check((await call("list_tickets", { project: "MCP Test", band: "blue" })).length === 1, "band filter");
await call("set_board_columns", { project: "MCP Test", columns: ["Backlog", "Doing", "Done"], renames: { "In progress": "Doing", "To do": "Backlog" } });
check((await call("get_ticket", { project: "MCP Test", ticket: "LNK-1" })).status === "Doing", "column rename reaches links");
const ov = await call("get_project", { project: "MCP Test" });
check(ov.overall === "100% done" && ov.links === 1, "overview");

// The files themselves
const dir = made.folder, files = fs.readdirSync(path.join(dir, "tickets")).sort();
console.log("files:", files.join(", "));
check(files.length === 3 && files.includes("LNK-1-archer-sound-music.md"), "one markdown file per ticket");
console.log(fs.readFileSync(path.join(dir, "tickets", "LNK-1-archer-sound-music.md"), "utf8"));

await call("remove_link", { project: "MCP Test", a: "UNI-1", b: "SOU-1" });
await call("delete_ticket", { project: "MCP Test", ticket: "UNI-1" });
check(fs.readdirSync(path.join(dir, "tickets")).length === 1, "files deleted");
await call("remove_project_from_list", { project: "MCP Test" });
check(fs.existsSync(dir), "folder kept after removing from list");
await client.close();
console.log(failures ? `${failures} FAILURES` : "ALL PASSED");
process.exit(failures ? 1 : 0);
