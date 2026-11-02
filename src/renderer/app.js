// Every item is a ticket file in the project folder; ids are ticket keys.
const tickets = new Map();   // key -> {key, title, type: Content|Discipline, props, notes, created}
const links = new Map();     // key -> Link ticket {key, title, a, b, strength, comment (its notes), props, created}
let projectId = null;   // the open project's folder; all reads and writes go through window.tg
let selected = null, selectedLink = null, armedDelete = false;
let view = "graph", groupBy = "status";
try { view = localStorage.getItem("view") === "board" ? "board" : "graph"; groupBy = localStorage.getItem("groupBy") || "status"; } catch {}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* strength 0-3 red, 4-7 yellow, 8-9 green, 10 blue */
function band(s) { return s >= 10 ? "blue" : s >= 8 ? "green" : s >= 4 ? "yellow" : "red"; }
const BAND_LABEL = { red: "Red", yellow: "Yellow", green: "Green", blue: "Done" };
const bandColor = (s) => `var(--s-${band(s)})`;

const typeSlots = new Map();
const FIXED_TYPE_COLOR = { content: "var(--t1)", discipline: "var(--t4)" };
const isDiscipline = (t) => (t.type || "").toLowerCase() === "discipline";
function typeColor(type) {
  const k = (type || "").trim().toLowerCase();
  if (FIXED_TYPE_COLOR[k]) return FIXED_TYPE_COLOR[k];
  if (!typeSlots.has(k)) {
    let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    typeSlots.set(k, `var(--t${(h % 8) + 1})`);
  }
  return typeSlots.get(k);
}
function prefixFor(type) {
  const p = (type || "TKT").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
  return p.padEnd(3, "X");
}
function nextKey(type) {
  const p = prefixFor(type); let max = 0;
  for (const t of [...tickets.values(), ...links.values()]) if (t.key?.startsWith(p + "-")) max = Math.max(max, +t.key.split("-")[1] || 0);
  return `${p}-${max + 1}`;
}
const findLink = (a, b) => [...links].find(([, l]) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const itemOf = (id) => tickets.get(id) || links.get(id);
const otherEnd = (l, id) => (l.a === id ? l.b : l.a);
const linksOf = (id) => [...links].filter(([, l]) => l.a === id || l.b === id);

/* Progress = sum of link strengths out of 10 per link. A discipline's progress covers everything linked to it. */
function progressOf(id) {
  let done = 0, total = 0;
  for (const [, l] of linksOf(id)) if (tickets.has(otherEnd(l, id))) { done += l.strength; total += 10; }
  return { done, total };
}
function addProgress(a, b) { return { done: a.done + b.done, total: a.total + b.total }; }
function progressBar(p) {
  if (!p.total) return `<div class="prog"><span class="prog-txt">No links yet</span></div>`;
  const pct = Math.round(p.done / p.total * 100);
  return `<div class="prog" style="--c:${bandColor(Math.floor(p.done / p.total * 10))}">
    <div class="prog-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="prog-fill" style="width:${pct}%"></div></div>
    <span class="prog-txt"><b>${pct}%</b> done · ${100 - pct}% pending</span></div>`;
}

/* ---------- storage ---------- */
async function put(map, kind, id, body) {
  map.set(id, body); render();
  if (projectId) { try { await window.tg.put(kind, projectId, id, body); } catch (e) { showError(e); } }
}
async function drop(map, kind, id) {
  map.delete(id); render();
  if (projectId) { try { await window.tg.del(kind, projectId, id); } catch (e) { showError(e); } }
}
function showError(e) {
  const b = $("banner");
  b.textContent = "A change didn't save: " + (e?.message || "unknown error");
  b.hidden = false;
}
const saveTicket = (id, body) => put(tickets, "tickets", id, body);
const saveLink = (id, body) => put(links, "links", id, body);

/* ---------- actions ---------- */
$("createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("newTitle").value.trim(); if (!title) return;
  const type = $("newType").value;
  const category = $("newCat").value.trim();
  const id = nextKey(category || type);
  $("newTitle").value = "";
  selected = id; armedDelete = false;
  const firstStatus = (columnsFor("status") || [])[0];
  const props = {};
  if (category) props.category = category;
  if (firstStatus) props.status = firstStatus;
  await saveTicket(id, { key: id, title, type, props, notes: "", created: Date.now() });
});
async function addLink(a, b, strength = 0) {
  if (!a || !b || a === b || findLink(a, b)) return;
  // Content side first, so the title reads "Tesla Trooper · 3D Model".
  if (isDiscipline(tickets.get(a)) && !isDiscipline(tickets.get(b))) [a, b] = [b, a];
  const key = nextKey("LNK"), first = (columnsFor("status") || [])[0];
  await saveLink(key, { key, title: `${tickets.get(a).title} · ${tickets.get(b).title}`, a, b, strength, comment: "",
    props: first ? { status: first } : {}, created: Date.now() });
}
async function setStrength(id, s) { const l = links.get(id); if (l && l.strength !== s) await saveLink(id, { ...l, strength: s }); }
async function setComment(id, text) {
  const l = links.get(id), v = text.trim();
  if (l && (l.comment || "") !== v) await saveLink(id, { ...l, comment: v });
}
async function deleteTicket(id) {
  for (const [lid] of linksOf(id)) await drop(links, "links", lid);
  selected = null; armedDelete = false;
  await drop(tickets, "tickets", id);
}
async function patchTicket(id, patch) {
  const t = tickets.get(id); if (!t) return;
  await saveTicket(id, { ...t, ...patch });
  // Links still titled "<A> · <B>" follow a renamed ticket.
  if (patch.title && patch.title !== t.title) for (const [lid, l] of linksOf(id)) {
    const A = tickets.get(l.a), B = tickets.get(l.b); if (!A || !B) continue;
    const oldTitle = `${l.a === id ? t.title : A.title} · ${l.b === id ? t.title : B.title}`;
    if (l.title === oldTitle) await saveLink(lid, { ...l, title: `${A.title} · ${B.title}` });
  }
}
async function patchItem(id, patch) { if (links.has(id)) await saveLink(id, { ...links.get(id), ...patch }); else await patchTicket(id, patch); }

/* ---------- tally ---------- */
function renderTally() {
  const n = { red: 0, yellow: 0, green: 0, blue: 0 };
  let done = 0, total = 0;
  for (const l of links.values()) if (tickets.has(l.a) && tickets.has(l.b)) { n[band(l.strength)]++; done += l.strength; total += 10; }
  const pct = total ? Math.round(done / total * 100) : 0;
  $("tally").innerHTML = `<span class="pill"><b>${tickets.size}</b> tickets · <b>${links.size}</b> links</span>` +
    `<span class="pill" title="All link strengths combined"><b>${pct}%</b> done overall · ${100 - pct}% pending</span>` +
    Object.keys(n).map(k => `<span class="pill"><span class="dot" style="background:var(--s-${k})"></span><b>${n[k]}</b> ${k === "blue" ? "done" : k}</span>`).join("");
  $("catList").innerHTML = [...new Set([...tickets.values()].map(t => t.props?.category).filter(Boolean))].sort().map(c => `<option value="${esc(c)}">`).join("");
}

/* ---------- inspector ---------- */
// A property with board columns (e.g. status) is picked from those columns; others are free text.
function propField(k, v) {
  const opts = columnsFor(k);
  if (!opts) return `<input type="text" data-act="prop" data-k="${esc(k)}" value="${esc(v)}" aria-label="${esc(k)}">`;
  const all = !v || opts.includes(v) ? opts : [...opts, v];
  return `<select data-act="prop" data-k="${esc(k)}" aria-label="${esc(k)}">${v ? "" : `<option value="" selected>None</option>`}${all.map(o => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
}
function commentBox(lid, l) {
  return `<textarea data-act="comment" data-lid="${lid}" placeholder="Notes on this link (markdown)" maxlength="50000" aria-label="Notes on ${esc(l.key)}">${esc(l.comment || "")}</textarea>`;
}
function renderInspector() {
  const el = $("inspector");
  if (selectedLink) {
    const l = links.get(selectedLink), A = l && tickets.get(l.a), B = l && tickets.get(l.b);
    if (A && B) {
      const end = (id, t) => `<button type="button" data-act="select" data-id="${id}"><span class="dot" style="background:${typeColor(t.type)}"></span><span class="key">${esc(t.key)}</span><span>${esc(t.title)}</span></button>`;
      el.innerHTML = `<h2>Link</h2>
        <div class="ends">${end(l.a, A)}${end(l.b, B)}</div>
        <div class="link" style="--c:${bandColor(l.strength)}">
          <div class="strength"><input type="range" min="0" max="10" step="1" value="${l.strength}" data-act="strength" data-lid="${selectedLink}" aria-label="Link strength">
            <span class="sval">${l.strength}/10 · ${BAND_LABEL[band(l.strength)]}</span></div>
          ${commentBox(selectedLink, l)}
        </div>
        <div class="row" style="margin-top:18px"><button class="btn danger" type="button" data-act="unlink" data-lid="${selectedLink}">Remove link</button></div>`;
      return;
    }
    selectedLink = null;
  }
  const t = selected && tickets.get(selected);
  if (!t) {
    selected = null;
    el.innerHTML = `<h2>Details</h2><p class="insp-empty">Select a ticket in the graph to edit its properties and links. Every link has a strength from 0 (no work done) to 10 (all work done).</p>`;
    return;
  }
  const props = Object.entries(t.props || {});
  const mine = linksOf(selected).sort((x, y) => (tickets.get(otherEnd(x[1], selected))?.key || "").localeCompare(tickets.get(otherEnd(y[1], selected))?.key || ""));
  const linked = new Set(mine.map(([, l]) => otherEnd(l, selected)));
  const candidates = [...tickets].filter(([id]) => id !== selected && !linked.has(id))
    .sort((x, y) => x[1].key.localeCompare(y[1].key));

  el.innerHTML = `<h2>Details</h2>
    <div class="row" style="margin-bottom:6px"><span class="key">${esc(t.key)}</span><span class="chip" style="--c:${typeColor(t.type)}">${esc(t.type)}</span>${t.example ? `<span class="example-tag">example</span>` : ""}</div>
    <div class="field"><input type="text" class="title-input" id="editTitle" value="${esc(t.title)}" aria-label="Title" maxlength="80"></div>
    <div style="margin-top:10px">${progressBar(progressOf(selected))}</div>
    <div class="field" style="margin-top:8px"><label for="editType">Type</label><select id="editType">
      ${[...new Set(["Content", "Discipline", t.type])].map(v => `<option value="${esc(v)}" ${v === t.type ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>

    <div class="h3">Properties</div>
    <div class="props">
      ${props.length ? props.map(([k, v]) => `<div class="prop"><span class="pk" title="${esc(k)}">${esc(k)}</span>
          ${propField(k, v)}
          <button class="x" type="button" data-act="unprop" data-k="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></div>`).join("")
        : `<span class="hint">No properties yet.</span>`}
      <div class="grid2"><input type="text" id="newPropK" placeholder="Property" maxlength="40"><input type="text" id="newPropV" placeholder="Value" maxlength="120">
        <button class="btn small" type="button" data-act="addprop">Add</button></div>
    </div>

    <div class="h3">Notes</div>
    <textarea id="editNotes" class="notes" placeholder="Notes (markdown)" maxlength="50000" aria-label="Notes">${esc(t.notes || "")}</textarea>

    <div class="h3">Links (${mine.length})</div>
    <div class="links">
      ${mine.length ? mine.map(([lid, l]) => { const o = tickets.get(otherEnd(l, selected)); if (!o) return "";
        return `<div class="link" style="--c:${bandColor(l.strength)}" data-lid="${lid}">
          <div class="link-top"><button class="key linkkey" type="button" data-act="openlink" data-lid="${lid}" title="Open ${esc(l.key)}">${esc(l.key)}</button><span class="dot" style="background:${typeColor(o.type)}"></span><span class="key">${esc(o.key)}</span>
            <button class="nm" type="button" data-act="select" data-id="${otherEnd(l, selected)}">${esc(o.title)}</button>
            <button class="x" type="button" data-act="unlink" data-lid="${lid}" aria-label="Remove link to ${esc(o.title)}">×</button></div>
          <div class="strength"><input type="range" min="0" max="10" step="1" value="${l.strength}" data-act="strength" data-lid="${lid}" aria-label="Strength of link to ${esc(o.title)}">
            <span class="sval">${l.strength}/10 · ${BAND_LABEL[band(l.strength)]}</span></div>
          ${commentBox(lid, l)}</div>`; }).join("")
        : `<span class="hint">Not linked to anything yet.</span>`}
      ${candidates.length ? `<div class="grid2" style="grid-template-columns:1fr 64px auto">
          <select id="linkTarget" aria-label="Ticket to link">${candidates.map(([id, c]) => `<option value="${id}">${esc(c.key)} · ${esc(c.title)}</option>`).join("")}</select>
          <input type="number" id="linkStrength" min="0" max="10" value="0" aria-label="Starting strength">
          <button class="btn small" type="button" data-act="link">Link</button></div>
        <span class="hint">Or shift-click a ticket in the graph to link it here.</span>` : ""}
    </div>

    <div class="row" style="margin-top:22px"><button class="btn danger ${armedDelete ? "armed" : ""}" type="button" data-act="delete">${armedDelete ? "Click again to delete" : "Delete ticket"}</button></div>`;
}
const insp = $("inspector");
insp.addEventListener("input", (e) => {
  if (e.target.dataset.act === "strength") {
    const s = +e.target.value, box = e.target.closest(".link");
    box.style.setProperty("--c", bandColor(s));
    box.querySelector(".sval").textContent = `${s}/10 · ${BAND_LABEL[band(s)]}`;
  }
});
insp.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "editTitle" && t.value.trim()) patchTicket(selected, { title: t.value.trim() });
  if (t.id === "editType" && t.value.trim()) patchTicket(selected, { type: t.value.trim() });
  if (t.id === "editNotes" && t.value.trim() !== (tickets.get(selected)?.notes || "")) patchTicket(selected, { notes: t.value.trim() });
  if (t.dataset.act === "prop") patchTicket(selected, { props: { ...tickets.get(selected).props, [t.dataset.k]: t.value } });
  if (t.dataset.act === "strength") setStrength(t.dataset.lid, +t.value);
  if (t.dataset.act === "comment") setComment(t.dataset.lid, t.value);
});
insp.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target.id === "newPropK" || e.target.id === "newPropV")) { e.preventDefault(); insp.querySelector('[data-act="addprop"]').click(); }
});
insp.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "select") select(b.dataset.id);
  if (a === "openlink") openRelation(b.dataset.lid, selected);
  if (a === "unlink") { if (selectedLink === b.dataset.lid) selectedLink = null; drop(links, "links", b.dataset.lid); }
  if (a === "link") {
    const s = Math.max(0, Math.min(10, Math.round(+$("linkStrength").value || 0)));
    addLink(selected, $("linkTarget").value, s);
  }
  if (a === "addprop") {
    const k = $("newPropK").value.trim(); if (!k) { $("newPropK").focus(); return; }
    patchTicket(selected, { props: { ...tickets.get(selected).props, [k]: $("newPropV").value.trim() } });
  }
  if (a === "unprop") { const p = { ...tickets.get(selected).props }; delete p[b.dataset.k]; patchTicket(selected, { props: p }); }
  if (a === "delete") { if (armedDelete) deleteTicket(selected); else { armedDelete = true; renderInspector(); } }
});
function select(id) {
  const changed = id !== selected;
  selected = id; selectedLink = null; armedDelete = false; render();
  // In the graph, zoom to what is now visible: the focused ticket and its links, or everything.
  if (changed && view === "graph") setTimeout(fit, 80);
}
function selectLink(lid) { selectedLink = lid; selected = null; armedDelete = false; render(); }

/* ---------- board ---------- */
// Column lists live in the shared doc settings/board as { columns: { <property>: [values...] } }.
// Status starts with three columns until someone edits them.
const DEFAULT_COLS = { status: ["To do", "In progress", "Done"] };
let boardCfg = { columns: {} }, armedCol = null, dragId = null, lastExtras = [];
let boardShow = "tickets";   // tickets | links | all
try { boardShow = localStorage.getItem("boardShow") || "tickets"; } catch {}
const boardItems = () => [...(boardShow !== "links" ? tickets : []), ...(boardShow !== "tickets" ? links : [])];
const itemProgress = (id) => links.has(id) ? { done: links.get(id).strength, total: 10 } : progressOf(id);
function linkCard(lid, l) {
  const A = tickets.get(l.a), B = tickets.get(l.b); if (!A || !B) return "";
  const end = (k, t) => `<button type="button" data-act="goto" data-id="${k}" style="--c:${typeColor(t.type)}" title="${esc(t.title)}">${esc(t.key)}</button>`;
  return `<div class="card link-card" draggable="true" tabindex="0" role="button" data-id="${lid}" data-link="1" style="--c:${bandColor(l.strength)}">
    <div class="meta"><span class="key">${esc(l.key)}</span><span class="chip" style="--c:${bandColor(l.strength)}">Link · ${l.strength}/10</span></div>
    <div class="ct">${esc(l.title)}</div>
    <div class="bars">${end(l.a, A)}${end(l.b, B)}</div>
    ${progressBar({ done: l.strength, total: 10 })}
  </div>`;
}
const columnsFor = (prop) => prop === "__type" ? null : (boardCfg.columns?.[prop] ?? DEFAULT_COLS[prop] ?? null);
const groupValue = (t) => String(groupBy === "__type" ? (t.a ? "Link" : t.type || "") : (t.props?.[groupBy] ?? "")).trim();
async function saveColumns(prop, list) {
  boardCfg = { ...boardCfg, columns: { ...boardCfg.columns, [prop]: list } };
  render();
  if (projectId) { try { await window.tg.setSetting(projectId, "board", boardCfg); } catch (e) { showError(e); } }
}
function renderBoard() {
  const keys = new Set(["status", ...Object.keys(boardCfg.columns || {})]);
  for (const [, t] of boardItems()) for (const k of Object.keys(t.props || {})) keys.add(k);
  if (!keys.has(groupBy) && groupBy !== "__type") groupBy = "status";
  $("boardShow").value = boardShow;
  $("groupBy").innerHTML = `<option value="__type">Type</option>` + [...keys].sort().map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
  $("groupBy").value = groupBy;

  const isType = groupBy === "__type";
  const configured = columnsFor(groupBy) || [];
  const cols = new Map(configured.map(v => [v, []]));
  const sorted = boardItems().sort((x, y) => x[1].key.localeCompare(y[1].key, undefined, { numeric: true }));
  for (const [id, t] of sorted) { const v = groupValue(t); if (!cols.has(v)) cols.set(v, []); cols.get(v).push([id, t]); }
  lastExtras = [...cols.keys()].filter(k => k && !configured.includes(k)).sort();
  const order = [...configured, ...lastExtras];
  if (!isType) order.push("");
  const label = isType ? "type" : groupBy;

  $("cols").innerHTML = order.map((v, i) => {
    const list = cols.get(v) || [];
    const agg = list.reduce((a, [id]) => addProgress(a, itemProgress(id)), { done: 0, total: 0 });
    const isCfg = !isType && configured.includes(v), extra = !isType && v && !isCfg;
    const armed = armedCol === v;
    const head = isCfg
      ? `<input type="text" class="col-name" data-act="rename" data-v="${esc(v)}" value="${esc(v)}" maxlength="40" aria-label="Column name">
         <span class="n">${list.length}</span>
         <span class="col-tools">
           <button class="x" type="button" data-act="left" data-v="${esc(v)}" aria-label="Move column left" ${i === 0 ? "disabled" : ""}>‹</button>
           <button class="x" type="button" data-act="right" data-v="${esc(v)}" aria-label="Move column right" ${i === configured.length - 1 ? "disabled" : ""}>›</button>
           <button class="x ${armed ? "armed" : ""}" type="button" data-act="delcol" data-v="${esc(v)}" aria-label="Delete column">${armed ? "Delete?" : "×"}</button>
         </span>`
      : `<span class="col-title">${v ? esc(v) : `No ${esc(label)}`}</span><span class="n">${list.length}</span>
         ${extra ? `<button class="btn small" type="button" data-act="keepcol" data-v="${esc(v)}" title="This value is on tickets but not in the column list">Keep</button>` : ""}`;
    return `<div class="col" data-v="${esc(v)}">
      <div class="col-head">${head}</div>
      ${list.length ? `<div class="col-prog">${progressBar(agg)}</div>` : ""}
      <div class="cards">${list.length ? list.map(([id, t]) => {
        if (links.has(id)) return linkCard(id, t);
        const ls = linksOf(id).filter(([, l]) => tickets.has(otherEnd(l, id)));
        return `<div class="card ${id === selected ? "sel" : ""}" draggable="true" tabindex="0" role="button" data-id="${id}" style="--c:${typeColor(t.type)}">
          <div class="meta"><span class="key">${esc(t.key)}</span><span class="chip" style="--c:${typeColor(t.type)}">${esc(t.props?.category || t.type)}</span></div>
          <div class="ct">${esc(t.title)}</div>
          ${ls.length ? `<div class="bars">${ls.map(([lid, l]) => { const o = tickets.get(otherEnd(l, id));
            return `<button type="button" data-act="rel" data-lid="${lid}" data-from="${id}" style="--c:${bandColor(l.strength)}" title="${esc(o.title)}: ${l.strength}/10${l.comment ? " · " + esc(l.comment) : ""}">${esc(o.key)} ${l.strength}</button>`; }).join("")}</div>` : ""}
          ${progressBar(progressOf(id))}
        </div>`; }).join("") : `<div class="col-empty">Drop a card here</div>`}</div></div>`;
  }).join("") + (isType ? "" : `<div class="add-col">
      <input type="text" id="newCol" placeholder="New column name" maxlength="40" aria-label="New column name">
      <button class="btn small" type="button" data-act="addcol">Add column</button>
      <span class="hint">Columns set the choices for <b>${esc(groupBy)}</b> on every ticket.</span></div>`);
}
async function moveTo(id, v) {
  const t = itemOf(id); if (!t || groupValue(t) === v) return;
  if (groupBy === "__type") { if (v && !links.has(id) && v !== "Link") await patchTicket(id, { type: v }); return; }
  const props = { ...t.props };
  if (v) props[groupBy] = v; else delete props[groupBy];
  await patchItem(id, { props });
}
function addColumn(name) {
  name = name.trim();
  const list = columnsFor(groupBy) || [...lastExtras];
  if (!name || list.includes(name)) return;
  saveColumns(groupBy, [...list, name]);
}
async function renameColumn(oldV, newV) {
  newV = newV.trim();
  const list = columnsFor(groupBy) || [];
  if (!newV || newV === oldV || list.includes(newV)) { renderBoard(); return; }
  const prop = groupBy;
  await saveColumns(prop, list.map(x => x === oldV ? newV : x));
  for (const [id, t] of [...tickets, ...links]) if (String(t.props?.[prop] ?? "").trim() === oldV) await patchItem(id, { props: { ...t.props, [prop]: newV } });
}
async function deleteColumn(v) {
  const prop = groupBy; armedCol = null;
  await saveColumns(prop, (columnsFor(prop) || []).filter(x => x !== v));
  // Cards in a deleted column move to "No <property>".
  for (const [id, t] of [...tickets, ...links]) if (String(t.props?.[prop] ?? "").trim() === v) {
    const props = { ...t.props }; delete props[prop]; await patchItem(id, { props });
  }
}
function shiftColumn(v, d) {
  const list = [...(columnsFor(groupBy) || [])], i = list.indexOf(v), j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveColumns(groupBy, list);
}

const colsEl = $("cols"), boardEl = $("board");
// Open the ticket a chip points to: select it, scroll its card into view and flash it.
function goToCard(id) {
  if (!tickets.has(id)) return;
  select(id);
  const el = colsEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", inline: "center", behavior: smooth ? "smooth" : "auto" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  el.focus({ preventScroll: true });
}
colsEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (b) {
    const a = b.dataset.act, v = b.dataset.v;
    if (a === "left") shiftColumn(v, -1);
    if (a === "right") shiftColumn(v, 1);
    if (a === "delcol") { if (armedCol === v) deleteColumn(v); else { armedCol = v; renderBoard(); } }
    if (a === "keepcol") saveColumns(groupBy, [...(columnsFor(groupBy) || []), v]);
    if (a === "addcol") addColumn($("newCol").value);
    if (a === "rel") openRelation(b.dataset.lid, b.dataset.from);
    if (a === "goto") goToCard(b.dataset.id);
    return;
  }
  const c = e.target.closest(".card"); if (!c) return;
  if (c.dataset.link) openRelation(c.dataset.id); else select(c.dataset.id);
});
colsEl.addEventListener("change", (e) => { if (e.target.dataset.act === "rename") renameColumn(e.target.dataset.v, e.target.value); });
colsEl.addEventListener("keydown", (e) => {
  if (e.target.id === "newCol" && e.key === "Enter") { e.preventDefault(); addColumn(e.target.value); return; }
  if (e.target.classList.contains("col-name")) { if (e.key === "Enter") e.target.blur(); return; }
  const c = e.target.closest(".card"); if (c && e.target === c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.dataset.link ? openRelation(c.dataset.id) : select(c.dataset.id); }
});

// Drop anywhere on the board: the card goes to the column under (or nearest to) the pointer's x position.
function colAt(x) {
  let best = null, bd = Infinity;
  for (const c of colsEl.querySelectorAll(".col")) {
    const r = c.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
const clearOver = () => colsEl.querySelectorAll(".col.over").forEach(c => c.classList.remove("over"));
colsEl.addEventListener("dragstart", (e) => {
  const c = e.target.closest(".card"); if (!c) return;
  dragId = c.dataset.id; e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move";
});
colsEl.addEventListener("dragend", () => { dragId = null; clearOver(); });
boardEl.addEventListener("dragover", (e) => {
  if (!dragId) return;
  e.preventDefault();
  const c = colAt(e.clientX);
  if (c && !c.classList.contains("over")) { clearOver(); c.classList.add("over"); }
});
boardEl.addEventListener("dragleave", (e) => { if (!boardEl.contains(e.relatedTarget)) clearOver(); });
boardEl.addEventListener("drop", (e) => {
  if (!dragId) return;
  e.preventDefault();
  const c = colAt(e.clientX), id = dragId;
  dragId = null; clearOver();
  if (c) moveTo(id, c.dataset.v);
});

$("boardShow").addEventListener("change", (e) => { boardShow = e.target.value; try { localStorage.setItem("boardShow", boardShow); } catch {} renderBoard(); });
$("groupBy").addEventListener("change", (e) => { groupBy = e.target.value; armedCol = null; try { localStorage.setItem("groupBy", groupBy); } catch {} renderBoard(); });
document.querySelector(".views").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]"); if (!b) return;
  view = b.dataset.view; try { localStorage.setItem("view", view); } catch {}
  render();
});

/* ---------- relation popup ---------- */
// One link shown as its own card: the ticket it points to, its strength and its comment.
let rel = null;   // { lid, from, opener, armed }
const relModal = $("relModal"), relCard = $("relCard");
function openRelation(lid, from = links.get(lid)?.a) {
  if (!links.has(lid)) return;
  rel = { lid, from, opener: document.activeElement, armed: false };
  relModal.hidden = false;
  renderRelation();
  relCard.querySelector('[data-act="close"]')?.focus();
}
function closeRelation() {
  if (!rel) return;
  const ta = relCard.querySelector('textarea[data-act="comment"]');
  if (ta) setComment(rel.lid, ta.value);
  const ti = relCard.querySelector('[data-act="ltitle"]');
  if (ti && ti.value.trim() && ti.value.trim() !== links.get(rel.lid)?.title) saveLink(rel.lid, { ...links.get(rel.lid), title: ti.value.trim() });
  const o = rel.opener;
  rel = null; relModal.hidden = true; relCard.innerHTML = "";
  if (o && document.contains(o)) o.focus();
}
function renderRelation() {
  if (!rel) return;
  const l = links.get(rel.lid);
  if (!l || !tickets.has(l.a) || !tickets.has(l.b)) { closeRelation(); return; }
  const fromId = rel.from === l.b ? l.b : l.a, toId = otherEnd(l, fromId), to = tickets.get(toId);
  const end = (k) => { const t = tickets.get(k); return `<button type="button" class="rel-end" data-act="openticket" data-id="${k}" style="--c:${typeColor(t.type)}"><span class="key">${esc(t.key)}</span> ${esc(t.title)}</button>`; };
  const props = Object.entries(l.props || {}), toProps = Object.entries(to.props || {});
  relCard.innerHTML = `
    <div class="rel-head"><span class="key rel-key">${esc(l.key)}</span>
      <input type="text" class="rel-title" id="relTitle" data-act="ltitle" value="${esc(l.title)}" maxlength="120" aria-label="Link title">
      <button class="x" type="button" data-act="close" aria-label="Close">×</button></div>
    <div class="rel-ends">${end(l.a)}<span class="muted" aria-hidden="true">↔</span>${end(l.b)}</div>
    <div class="rel-box link" style="--c:${bandColor(l.strength)}">
      <span class="lbl">Strength</span>
      <div class="strength"><input type="range" min="0" max="10" step="1" value="${l.strength}" data-act="strength" data-lid="${rel.lid}" aria-label="Link strength">
        <span class="sval">${l.strength}/10 · ${BAND_LABEL[band(l.strength)]}</span></div>
      <span class="lbl">Properties</span>
      <div class="props">
        ${props.map(([k, v]) => `<div class="prop"><span class="pk" title="${esc(k)}">${esc(k)}</span>${propField(k, v)}
          <button class="x" type="button" data-act="unprop" data-k="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></div>`).join("")}
        <div class="grid2"><input type="text" id="relPropK" placeholder="Property" maxlength="40"><input type="text" id="relPropV" placeholder="Value" maxlength="120">
          <button class="btn small" type="button" data-act="addprop">Add</button></div>
      </div>
      <span class="lbl">Notes</span>
      ${commentBox(rel.lid, l)}
    </div>
    <details class="rel-box rel-about" style="--c:${typeColor(to.type)}">
      <summary>About <span class="key">${esc(to.key)}</span> ${esc(to.title)}</summary>
      ${progressBar(progressOf(toId))}
      ${toProps.length ? `<dl class="kv">${toProps.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v) || "—"}</dd>`).join("")}</dl>` : ""}
    </details>
    <div class="row">
      <button class="btn danger ${rel.armed ? "armed" : ""}" type="button" data-act="unlink">${rel.armed ? "Click again to delete this link" : "Delete link"}</button>
    </div>`;
}
relModal.addEventListener("click", (e) => {
  if (e.target === relModal) { closeRelation(); return; }
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "close") closeRelation();
  if (a === "addprop") {
    const k = $("relPropK").value.trim(); if (!k) { $("relPropK").focus(); return; }
    const l = links.get(rel.lid); saveLink(rel.lid, { ...l, props: { ...l.props, [k]: $("relPropV").value.trim() } });
  }
  if (a === "unprop") { const l = links.get(rel.lid), p = { ...l.props }; delete p[b.dataset.k]; saveLink(rel.lid, { ...l, props: p }); }
  if (a === "openticket") {
    const id = b.dataset.id; closeRelation();
    if (view === "board") goToCard(id); else select(id);
  }
  if (a === "unlink") {
    if (!rel.armed) { rel.armed = true; renderRelation(); relCard.querySelector('[data-act="unlink"]')?.focus(); return; }
    const lid = rel.lid; rel = null; relModal.hidden = true; relCard.innerHTML = "";
    drop(links, "links", lid);
  }
});
relModal.addEventListener("input", (e) => {
  if (e.target.dataset.act !== "strength") return;
  const s = +e.target.value, box = e.target.closest(".link");
  box.style.setProperty("--c", bandColor(s));
  box.querySelector(".sval").textContent = `${s}/10 · ${BAND_LABEL[band(s)]}`;
});
relModal.addEventListener("change", (e) => {
  if (e.target.dataset.act === "strength") setStrength(e.target.dataset.lid, +e.target.value);
  if (e.target.dataset.act === "comment") setComment(e.target.dataset.lid, e.target.value);
  if (e.target.dataset.act === "prop") { const l = links.get(rel.lid); saveLink(rel.lid, { ...l, props: { ...l.props, [e.target.dataset.k]: e.target.value } }); }
  if (e.target.dataset.act === "ltitle" && e.target.value.trim()) saveLink(rel.lid, { ...links.get(rel.lid), title: e.target.value.trim() });
});
relModal.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target.id === "relPropK" || e.target.id === "relPropV")) { e.preventDefault(); relCard.querySelector('[data-act="addprop"]').click(); }
});
document.addEventListener("keydown", (e) => {
  if (!rel) return;
  if (e.key === "Escape") { e.preventDefault(); closeRelation(); return; }
  if (e.key === "Tab") {   // keep keyboard focus inside the popup
    const f = [...relCard.querySelectorAll("button, input, textarea, select, summary")];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
function refreshRelation() {
  if (!rel) return;
  const active = document.activeElement;
  if (relCard.contains(active) && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && active.type === "text"))) return;
  const act = relCard.contains(active) ? active.dataset.act : null;
  renderRelation();
  if (act) relCard.querySelector(`[data-act="${act}"]`)?.focus();
}

/* ---------- graph ---------- */
const svg = d3.select("#graph");
const root = svg.append("g");
const gEdges = root.append("g"), gNodes = root.append("g");
const pos = new Map();
const zoom = d3.zoom().scaleExtent([0.25, 2.5]).on("zoom", (e) => root.attr("transform", e.transform));
svg.call(zoom).on("dblclick.zoom", null);
svg.on("click", (e) => { if (e.target === svg.node()) select(null); });

const sim = d3.forceSimulation()
  .force("link", d3.forceLink().id(d => d.id).distance(170).strength(0.5))
  .force("charge", d3.forceManyBody().strength(-500))
  .force("collide", d3.forceCollide().radius(d => d.r + 14))
  .force("x", d3.forceX(0).strength(0.05))
  .force("y", d3.forceY(0).strength(0.07))
  .on("tick", tick);

function sizeSvg() { const r = svg.node().getBoundingClientRect(); svg.attr("viewBox", [-r.width / 2, -r.height / 2, r.width, r.height]); }
new ResizeObserver(sizeSvg).observe(svg.node());
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;

let lastFocus = "";
function focusLayout(center, others) {
  const out = new Map([[center, { x: 0, y: 0 }]]);
  const left = others.slice();
  for (let ring = 1; left.length; ring++) {
    const r = 230 * ring, batch = left.splice(0, Math.max(6, Math.floor(2 * Math.PI * r / 230)));
    batch.forEach((id, k) => {
      const a = -Math.PI / 2 + 2 * Math.PI * k / batch.length;
      out.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75 });
    });
  }
  return out;
}
function renderGraph() {
  const nodes = [...tickets].map(([id, t]) => {
    const label = trunc(t.title, 24), disc = isDiscipline(t);
    // Wide enough for the title and for the small "KEY · category · 57%" line above it.
    const meta = `${t.key} · ${trunc(t.props?.category || t.type, 14)} · 100%`;
    const w = Math.max(disc ? 150 : 120, Math.min(240, Math.max(label.length * 7.2, meta.length * 6.4) + (disc ? 46 : 34)));
    const p = pos.get(id);
    return { id, t, w, h: disc ? 62 : 54, r: w / 2, ...(p ? { x: p.x, y: p.y } : {}) };
  });
  const edges = [...links].filter(([, l]) => tickets.has(l.a) && tickets.has(l.b))
    .map(([id, l]) => ({ id, source: l.a, target: l.b, s: l.strength, c: l.comment || "" }));
  $("emptyStage").hidden = tickets.size > 0;

  // Focus mode lays the selected ticket out in the middle with its linked tickets in rings around it.
  if (selected && tickets.has(selected)) {
    const others = [...new Set(edges.flatMap(e => e.source === selected ? [e.target] : e.target === selected ? [e.source] : []))]
      .sort((x, y) => tickets.get(x).key.localeCompare(tickets.get(y).key, undefined, { numeric: true }));
    const lay = focusLayout(selected, others);
    for (const n of nodes) { const p = lay.get(n.id); if (p) { n.x = n.fx = p.x; n.y = n.fy = p.y; } }
  }

  gEdges.selectAll("g").remove();
  const edge = gEdges.selectAll("g").data(edges).join("g").attr("class", "edge-g")
    .on("click", (e, d) => { e.stopPropagation(); openRelation(d.id, selected === d.target ? d.target : d.source); });
  // Wide invisible line makes the edge easy to click.
  edge.append("line").attr("class", "hit").attr("stroke", "transparent").attr("stroke-width", 16);
  edge.append("line").attr("class", "vis").attr("stroke", d => bandColor(d.s)).attr("stroke-width", d => 2 + d.s * 0.35 + (d.id === selectedLink ? 3 : 0)).attr("stroke-linecap", "round");
  edge.append("circle").attr("class", "lbl").attr("r", 11).attr("fill", "var(--node-bg)").attr("stroke", d => d.id === selectedLink ? "var(--accent)" : bandColor(d.s)).attr("stroke-width", d => d.id === selectedLink ? 3 : 2);
  edge.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").style("fill", d => bandColor(d.s)).text(d => d.s);
  edge.filter(d => d.c).append("circle").attr("class", "cm").attr("r", 4.5).attr("fill", "var(--accent)").attr("stroke", "var(--node-bg)").attr("stroke-width", 1.5);
  edge.append("title").text(d => `${tickets.get(d.source).title} ↔ ${tickets.get(d.target).title}: ${d.s}/10${d.c ? "\n" + d.c : ""}`);

  gNodes.selectAll("g").remove();
  const node = gNodes.selectAll("g").data(nodes, d => d.id).join("g").attr("class", "node")
    .on("click", (e, d) => {
      e.stopPropagation();
      if (e.shiftKey && selected && selected !== d.id) addLink(selected, d.id, 0);
      else select(d.id);
    })
    .call(d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); if (!selected) { d.fx = null; d.fy = null; } }));

  node.each(function (d) {
    const g = d3.select(this), t = d.t, c = typeColor(t.type), sel = d.id === selected;
    const disc = isDiscipline(t);
    // Disciplines are hubs: pill-shaped and tinted so they stand out from content.
    g.append("rect").attr("x", -d.w / 2).attr("y", -d.h / 2).attr("width", d.w).attr("height", d.h).attr("rx", disc ? d.h / 2 : 7)
      .attr("fill", disc ? `color-mix(in srgb, ${c} 16%, var(--node-bg))` : "var(--node-bg)")
      .attr("stroke", sel ? "var(--accent)" : c).attr("stroke-width", sel ? 3 : disc ? 2.5 : 1.5);
    if (!disc) g.append("rect").attr("x", -d.w / 2).attr("y", -d.h / 2 + 7).attr("width", 4).attr("height", d.h - 14).attr("rx", 2).attr("fill", c);
    const left = -d.w / 2 + (disc ? 20 : 14);
    const p = progressOf(d.id), pct = p.total ? Math.round(p.done / p.total * 100) : null;
    g.append("text").attr("class", "k").attr("x", left).attr("y", -9).text(`${t.key} · ${trunc(t.props?.category || t.type, 14)}${pct === null ? "" : ` · ${pct}%`}`);
    g.append("text").attr("x", left).attr("y", 8).style("font-size", "13px").style("font-weight", 500).text(trunc(t.title, 24));
    if (p.total) {
      const bw = d.w / 2 - 14 - left;
      g.append("rect").attr("x", left).attr("y", 15).attr("width", bw).attr("height", 4).attr("rx", 2).attr("fill", "var(--line)");
      g.append("rect").attr("x", left).attr("y", 15).attr("width", bw * p.done / p.total).attr("height", 4).attr("rx", 2)
        .attr("fill", bandColor(Math.floor(p.done / p.total * 10)));
    }
    g.append("title").text(`${t.key} ${t.title}`);
  });

  if (selected) {
    const near = new Set([selected]);
    for (const e of edges) { if (e.source === selected) near.add(e.target); if (e.target === selected) near.add(e.source); }
    // Focus mode: show only the selected ticket and the tickets linked to it.
    node.classed("gone", d => !near.has(d.id));
    edge.classed("gone", d => d.source !== selected && d.target !== selected);
  }
  const ft = selected && tickets.get(selected);
  $("focusBar").hidden = !ft;
  if (ft) {
    const n = edges.filter(e => e.source === selected || e.target === selected).length;
    $("focusText").innerHTML = `Showing <span class="key">${esc(ft.key)}</span> ${esc(trunc(ft.title, 28))} and ${n} linked ${n === 1 ? "ticket" : "tickets"}`;
  }
  if (!selected && selectedLink) {
    const l = links.get(selectedLink);
    if (l) { node.classed("dim", d => d.id !== l.a && d.id !== l.b); edge.classed("dim", d => d.id !== selectedLink); }
  }

  sim.nodes(nodes);
  sim.force("link").links(edges.map(e => ({ ...e })));
  const refocus = (selected || "") !== lastFocus; lastFocus = selected || "";
  sim.alpha(nodes.some(n => !pos.has(n.id)) || refocus ? 0.6 : 0.12).restart();
}

function tick() {
  gNodes.selectAll("g").attr("transform", d => { pos.set(d.id, { x: d.x, y: d.y }); return `translate(${d.x},${d.y})`; });
  gEdges.selectAll("g").each(function (d) {
    const a = pos.get(d.source), b = pos.get(d.target); if (!a || !b) return;
    const g = d3.select(this);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    g.selectAll("line").attr("x1", a.x).attr("y1", a.y).attr("x2", b.x).attr("y2", b.y);
    g.select("circle.lbl").attr("cx", mx).attr("cy", my);
    g.select("circle.cm").attr("cx", mx + 9).attr("cy", my - 9);
    g.select("text").attr("x", mx).attr("y", my);
  });
}

function fit() {
  const b = root.node().getBBox(); if (!b.width) return;
  const r = svg.node().getBoundingClientRect();
  const k = Math.min(1.6, 0.85 * Math.min(r.width / b.width, r.height / b.height));
  svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.scale(k).translate(-(b.x + b.width / 2), -(b.y + b.height / 2)));
}
$("fitBtn").addEventListener("click", fit);
$("showAllBtn").addEventListener("click", () => select(null));

function render() {
  // Keep focus on an inspector field while re-rendering.
  const active = document.activeElement;
  const keepFocus = active && insp.contains(active) && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && active.type === "text"));
  renderTally();
  if (!keepFocus) renderInspector();
  $("graphView").hidden = view !== "graph";
  $("board").hidden = view !== "board";
  document.querySelectorAll(".views button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  const typingInBoard = active && colsEl.contains(active) && active.tagName === "INPUT";
  if (view === "board" && !typingInBoard) renderBoard();
  refreshRelation();
  renderGraph();
}

/* ---------- projects ---------- */
// A project is a folder (project.yaml + tickets/*.md). The picker lists the folders this app knows about.
let armedProject = null, newParent = null;
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }) : "";

async function showPicker() {
  closeRelation();
  projectId = null;
  window.tg.close();
  document.title = "Ticket Graph";
  $("picker").hidden = false;
  await renderProjectList();
  $("newProjectWhere").textContent = newParent || await window.tg.defaultRoot();
  $("newProjectName").focus();
}
async function renderProjectList() {
  const list = await window.tg.listProjects();
  $("projectList").innerHTML = list.length ? list.map(p => {
    const armed = armedProject === p.path;
    if (p.missing) return `<div class="proj"><div class="proj-open proj-missing"><span class="proj-name">${esc(p.name)}</span>
      <span class="proj-meta">Folder not found: ${esc(p.path)}</span></div>
      <button class="btn small" type="button" data-act="forget" data-id="${esc(p.path)}">Remove from list</button></div>`;
    const pct = p.linkCount ? Math.round(p.strengthSum / (p.linkCount * 10) * 100) : null;
    return `<div class="proj">
      <button class="proj-open" type="button" data-act="open" data-id="${esc(p.path)}">
        <span class="proj-name">${esc(p.name)}</span>
        ${p.description ? `<span class="proj-desc">${esc(p.description)}</span>` : ""}
        <span class="proj-meta">${p.ticketCount} tickets · ${p.linkCount} links${pct === null ? "" : ` · ${pct}% done`}${p.problems ? ` · ${p.problems} unreadable files` : ""} · updated ${fmtDate(p.updated)}</span>
        <span class="proj-path">${esc(p.path)}</span>
        ${pct === null ? "" : progressBar({ done: p.strengthSum, total: p.linkCount * 10 })}
      </button>
      <div class="proj-actions">
        <button class="btn small" type="button" data-act="reveal" data-id="${esc(p.path)}">Show folder</button>
        <button class="btn small ${armed ? "danger armed" : ""}" type="button" data-act="forget" data-id="${esc(p.path)}"
          title="Removes the project from this list. Its folder and files stay on disk.">${armed ? "Remove from list?" : "Remove"}</button>
      </div>
    </div>`;
  }).join("") : `<p class="hint">No projects yet. Create one, or open an existing project folder.</p>`;
}
$("projectList").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const dir = b.dataset.id;
  if (b.dataset.act === "open") openProject(dir);
  if (b.dataset.act === "reveal") window.tg.revealProject(dir);
  if (b.dataset.act === "forget") {
    if (armedProject === dir || b.closest(".proj").querySelector(".proj-missing")) { armedProject = null; await window.tg.removeProject(dir); }
    else armedProject = dir;
    renderProjectList();
  }
});
$("chooseParentBtn").addEventListener("click", async () => {
  const dir = await window.tg.chooseParent();
  if (dir) { newParent = dir; $("newProjectWhere").textContent = dir; }
});
$("newProjectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("newProjectName").value.trim(); if (!name) return;
  const dir = await window.tg.createProject({ name, description: $("newProjectDesc").value, parent: newParent });
  $("newProjectName").value = ""; $("newProjectDesc").value = "";
  openProject(dir);
});
$("openFolderBtn").addEventListener("click", async () => {
  $("openFolderMsg").textContent = "";
  try { const dir = await window.tg.openFolder(); if (dir) openProject(dir); }
  catch (err) { $("openFolderMsg").textContent = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); }
});

function applyData(data) {
  tickets.clear(); links.clear();
  for (const [id, body] of data.tickets) tickets.set(id, body);
  for (const [id, body] of data.links) links.set(id, body);
  boardCfg = { columns: {}, ...(data.settings.board || {}) };
  const b = $("banner");
  b.hidden = !data.problems.length;
  b.textContent = data.problems.length
    ? `${data.problems.length} file${data.problems.length === 1 ? "" : "s"} skipped: ` + data.problems.slice(0, 3).map(p => `${p.file} (${p.error})`).join("; ") + (data.problems.length > 3 ? "; …" : "")
    : "";
}
async function openProject(dir) {
  const data = await window.tg.load(dir);
  if (!data.project) { showPicker(); return; }
  projectId = dir;
  pos.clear();
  applyData(data);
  selected = null; selectedLink = null; armedDelete = false; lastFocus = "";
  $("projectName").value = data.project.name;
  document.title = `${data.project.name} · Ticket Graph`;
  $("picker").hidden = true;
  render();
  setTimeout(fit, 900);
}
$("backBtn").addEventListener("click", showPicker);
$("projectName").addEventListener("change", async (e) => {
  const name = e.target.value.trim(); if (!projectId || !name) return;
  await window.tg.updateProject(projectId, { name });
  document.title = `${name} · Ticket Graph`;
});
$("exportBtn").addEventListener("click", () => { if (projectId) window.tg.revealProject(projectId); });

// Pick up edits made outside the app (Claude, a text editor, git), keeping the current view.
async function reloadProject(dir) {
  if (!projectId) { if (!$("picker").hidden) renderProjectList(); return; }
  if (dir && dir !== projectId) return;
  const data = await window.tg.load(projectId);
  if (!data.project) { showPicker(); return; }
  applyData(data);
  if (selected && !tickets.has(selected)) selected = null;
  if (document.activeElement !== $("projectName")) $("projectName").value = data.project.name;
  render();
}
window.tg.onExternalChange(reloadProject);

/* ---------- boot ---------- */
sizeSvg();
render();
showPicker();
