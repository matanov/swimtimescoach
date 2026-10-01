/* UI: loading files, swimmer picker, best-times grid, print and CSV export. */
(() => {
"use strict";
const { parseCL2, fmt, norm, STROKES, STROKE_ORDER, COURSE_ORDER } = window.CL2;

/* ------------------------------------------------------------------ state */
const state = { files: [], swims: [], selected: new Set(), people: new Map() };
const seenText = new Set();

function rebuildPeople(){
  // Identity: normalized name; split same-name swimmers only if their USS IDs differ.
  const byName = new Map();
  for (const s of state.swims) {
    const nk = norm(s.swimmer.last) + "|" + norm(s.swimmer.first);
    s._nk = nk;
    if (!byName.has(nk)) byName.set(nk, new Set());
    if (s.swimmer.ussNew) byName.get(nk).add(s.swimmer.ussNew.toUpperCase());
  }
  const people = new Map();
  for (const s of state.swims) {
    const ids = byName.get(s._nk);
    const key = ids.size > 1 ? s._nk + "|" + (s.swimmer.ussNew.toUpperCase() || "?") : s._nk;
    s.pkey = key;
    let p = people.get(key);
    if (!p) { p = {key, last:s.swimmer.last, first:s.swimmer.pref || s.swimmer.first, teams:new Set(), sex:s.swimmer.sex, count:0, lastAge:null, lastDate:""}; people.set(key, p); }
    p.teams.add(s.teamName); p.count++;
    if (s.swimmer.pref) p.first = s.swimmer.pref;
    if ((s.date||"") >= p.lastDate) { p.lastDate = s.date || ""; p.lastAge = s.age; }
  }
  state.people = people;
  for (const k of [...state.selected]) if (!people.has(k)) state.selected.delete(k);
}

async function addFiles(fileList){
  const msg = document.getElementById("msg"); msg.textContent = "";
  const problems = [];
  let added = 0;
  for (const file of fileList) {
    try {
      const entries = [];
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0,2));
      if (head[0] === 0x50 && head[1] === 0x4B) {
        if (typeof JSZip === "undefined") { problems.push(`${file.name}: zip support didn't load; unzip it and add the .cl2`); continue; }
        const zip = await JSZip.loadAsync(buf);
        for (const name of Object.keys(zip.files)) {
          if (/\.(cl2|sd3)$/i.test(name)) entries.push([name, await zip.files[name].async("uint8array")]);
        }
        if (!entries.length) problems.push(`${file.name}: no .cl2 or .sd3 inside`);
      } else entries.push([file.name, new Uint8Array(buf)]);
      for (const [name, bytes] of entries) {
        let text;
        try { text = new TextDecoder("utf-8", {fatal:true}).decode(bytes); }
        catch { text = new TextDecoder("windows-1252").decode(bytes); }
        if (seenText.has(text)) { problems.push(`${name}: already loaded`); continue; }
        const parsed = parseCL2(text, name);
        if (!parsed.swims.length) { problems.push(`${name}: no individual results found`); continue; }
        seenText.add(text);
        state.files.push(parsed.meet);
        state.swims.push(...parsed.swims);
        added++;
      }
    } catch (e) { problems.push(`${file.name}: ${e.message}`); }
  }
  if (problems.length) msg.textContent = problems.join(" · ");
  if (!added) return;
  rebuildPeople();
  if (!state.selected.size) {
    if (state.people.size <= 15) state.people.forEach((_,k) => state.selected.add(k));
  }
  renderFiles(); render();
  if (!state.selected.size) openPicker();
}

/* ------------------------------------------------------------------ rendering */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eventLabel = (dist, stroke) => `${dist} ${STROKES[stroke]}`;
const fmtDate = d => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, {year:"numeric", month:"short", day:"numeric"}) : "";

function renderFiles(){
  const el = document.getElementById("files");
  el.innerHTML = state.files.slice().sort((a,b)=>(a.start||"").localeCompare(b.start||""))
    .map(m => `<span>${esc(m.name || m.file)}${m.start ? " (" + esc(fmtDate(m.start)) + ")" : ""}</span>`).join("");
  const has = state.swims.length > 0;
  for (const id of ["pickBtn","printBtn","csvBtn","clearBtn"]) document.getElementById(id).disabled = !has;
  document.getElementById("drop").style.display = has ? "none" : "";
}

function selectedPeople(){
  return [...state.selected].map(k => state.people.get(k)).filter(Boolean)
    .sort((a,b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}

function buildGrid(){
  const cols = selectedPeople();
  const colKeys = new Set(cols.map(p => p.key));
  // events -> person -> swims
  const events = new Map();
  for (const s of state.swims) {
    if (!colKeys.has(s.pkey)) continue;
    const ek = `${s.course}|${s.stroke}|${String(s.dist).padStart(4,"0")}`;
    if (!events.has(ek)) events.set(ek, {course:s.course, stroke:s.stroke, dist:s.dist, by:new Map()});
    const e = events.get(ek);
    if (!e.by.has(s.pkey)) e.by.set(s.pkey, []);
    e.by.get(s.pkey).push(s);
  }
  const rows = [...events.entries()].sort(([,a],[,b]) =>
    (COURSE_ORDER[a.course]||9) - (COURSE_ORDER[b.course]||9) ||
    STROKE_ORDER[a.stroke] - STROKE_ORDER[b.stroke] || a.dist - b.dist);
  return {cols, rows};
}
const bestOf = list => list.filter(s => s.time.cs != null).reduce((b,s) => (!b || s.time.cs < b.time.cs) ? s : b, null);

function render(){
  const wrap = document.getElementById("wrap");
  const {cols: people, rows: events} = buildGrid();
  if (!state.swims.length) { wrap.innerHTML = `<div class="empty">No results loaded yet.</div>`; return; }
  if (!people.length) { wrap.innerHTML = `<div class="empty">Choose one or more swimmers to build the table.</div>`; return; }
  const courseName = c => ({SCY:"Short course yards", SCM:"Short course meters", LCM:"Long course meters"}[c] || "Course unknown");
  // group consecutive events by course for the top header row
  const groups = [];
  for (const [, e] of events) {
    const g = groups[groups.length-1];
    if (g && g.course === e.course) g.n++; else groups.push({course:e.course, n:1});
  }
  let h = `<table class="grid"><thead><tr class="h1"><th class="ev" rowspan="2">Swimmer</th>`;
  for (const g of groups) h += `<th class="cg" colspan="${g.n}" scope="colgroup">${esc(courseName(g.course))}</th>`;
  h += `</tr><tr class="h2">`;
  events.forEach(([, e], i) => {
    const first = i === 0 || events[i-1][1].course !== e.course;
    h += `<th scope="col" class="evh${first ? " gstart" : ""}">${esc(eventLabel(e.dist, e.stroke))}</th>`;
  });
  h += `</tr></thead><tbody>`;
  for (const p of people) {
    h += `<tr><th class="ev" scope="row"><span class="fn">${esc(p.first)} ${esc(p.last)}</span><span class="tm">${esc([...p.teams][0] || "")}</span></th>`;
    events.forEach(([ek, e], i) => {
      const first = i === 0 || events[i-1][1].course !== e.course;
      const cls = first ? ` class="gstart"` : "";
      const list = e.by.get(p.key);
      if (!list) { h += `<td${cls}></td>`; return; }
      const b = bestOf(list);
      const label = b ? fmt(b.time.cs) : (list[0].time.dq ? "DQ" : (list[0].time.code || "—"));
      h += `<td${cls}><button data-ev="${esc(ek)}" data-p="${esc(p.key)}" aria-label="All ${esc(eventLabel(e.dist,e.stroke))} ${esc(e.course)} swims for ${esc(p.first)} ${esc(p.last)}">${esc(label)}${list.length > 1 ? `<span class="n">${list.length} swims</span>` : ""}</button></td>`;
    });
    h += `</tr>`;
  }
  h += `</tbody></table>`;
  wrap.innerHTML = h;
  wrap._rows = new Map(events);
  const h1 = wrap.querySelector("tr.h1 th.cg");
  if (h1) wrap.querySelector("table").style.setProperty("--h1", h1.offsetHeight + "px");
  renderPrintHead(); renderAppendix(people, events);
}

function historyTable(list){
  const best = bestOf(list);
  const sorted = list.slice().sort((a,b) => (a.date||"").localeCompare(b.date||"") || a.round.localeCompare(b.round));
  let h = `<table class="hist"><thead><tr><th>Date</th><th>Meet</th><th>Round</th><th>Time</th><th>Place</th><th>Age</th></tr></thead><tbody>`;
  for (const s of sorted) {
    const isBest = s === best;
    const t = s.time.cs != null ? fmt(s.time.cs) : (s.time.dq ? "DQ" : (s.time.code || s.time.raw));
    const diff = (!isBest && best && s.time.cs != null) ? ` <span style="color:var(--muted);font:400 .8rem Barlow">+${fmt(s.time.cs - best.time.cs)}</span>` : "";
    h += `<tr class="${isBest ? "best" : ""}"><td class="d">${esc(fmtDate(s.date))}</td><td>${esc(s.meet.name || s.meet.file)}</td><td>${esc(s.round)}</td><td class="t">${esc(t)}${isBest ? `<span class="badge">Best</span>` : ""}${diff}</td><td>${s.place ?? ""}</td><td>${s.age ?? ""}</td></tr>`;
  }
  return h + `</tbody></table>`;
}

function openDetail(ek, pk){
  const e = document.getElementById("wrap")._rows.get(ek);
  const p = state.people.get(pk);
  const list = e.by.get(pk);
  document.getElementById("dTitle").textContent = `${eventLabel(e.dist, e.stroke)} ${e.course}`;
  document.getElementById("dSub").textContent = `${p.first} ${p.last} — ${list.length} swim${list.length > 1 ? "s" : ""}`;
  document.getElementById("dBody").innerHTML = historyTable(list);
  document.getElementById("detail").showModal();
}

function renderPrintHead(){
  const cols = selectedPeople();
  document.getElementById("phTitle").textContent = cols.length === 1 ? `Best times: ${cols[0].first} ${cols[0].last}` : "Best times";
  const meets = state.files.slice().sort((a,b)=>(a.start||"").localeCompare(b.start||""));
  document.getElementById("phMeets").textContent = `From ${meets.length} meet${meets.length>1?"s":""}: ` + meets.map(m => `${m.name || m.file}${m.start ? " (" + fmtDate(m.start) + ")" : ""}`).join("; ");
  document.getElementById("phDate").textContent = `Generated ${new Date().toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"})}`;
}

function renderAppendix(cols, rows){
  let h = "";
  for (const p of cols) {
    let part = "";
    for (const [, e] of rows) {
      const list = e.by.get(p.key);
      if (list) part += `<h3>${esc(eventLabel(e.dist, e.stroke))} ${esc(e.course)}</h3>${historyTable(list)}`;
    }
    if (part) h += `<h2>${esc(p.first)} ${esc(p.last)}</h2>${part}`;
  }
  document.getElementById("appendix").innerHTML = h;
}

/* ------------------------------------------------------------------ picker */
function openPicker(){
  const teamSel = document.getElementById("pkTeam");
  const teams = [...new Set([...state.people.values()].flatMap(p => [...p.teams]))].sort();
  const cur = teamSel.value;
  teamSel.innerHTML = `<option value="">All teams</option>` + teams.map(t => `<option ${t===cur?"selected":""}>${esc(t)}</option>`).join("");
  renderPicker();
  document.getElementById("picker").showModal();
  document.getElementById("pkSearch").focus();
}
function shownPeople(){
  const q = norm(document.getElementById("pkSearch").value);
  const team = document.getElementById("pkTeam").value;
  return [...state.people.values()]
    .filter(p => (!team || p.teams.has(team)) && (!q || norm(p.first + p.last).includes(q) || norm(p.last + p.first).includes(q)))
    .sort((a,b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}
function renderPicker(){
  const list = shownPeople();
  document.getElementById("pkList").innerHTML = list.map(p =>
    `<label><input type="checkbox" value="${esc(p.key)}" ${state.selected.has(p.key) ? "checked" : ""}> ${esc(p.last)}, ${esc(p.first)} <small>${esc([...p.teams].join(", "))}${p.lastAge ? " · age " + p.lastAge : ""}</small></label>`
  ).join("") || `<div class="empty">No swimmers match.</div>`;
  document.getElementById("pkCount").textContent = `${state.selected.size} selected of ${state.people.size}`;
}

/* ------------------------------------------------------------------ CSV */
function downloadCSV(){
  const {cols, rows} = buildGrid();
  const q = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const lines = [["Swimmer","Team", ...rows.map(([,e]) => `${eventLabel(e.dist, e.stroke)} ${e.course}`)].map(q).join(",")];
  for (const p of cols) {
    lines.push([`${p.first} ${p.last}`, [...p.teams].join("; "), ...rows.map(([,e]) => { const l = e.by.get(p.key); const b = l && bestOf(l); return b ? fmt(b.time.cs) : ""; })].map(q).join(","));
  }
  lines.push("");
  lines.push(["Swimmer","Course","Event","Date","Meet","Round","Time","Place","Age"].map(q).join(","));
  for (const p of cols) for (const [, e] of rows) for (const s of (e.by.get(p.key) || [])) {
    lines.push([`${p.first} ${p.last}`, e.course, eventLabel(e.dist,e.stroke), s.date, s.meet.name, s.round,
      s.time.cs != null ? fmt(s.time.cs) : (s.time.dq ? "DQ" : s.time.code), s.place, s.age].map(q).join(","));
  }
  const blob = new Blob([lines.join("\r\n")], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "best-times.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ wiring */
const $ = id => document.getElementById(id);
$("addBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
$("pickBtn").onclick = openPicker;
$("printBtn").onclick = () => { document.body.classList.toggle("with-appendix", $("appendixChk").checked); window.print(); };
$("csvBtn").onclick = downloadCSV;
$("clearBtn").onclick = () => { state.files = []; state.swims = []; state.selected.clear(); state.people.clear(); seenText.clear(); $("msg").textContent = ""; renderFiles(); render(); };
$("pkSearch").oninput = renderPicker;
$("pkTeam").onchange = renderPicker;
$("pkList").onchange = e => { if (e.target.type === "checkbox") { e.target.checked ? state.selected.add(e.target.value) : state.selected.delete(e.target.value); $("pkCount").textContent = `${state.selected.size} selected of ${state.people.size}`; } };
$("pkAll").onclick = () => { shownPeople().forEach(p => state.selected.add(p.key)); renderPicker(); };
$("pkNone").onclick = () => { shownPeople().forEach(p => state.selected.delete(p.key)); renderPicker(); };
$("picker").addEventListener("close", render);
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
document.querySelectorAll("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
$("wrap").addEventListener("click", e => { const b = e.target.closest("button[data-ev]"); if (b) openDetail(b.dataset.ev, b.dataset.p); });
$("appendixChk").onchange = e => document.body.classList.toggle("with-appendix", e.target.checked);

const drop = $("drop");
["dragenter","dragover"].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === "drop" || e.target === drop) drop.classList.remove("over"); }));
document.addEventListener("drop", e => { if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });
})();
