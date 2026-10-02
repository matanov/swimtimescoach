/* UI: loading files, swimmer picker, best-times grid, print, CSV export, saved sessions, sharing. */
(() => {
"use strict";
// The downloadable app (swimtimescoach.html) is the share template with nothing filled
// in. It keeps a copy of its own page, before anything changes it, to make shared files
// from, since it can't load src/share-template.js like the website does.
const embeddedData = document.getElementById("sharedSession");
const isDownloadedApp = !!embeddedData && !/^[A-Za-z0-9+/=\s]+$/.test(embeddedData.textContent);
if (isDownloadedApp) {
  window.SHARE_TEMPLATE = "<!doctype html>\n" + document.documentElement.outerHTML;
  document.body.classList.replace("shared", "downloaded");
  document.getElementById("sharednote").remove();
  document.title = "Best Times";
}
// A shared file starts as "nojs" (static table whose times open their history with
// CSS only, see staticGrid) until scripts run; then the full app takes over.
document.documentElement.classList.remove("nojs");
document.getElementById("sdetails")?.remove();
const { parseCL2, fmt, norm, bestOf, bySwimOrder, assignPeople, labelMeets, listTeams,
        pairedDist, columnLabel, courseBests, trimToSwimmers, qualifyingChamp, STROKES, COURSE_ORDER } = window.CL2;
const { saveSession, readSession } = window.Session;

/* ------------------------------------------------------------------ state */
// sources: the loaded file texts, kept so a session can be saved and reopened
// view: "course" = a column per event per course; "event" = one column per event, SC and LC times stacked
// team: the app is for one team. When the files hold several, the user picks theirs (a team
// code) and everything shows only that team's swims; null when there's one team, or no pick.
// efsl: box times that meet an EFSL championship standard (src/standards-efsl.js)
const state = { files: [], swims: [], sources: [], selected: new Set(), people: new Map(), view: "course", team: null, efsl: false };
const seenText = new Set();

const teamSwims = () => state.team ? state.swims.filter(s => s.team === state.team) : state.swims;
function teamMeets(){
  const used = new Set(teamSwims().map(s => s.meet));
  return state.files.filter(m => used.has(m));
}
const teamName = code => { const t = listTeams(state.swims).find(t => t.code === code); return t ? t.name || "No team listed" : code; };

function rebuildPeople(){
  state.people = assignPeople(teamSwims());
  for (const k of [...state.selected]) if (!state.people.has(k)) state.selected.delete(k);
}

function decode(bytes){
  try { return new TextDecoder("utf-8", {fatal:true}).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

const fromBase64 = b64 => Uint8Array.from(atob(b64.trim()), c => c.charCodeAt(0));
function toBase64(bytes){
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// A page made with "Share as file" carries its swimmers as a base64 session zip.
// Returns those zip bytes, or null if buf isn't an HTML page.
function sharedSessionIn(buf){
  const head = decode(new Uint8Array(buf.slice(0, 64))).trimStart().toLowerCase();
  if (!head.startsWith("<!doctype html") && !head.startsWith("<html")) return null;
  const text = decode(new Uint8Array(buf)), marker = 'id="sharedSession">';
  const i = text.indexOf(marker);
  if (i < 0) throw new Error("this page has no shared results in it");
  return fromBase64(text.slice(i + marker.length, text.indexOf("<", i + marker.length)));
}

async function addFiles(fileList){
  const msg = document.getElementById("msg"); msg.textContent = "";
  const problems = [];
  const restored = [];
  let added = 0;
  for (const file of fileList) {
    try {
      const entries = [];   // [name, text]
      let buf = await file.arrayBuffer();
      const shared = sharedSessionIn(buf);
      if (shared) buf = shared.buffer;
      const head = new Uint8Array(buf.slice(0,2));
      let session = null;
      if (head[0] === 0x50 && head[1] === 0x4B) {
        if (typeof JSZip === "undefined") { problems.push(`${file.name}: zip support didn't load; unzip it and add the .cl2`); continue; }
        const zip = await JSZip.loadAsync(buf);
        session = await readSession(zip);
        if (session) {
          restored.push(session);
          for (const src of session.sources) entries.push([src.name, src.text]);
        } else {
          for (const name of Object.keys(zip.files)) {
            if (/\.(cl2|sd3)$/i.test(name) && !/(^|\/)(__MACOSX\/|\._)/.test(name)) entries.push([name, decode(await zip.files[name].async("uint8array"))]);
          }
          if (!entries.length) problems.push(`${file.name}: no .cl2 or .sd3 inside`);
        }
      } else entries.push([file.name, decode(new Uint8Array(buf))]);
      for (const [name, text] of entries) {
        if (seenText.has(text)) { if (!session) problems.push(`${name}: already loaded`); continue; }
        const parsed = parseCL2(text, name);
        if (!parsed.swims.length) { problems.push(`${name}: no individual results found`); continue; }
        if (state.team && !session && !parsed.swims.some(s => s.team === state.team)) problems.push(`${name}: no ${teamName(state.team)} swimmers in it`);
        seenText.add(text);
        state.sources.push({name, text});
        state.files.push(parsed.meet);
        state.swims.push(...parsed.swims);
        added++;
      }
    } catch (e) { problems.push(`${file.name}: ${e.message}`); }
  }
  if (problems.length) msg.textContent = problems.join(" · ");
  if (!added && !restored.length) return;
  if (added) labelMeets(state.files);
  const teams = listTeams(state.swims);
  for (const r of restored) if (r.team && teams.some(t => t.code === r.team)) state.team = r.team;
  if (teams.length < 2) state.team = null;
  else if (!teams.some(t => t.code === state.team)) return openTeamPicker(restored);
  finishLoad(restored);
}

// After loading (and picking a team, if needed): who's selected, which view, then draw.
function finishLoad(restored = []){
  rebuildPeople();
  for (const r of restored) {
    r.selected.forEach(k => { if (state.people.has(k)) state.selected.add(k); });
    if (r.appendix) $("appendixChk").checked = true;
    if (r.view) setView(r.view, false);
    if (r.efsl) setEfsl(true, false);
  }
  document.body.classList.toggle("with-appendix", $("appendixChk").checked);
  if (!state.selected.size) {
    if (state.people.size <= 15) state.people.forEach((_,k) => state.selected.add(k));
  }
  renderFiles(); render();
  if (!state.selected.size) openPicker();
}

/* ------------------------------------------------------------------ your team */
// Shown when the loaded files hold more than one team. Picking finishes the load;
// closing without picking (Esc) shows every team, with a link to pick later.
let awaitingTeam = null;   // restored sessions to apply once the dialog closes
function openTeamPicker(restored = []){
  const teams = listTeams(state.swims);
  $("teamCount").textContent = `These files have results from ${teams.length} teams. The table will show only your team's swimmers.`;
  $("teamList").innerHTML = teams.map((t, i) =>
    `<label><input type="radio" name="team" value="${esc(t.code)}" ${(state.team ? t.code === state.team : i === 0) ? "checked" : ""}> ${esc(t.name || "No team listed")} ` +
    `<small>${t.swimmers} swimmer${t.swimmers > 1 ? "s" : ""} · ${t.meets} meet${t.meets > 1 ? "s" : ""}</small></label>`).join("");
  awaitingTeam = restored;
  $("teamPick").showModal();
}
// Finishes directly rather than waiting for the dialog's close event, which can arrive late.
function closeTeamPicker(code){
  if (code && code !== state.team) { state.team = code; state.selected.clear(); }   // the other team's swimmers no longer apply
  const r = awaitingTeam; awaitingTeam = null;
  if ($("teamPick").open) $("teamPick").close();
  if (r) finishLoad(r);
}

async function saveSessionFile(){
  try {
    const bytes = await saveSession(JSZip, {sources: state.sources, selected: state.selected, appendix: $("appendixChk").checked, view: state.view, team: state.team, efsl: state.efsl});
    download(new Blob([bytes], {type:"application/zip"}), `best-times-session-${new Date().toISOString().slice(0,10)}.zip`);
  } catch (e) { $("msg").textContent = `Couldn't save the session: ${e.message}`; }
}

/* ------------------------------------------------------------------ share as file */
// The whole app as one HTML string, built by tools/build-share.js; loaded on first use.
function loadShareTemplate(){
  if (window.SHARE_TEMPLATE) return Promise.resolve(window.SHARE_TEMPLATE);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "src/share-template.js";
    s.onload = () => window.SHARE_TEMPLATE ? resolve(window.SHARE_TEMPLATE) : reject(new Error("the share template is empty"));
    s.onerror = () => reject(new Error("sharing isn't set up in this copy (run npm run build-share)"));
    document.head.append(s);
  });
}

// Previews (WhatsApp, Mail, Quick Look) often don't run scripts, so the shared file also
// works with HTML and CSS alone: each time is a <label> for a hidden radio button, and
// the checked radio's panel shows that swim history as a dialog. Closing checks "sh0".
function staticGrid(){
  const wrap = $("wrap").cloneNode(true), events = $("wrap")._events;
  let details = `<input type="radio" name="sh" id="sh0" class="sh" checked>`, n = 0;
  for (const b of wrap.querySelectorAll("button[data-ev]")) {
    const e = events.get(b.dataset.ev), p = state.people.get(b.dataset.p), list = e.by.get(b.dataset.p);
    const id = "sh" + ++n, label = document.createElement("label");
    label.htmlFor = id; label.className = "shcell"; label.innerHTML = b.innerHTML;
    b.replaceWith(label);
    details += `<input type="radio" name="sh" id="${id}" class="sh"><div class="shpanel"><label for="sh0" class="shback"></label>` +
      `<div class="shbox" role="dialog"><div class="dhead"><div><h2>${esc(eventTitle(e))}</h2><p>${esc(p.first)} ${esc(p.last)} — ${list.length} swim${list.length > 1 ? "s" : ""}</p></div>` +
      `<label for="sh0" class="btn">Close</label></div><div class="dbody">${historyTable(list, p)}</div></div></div>`;
  }
  return {wrap: wrap.innerHTML, details};
}

// One .html file with the app and only the selected swimmers, opened by tapping it.
async function shareFile(){
  try {
    if (!state.selected.size) throw new Error("choose at least one swimmer first");
    const template = await loadShareTemplate();
    render();   // the static table and swim list below must match the current selection
    const sources = state.sources.map(s => ({name: s.name, text: trimToSwimmers(s.text, state.selected, state.team)})).filter(s => s.text);
    const bytes = await saveSession(JSZip, {sources, selected: state.selected, appendix: $("appendixChk").checked, view: state.view, team: state.team, efsl: state.efsl});
    const today = new Date().toISOString().slice(0, 10);
    const parts = {
      date: esc(fmtDate(today)), data: toBase64(bytes),
      // the legend rides along with the meet line, since previews can't show the Columns bar
      files: meetList(labelMeets(sources.map(s => parseCL2(s.text, s.name).meet))) + (state.efsl ? `<p class="qlegend">${$("qlegend").innerHTML}</p>` : ""),
      ...staticGrid(),
    };
    // the placeholder pattern is split so this script's own text never matches it
    const html = template.replace(new RegExp("<" + "!--SHARE:(\\w+)--" + ">", "g"), (_, k) => parts[k] ?? "");
    const people = selectedPeople();
    const who = people.length === 1 ? ("-" + people[0].first + "-" + people[0].last).toLowerCase().replace(/[^a-z0-9-]+/g, "") : "";
    download(new Blob([html], {type: "text/html"}), `best-times${who}-${today}.html`);
  } catch (e) { $("msg").textContent = `Couldn't make the shared file: ${e.message}`; }
}

/* ------------------------------------------------------------------ rendering */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eventLabel = (dist, stroke) => `${dist} ${STROKES[stroke]}`;
const eventTitle = e => e.course ? `${e.label} ${e.course}` : e.label;
const noTime = list => list[0].time.dq ? "DQ" : (list[0].time.code || "—");
const fmtDate = d => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, {year:"numeric", month:"short", day:"numeric"}) : "";

// Collapsed to one line ("18 meets · Sep 6, 2025 – Feb 28, 2026") to save room on phones.
// <details> opens without scripts, so this works in shared-file previews too. When the
// files hold several teams, the line starts with yours and "Change team" sits inside.
function meetList(meets, open = false, team = ""){
  if (!meets.length) return "";
  const sorted = meets.slice().sort((a,b)=>(a.start||"").localeCompare(b.start||""));
  const dates = sorted.map(m => m.start).filter(Boolean);
  const span = !dates.length ? "" : " · " + fmtDate(dates[0]) + (dates.length > 1 && dates.at(-1) !== dates[0] ? " – " + fmtDate(dates.at(-1)) : "");
  return `<details class="meets"${open ? " open" : ""}><summary>${team ? `<b>${esc(team)}</b> · ` : ""}${sorted.length} meet${sorted.length > 1 ? "s" : ""}${esc(span)}</summary><div>` +
    sorted.map(m => `<span>${esc(m.datedLabel)}${m.start ? " (" + esc(fmtDate(m.start)) + ")" : ""}</span>`).join("") +
    (team ? `<button type="button" class="linkbtn teamchange" data-team-change>Change team</button>` : "") + `</div></details>`;
}

function renderFiles(){
  const el = document.getElementById("files");
  const teams = listTeams(state.swims);
  const team = teams.length < 2 ? "" : state.team ? teamName(state.team) : `All ${teams.length} teams`;
  el.innerHTML = meetList(teamMeets(), el.querySelector("details")?.open, team);   // keep it open if the user opened it
  const has = state.swims.length > 0;
  for (const id of ["pickBtn","printBtn","csvBtn","saveBtn","shareBtn","clearBtn"]) document.getElementById(id).disabled = !has;
  document.getElementById("drop").style.display = has ? "none" : "";
  document.getElementById("viewbar").hidden = !has;
}

function selectedPeople(){
  return [...state.selected].map(k => state.people.get(k)).filter(Boolean)
    .sort((a,b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}

function buildGrid(){
  const people = selectedPeople();
  const keys = new Set(people.map(p => p.key));
  const byEvent = state.view === "event";
  // events -> person -> swims; in event view course is null and all courses share a column
  const events = new Map();
  for (const s of teamSwims()) {
    if (!keys.has(s.pkey)) continue;
    const course = byEvent ? null : s.course, dist = byEvent ? pairedDist(s) : s.dist;
    const ek = `${course || "all"}|${s.stroke}|${String(dist).padStart(4,"0")}`;
    if (!events.has(ek)) events.set(ek, {course, stroke:s.stroke, dist, by:new Map(), dists:new Set()});
    const e = events.get(ek);
    e.dists.add(s.dist);
    if (!e.by.has(s.pkey)) e.by.set(s.pkey, []);
    e.by.get(s.pkey).push(s);
  }
  for (const e of events.values()) e.label = columnLabel(e.dists, e.stroke);
  const sorted = [...events.entries()].sort(([,a],[,b]) =>
    (COURSE_ORDER[a.course]||9) - (COURSE_ORDER[b.course]||9) ||
    a.stroke - b.stroke || a.dist - b.dist);
  return {people, events: sorted};
}

function render(){
  const wrap = document.getElementById("wrap");
  const {people, events} = buildGrid();
  if (!state.swims.length) { wrap.innerHTML = `<div class="empty">No results loaded yet.</div>`; return; }
  if (!people.length) { wrap.innerHTML = `<div class="empty">Choose one or more swimmers to build the table.</div>`; return; }
  const byEvent = state.view === "event";
  const courseName = c => ({SCY:"Short course yards", SCM:"Short course meters", LCM:"Long course meters"}[c] || "Course unknown");
  // a heavier left border where the course (course view) or stroke (event view) changes
  const groupOf = e => byEvent ? e.stroke : e.course;
  const starts = events.map(([, e], i) => i === 0 || groupOf(events[i-1][1]) !== groupOf(e));
  let h = `<table class="grid"><thead>`;
  if (!byEvent) {
    const groups = [];
    for (const [, e] of events) {
      const g = groups[groups.length-1];
      if (g && g.course === e.course) g.n++; else groups.push({course:e.course, n:1});
    }
    h += `<tr class="h1"><th class="sw" rowspan="2">Swimmer</th>`;
    for (const g of groups) h += `<th class="cg" colspan="${g.n}" scope="colgroup">${esc(courseName(g.course))}</th>`;
    h += `</tr>`;
  }
  h += `<tr class="h2">${byEvent ? `<th class="sw">Swimmer</th>` : ""}`;
  events.forEach(([, e], i) => { h += `<th scope="col" class="evh${starts[i] ? " gstart" : ""}">${esc(e.label)}</th>`; });
  h += `</tr></thead><tbody>`;
  for (const p of people) {
    h += `<tr><th class="sw" scope="row"><span class="fn">${esc(p.first)} ${esc(p.last)}</span><span class="tm">${esc([...p.teams].join(", "))}</span></th>`;
    events.forEach(([ek, e], i) => {
      const cls = starts[i] ? ` class="gstart"` : "";
      const list = e.by.get(p.key);
      if (!list) { h += `<td${cls}></td>`; return; }
      const b = bestOf(list);
      const times = byEvent ? stackedTimes(list, p) : b ? qbox(esc(fmt(b.time.cs)), b, p) : esc(noTime(list));
      h += `<td${cls}><button data-ev="${esc(ek)}" data-p="${esc(p.key)}" aria-label="All ${esc(eventTitle(e))} swims for ${esc(p.first)} ${esc(p.last)}">${times}${list.length > 1 ? `<span class="n">${list.length} swims</span>` : ""}</button></td>`;
    });
    h += `</tr>`;
  }
  h += `</tbody></table>`;
  wrap.innerHTML = h;
  wrap._events = new Map(events);
  const h1 = wrap.querySelector("tr.h1 th.cg");
  wrap.querySelector("table").style.setProperty("--h1", (h1 ? h1.offsetHeight : 0) + "px");
  renderPrintHead(); renderAppendix(people, events);
}

// Event view cell: the short-course best(s) then the long-course best, each with
// its course letter (24.51Y, 26.10S, 28.30L); a course with no swims shows —SC / —LC.
function stackedTimes(list, p){
  const {short, long} = courseBests(list);
  const line = (entries, missing) => entries.length
    ? entries.map(x => `<span class="ct">${x.best ? qbox(esc(fmt(x.best.time.cs)), x.best, p) : esc(noTime(x.swims))}<i>${x.letter}</i></span>`).join("")
    : `<span class="ct miss">${missing}</span>`;
  return line(short, "—SC") + line(long, "—LC");
}

// EFSL quals: a time that meets a championship standard, at the swimmer's latest age,
// gets a box: solid for Long Distance, dashed for Short Distance (styles.css .q).
const QUAL = {"long-distance": ["q-ld", "Long Distance"], "short-distance": ["q-sd", "Short Distance"]};
function qbox(html, s, p){
  const c = state.efsl && p ? qualifyingChamp(window.EFSL, s, p.lastAge, p.sex) : null;
  return c ? `<span class="q ${QUAL[c][0]}" title="Meets the EFSL ${QUAL[c][1]} standard for age ${p.lastAge}">${html}</span>` : html;
}
function setEfsl(on, rerender = true){
  state.efsl = !!on;
  $("efslChk").checked = state.efsl;
  $("qlegend").hidden = !state.efsl;
  if (rerender) render();
}

function setView(view, rerender = true){
  state.view = view === "event" ? "event" : "course";
  document.querySelectorAll("#viewbar [data-view]").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === state.view));
  if (rerender) render();
}

// Best is per course: yards and meters times aren't comparable.
function historyTable(list, p){
  const courses = [...new Set(list.map(s => s.course))];
  const bests = new Map(courses.map(c => [c, bestOf(list.filter(s => s.course === c))]));
  const showCourse = courses.length > 1;
  const showDist = new Set(list.map(s => s.dist)).size > 1;   // paired 400/500 etc.
  const sorted = list.slice().sort((a,b) => (COURSE_ORDER[a.course]||9) - (COURSE_ORDER[b.course]||9) || bySwimOrder(a,b));
  let h = `<table class="hist"><thead><tr><th>Date</th><th>Meet</th><th>Round</th>${showCourse ? "<th>Course</th>" : ""}<th>Time</th><th>Place</th><th>Age</th></tr></thead><tbody>`;
  for (const s of sorted) {
    const best = bests.get(s.course);
    const isBest = s === best;
    const t = s.time.cs != null ? qbox(esc(fmt(s.time.cs)), s, p) : esc(s.time.dq ? "DQ" : (s.time.code || s.time.raw));
    const diff = (!isBest && best && s.time.cs != null) ? ` <span style="color:var(--muted);font:400 .8rem Barlow">+${fmt(s.time.cs - best.time.cs)}</span>` : "";
    h += `<tr class="${isBest ? "best" : ""}"><td class="d">${esc(fmtDate(s.date))}</td><td>${esc(s.meet.label)}</td><td>${esc(s.round)}</td>${showCourse ? `<td>${showDist ? s.dist + " " : ""}${esc(s.course)}</td>` : ""}<td class="t">${t}${isBest ? `<span class="badge">Best</span>` : ""}${diff}</td><td>${s.place ?? ""}</td><td>${s.age ?? ""}</td></tr>`;
  }
  return h + `</tbody></table>`;
}

function openDetail(ek, pk){
  const e = document.getElementById("wrap")._events.get(ek);
  const p = state.people.get(pk);
  const list = e.by.get(pk);
  document.getElementById("dTitle").textContent = eventTitle(e);
  document.getElementById("dSub").textContent = `${p.first} ${p.last} — ${list.length} swim${list.length > 1 ? "s" : ""}`;
  document.getElementById("dBody").innerHTML = historyTable(list, p);
  document.getElementById("detail").showModal();
}

function renderPrintHead(){
  const people = selectedPeople();
  document.getElementById("phTitle").textContent = people.length === 1 ? `Best times: ${people[0].first} ${people[0].last}`
    : state.team ? `Best times: ${teamName(state.team)}` : "Best times";
  const meets = teamMeets().slice().sort((a,b)=>(a.start||"").localeCompare(b.start||""));
  document.getElementById("phMeets").textContent = `From ${meets.length} meet${meets.length>1?"s":""}: ` + meets.map(m => `${m.datedLabel}${m.start ? " (" + fmtDate(m.start) + ")" : ""}`).join("; ");
  document.getElementById("phQual").textContent = state.efsl ? "Boxed times meet EFSL 2025–2028 championship standards at each swimmer's latest age: solid = Long Distance, dashed = Short Distance." : "";
  document.getElementById("phDate").textContent = `Generated ${new Date().toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"})}`;
}

function renderAppendix(people, events){
  let h = "";
  for (const p of people) {
    let part = "";
    for (const [, e] of events) {
      const list = e.by.get(p.key);
      if (list) part += `<h3>${esc(eventTitle(e))}</h3>${historyTable(list, p)}`;
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
  const {people, events} = buildGrid();
  const q = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  // event view: an SC and an LC column per event, times carry their course letter
  const byEvent = state.view === "event";
  const lettered = xs => xs.filter(x => x.best).map(x => fmt(x.best.time.cs) + x.letter).join(" / ");
  const head = byEvent ? events.flatMap(([,e]) => [`${e.label} SC`, `${e.label} LC`]) : events.map(([,e]) => eventTitle(e));
  const cells = (e, p) => {
    const l = e.by.get(p.key);
    if (byEvent) { if (!l) return ["", ""]; const {short, long} = courseBests(l); return [lettered(short), lettered(long)]; }
    const b = l && bestOf(l); return [b ? fmt(b.time.cs) : ""];
  };
  const lines = [["Swimmer","Team", ...head].map(q).join(",")];
  for (const p of people) {
    lines.push([`${p.first} ${p.last}`, [...p.teams].join("; "), ...events.flatMap(([,e]) => cells(e, p))].map(q).join(","));
  }
  lines.push("");
  lines.push(["Swimmer","Course","Event","Date","Meet","Round","Time","Place","Age"].map(q).join(","));
  for (const p of people) for (const [, e] of events) for (const s of (e.by.get(p.key) || [])) {
    lines.push([`${p.first} ${p.last}`, s.course, eventLabel(s.dist,s.stroke), s.date, s.meet.label, s.round,
      s.time.cs != null ? fmt(s.time.cs) : (s.time.dq ? "DQ" : s.time.code), s.place, s.age].map(q).join(","));
  }
  download(new Blob([lines.join("\r\n")], {type:"text/csv"}), "best-times.csv");
}

function download(blob, filename){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ wiring */
const $ = id => document.getElementById(id);
$("addBtn").onclick = () => $("fileInput").click();
$("openBtn").onclick = () => $("fileInput").click();
$("saveBtn").onclick = saveSessionFile;
$("shareBtn").onclick = shareFile;
$("fileInput").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
$("pickBtn").onclick = openPicker;
const openHelp = () => $("help").showModal();
$("helpBtn").onclick = openHelp;
document.querySelectorAll("[data-help]").forEach(b => b.onclick = openHelp);
$("printBtn").onclick = () => { document.body.classList.toggle("with-appendix", $("appendixChk").checked); window.print(); };
$("csvBtn").onclick = downloadCSV;
$("clearBtn").onclick = () => { state.files = []; state.swims = []; state.sources = []; state.team = null; state.selected.clear(); state.people.clear(); seenText.clear(); $("msg").textContent = ""; renderFiles(); render(); };
$("teamOk").onclick = () => closeTeamPicker(document.querySelector("#teamList input:checked")?.value);
$("teamPick").addEventListener("close", () => closeTeamPicker());   // Esc: show every team
$("files").addEventListener("click", e => { if (e.target.closest("[data-team-change]")) openTeamPicker(); });
$("pkSearch").oninput = renderPicker;
$("pkTeam").onchange = renderPicker;
$("pkList").onchange = e => { if (e.target.type === "checkbox") { e.target.checked ? state.selected.add(e.target.value) : state.selected.delete(e.target.value); $("pkCount").textContent = `${state.selected.size} selected of ${state.people.size}`; } };
$("pkAll").onclick = () => { shownPeople().forEach(p => state.selected.add(p.key)); renderPicker(); };
$("pkNone").onclick = () => { shownPeople().forEach(p => state.selected.delete(p.key)); renderPicker(); };
$("picker").addEventListener("close", render);
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
document.querySelectorAll("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
$("wrap").addEventListener("click", e => { const b = e.target.closest("button[data-ev]"); if (b) openDetail(b.dataset.ev, b.dataset.p); });
document.querySelectorAll("#viewbar [data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));
$("efslChk").onchange = e => setEfsl(e.target.checked);
$("appendixChk").onchange = e => document.body.classList.toggle("with-appendix", e.target.checked);

const drop = $("drop");
["dragenter","dragover"].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
// relatedTarget is null when the drag leaves the window
["dragleave","drop"].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === "drop" || !e.relatedTarget) drop.classList.remove("over"); }));
document.addEventListener("drop", e => { if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });

// Opening a shared file (see shareFile) loads its swimmers straight away
if (isDownloadedApp) { renderFiles(); render(); }
else if (embeddedData) addFiles([new File([fromBase64(embeddedData.textContent)], "shared-session.zip")]);
})();
