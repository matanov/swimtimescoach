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
        pairedDist, columnLabel, courseBests, trimToSwimmers, standardFor, nearStandards, qualifiedEvents, qualifiedRows,
        ageAt, ageAtChamp, maskIds, checkBirth, STROKES, COURSE_ORDER } = window.CL2;
const { saveSession, readSession } = window.Session;

/* ------------------------------------------------------------------ state */
// sources: the loaded file texts, kept so a session can be saved and reopened
// view: "course" = a column per event per course; "event" = one column per event, SC and LC times stacked
// team: the app is for one team. When the files hold several, the user picks theirs (a team
// code) and everything shows only that team's swims; null when there's one team, or no pick.
// efsl: box times that meet an EFSL championship standard (src/standards-efsl.js)
// champDates: championship dates the user changed ({id: "YYYY-MM-DD"}); ages are taken on each one's first day.
// sharedAges: {person key: {championship id: age}} from a shared file, whose IDs carry no birth dates.
const state = { files: [], swims: [], sources: [], selected: new Set(), people: new Map(), view: "course", team: null, efsl: false,
                champDates: {}, sharedAges: null, births: {} };   // births: entered by hand, {person key: "YYYY-MM-DD"}
const seenText = new Set();

const teamSwims = () => state.team ? state.swims.filter(s => s.team === state.team) : state.swims;
function teamMeets(){
  const used = new Set(teamSwims().map(s => s.meet));
  return state.files.filter(m => used.has(m));
}
const teamName = code => { const t = listTeams(state.swims).find(t => t.code === code); return t ? t.name || "No team listed" : code; };

function rebuildPeople(){
  state.people = assignPeople(teamSwims());
  if (state.sharedAges) for (const p of state.people.values()) if (state.sharedAges[p.key]) p.champAges = state.sharedAges[p.key];
  // birth dates entered by hand fill in for swimmers whose results have none
  for (const p of state.people.values()) if (!p.birth && state.births[p.key]) { p.birth = state.births[p.key]; p.birthEntered = true; }
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
  for (const r of restored) {
    Object.assign(state.champDates, r.champDates || {});
    Object.assign(state.births, r.births || {});
    if (r.champAges) state.sharedAges = {...state.sharedAges, ...r.champAges};
  }
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
    const bytes = await saveSession(JSZip, {sources: state.sources, selected: state.selected, appendix: $("appendixChk").checked, view: state.view, team: state.team, efsl: state.efsl, champDates: state.champDates, births: state.births});
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
    const trimmed = state.sources.map(s => ({name: s.name, text: trimToSwimmers(s.text, state.selected, state.team)})).filter(s => s.text);
    // stand-in IDs: no birth dates leave in the file; it carries each swimmer's age at the championships instead
    const masked = maskIds(trimmed.map(s => s.text));
    const sources = trimmed.map((s, i) => ({name: s.name, text: masked.texts[i]}));
    const champAges = {};
    for (const p of selectedPeople()) if (ageAtChamp(p))
      champAges[masked.key(p.key)] = Object.fromEntries(window.EFSL.championships.map(c => [c.id, ageAt(p, c, state.champDates)]));
    const bytes = await saveSession(JSZip, {sources, selected: [...state.selected].map(masked.key), appendix: $("appendixChk").checked,
      view: state.view, team: state.team, efsl: state.efsl, champDates: state.champDates, champAges});
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
  // events qualified in either course ("pkey|dist|stroke"): their other-course times show no gap
  qcache = new Map();
  state.qualified = state.efsl ? qualifiedEvents(window.EFSL, teamSwims(), state.people, state.champDates) : new Set();
  const missing = selectedPeople().filter(p => !ageAtChamp(p)).length;
  $("qmissing").innerHTML = missing ? ` · <span class="agechip">no birth date</span> ${missing} swimmer${missing === 1 ? "" : "s"} judged at latest age` : "";
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
    h += `<tr><th class="sw" scope="row"><span class="fn">${esc(p.first)} ${esc(p.last)}</span><span class="tm">${esc([...p.teams].join(", "))}</span>${state.efsl ? champAgeLine(p) : ""}</th>`;
    events.forEach(([ek, e], i) => {
      const cls = starts[i] ? ` class="gstart"` : "";
      const list = e.by.get(p.key);
      if (!list) { h += `<td${cls}></td>`; return; }
      const b = bestOf(list);
      const times = byEvent ? stackedTimes(list, p) : b ? qbox(esc(fmt(b.time.cs)), b, p) + qgap(b, p) : esc(noTime(list));
      h += `<td${cls}><button data-ev="${esc(ek)}" data-p="${esc(p.key)}" aria-label="All ${esc(eventTitle(e))} swims for ${esc(p.first)} ${esc(p.last)}">${times}${list.length > 1 ? `<span class="n">${list.length} swims</span>` : ""}</button></td>`;
    });
    h += `</tr>`;
  }
  h += `</tbody></table>`;
  wrap.innerHTML = h;
  wrap._events = new Map(events);
  const h1 = wrap.querySelector("tr.h1 th.cg");
  wrap.querySelector("table").style.setProperty("--h1", (h1 ? h1.offsetHeight : 0) + "px");
  renderPrintHead();
  // the every-swim list is print-only and big, so it's built when printing (printAppendix)
  lastGrid = {people, events}; $("appendix").innerHTML = "";
}
let lastGrid = null;
function printAppendix(){
  if ($("appendixChk").checked && lastGrid && !$("appendix").innerHTML) renderAppendix(lastGrid.people, lastGrid.events);
}

// Event view cell: the short-course best(s) then the long-course best, each with
// its course letter (24.51Y, 26.10S, 28.30L); a course with no swims shows —SC / —LC.
function stackedTimes(list, p){
  const {short, long} = courseBests(list);
  const line = (entries, missing) => entries.length
    ? entries.map(x => `<span class="ct">${x.best ? qbox(esc(fmt(x.best.time.cs)), x.best, p) : esc(noTime(x.swims))}<i>${x.letter}</i>${x.best ? qgap(x.best, p) : ""}</span>`).join("")
    : `<span class="ct miss">${missing}</span>`;
  return line(short, "—SC") + line(long, "—LC");
}

// EFSL quals, judged at the swimmer's latest age. A time that meets a championship
// standard gets a box (qbox); one that doesn't gets the time still to drop (qgap),
// e.g. "−0.84", underlined the same way: solid = Long Distance, dashed = Short Distance.
const QUAL = {"long-distance": ["ld", "Long Distance"], "short-distance": ["sd", "Short Distance"]};
// one lookup per swim per render: qbox and qgap both ask (the cache is reset in render)
let qcache = new Map();
const qstd = (s, p) => {
  if (!state.efsl || !p) return null;
  if (!qcache.has(s)) qcache.set(s, standardFor(window.EFSL, s, c => ageAt(p, c, state.champDates), p.sex));
  return qcache.get(s);
};
const qage = (q, p) => `age ${q.age}${ageAtChamp(p) ? " at champs" : ""}`;
function qbox(html, s, p){
  const q = qstd(s, p);
  return q && q.meets ? `<span class="q q-${QUAL[q.champ][0]}" title="Meets the EFSL ${QUAL[q.champ][1]} standard of ${fmt(q.standard)} (${s.course}, ${qage(q, p)})">${html}</span>` : html;
}
function qgap(s, p){
  if (state.qualified?.has(`${s.pkey}|${s.dist}|${s.stroke}`)) return "";   // qualifying is per event, in either course
  const q = qstd(s, p);
  return q && !q.meets ? ` <span class="gap g-${QUAL[q.champ][0]}" title="${fmt(q.gap)} s to the EFSL ${QUAL[q.champ][1]} standard of ${fmt(q.standard)} (${s.course}, ${qage(q, p)})">−${fmt(q.gap)}</span>` : "";
}
// The age each swimmer is judged at, under their name when EFSL quals is on: "13 at champs",
// or "12 at LD · 13 at SD" across a birthday. Without a birth date, an amber label says
// the latest age in the results is used (it may be a year too young by the championship).
const NOBIRTH = "No birth date in the results (newer USS IDs don't contain one), so the latest age in the results is used. By the championship the swimmer may be a year older.";
// The amber label is a button: tapping it opens the birth date window (openBirth).
const noBirthChip = (p, text = `age ${p.lastAge ?? "?"}? · no birth date`) =>
  `<button type="button" class="agechip" data-birth="${esc(p.key)}" title="${esc(NOBIRTH)} Tap to enter the birth date.">${esc(text)}</button>`;
function champAgeLine(p){
  if (!ageAtChamp(p)) return noBirthChip(p);
  const entered = p.birthEntered ? ` <button type="button" class="linkbtn agefix" data-birth="${esc(p.key)}" title="Age from a birth date you entered. Tap to change it.">entered</button>` : "";
  const ages = window.EFSL.championships.map(c => [QUAL[c.id][0].toUpperCase(), ageAt(p, c, state.champDates)]);
  const txt = new Set(ages.map(a => a[1])).size === 1 ? `${ages[0][1]} at champs` : ages.map(([k, a]) => `${a} at ${k}`).join(" · ");
  return `<span class="champage" title="Age on the first day of each championship (${esc(champDatesText())})">${txt}${entered}</span>`;
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
    const t = s.time.cs != null ? qbox(esc(fmt(s.time.cs)), s, p) + qgap(s, p) : esc(s.time.dq ? "DQ" : (s.time.code || s.time.raw));
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
  document.getElementById("phQual").textContent = state.efsl ? `EFSL 2025–2028 championship standards at each swimmer's age on the first day of the championship (${champDatesText()}). Boxed times qualify; other times show the time still to drop (e.g. −0.84). Solid = Long Distance, dashed = Short Distance.` : "";
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

/* ------------------------------------------------------------------ EFSL reports */
// Two reports for the selected swimmers, one section per championship, printed on their own:
// "Qualified" (qualifiedRows: qualifying times with their standards) and "Close to
// qualifying" (nearStandards: best times within N % of a standard not met yet).
let reportMode = "qualified";
const nearPct = () => { const v = parseFloat($("nearPct").value); return v > 0 ? Math.min(v, 50) : 5; };
const reportRows = () => {
  const people = new Map(selectedPeople().map(p => [p.key, p]));
  return reportMode === "qualified" ? qualifiedRows(window.EFSL, teamSwims(), people, state.champDates)
    : nearStandards(window.EFSL, teamSwims(), people, nearPct(), state.champDates);
};
function swimmerCell(p, r, extra = ""){
  return `<b>${esc(p.first)} ${esc(p.last)}</b> <span class="near-age">${r.age ?? ""}${p.sex ? " " + esc(p.sex) : ""}</span>` +
    (ageAtChamp(p) ? "" : " " + noBirthChip(p, "no birth date")) + extra;
}
function nearReport(){
  const qual = reportMode === "qualified", rows = reportRows(), pct = nearPct(), people = selectedPeople(), meets = teamMeets();
  const dates = meets.map(m => m.start).filter(Boolean).sort();
  const span = dates.length ? fmtDate(dates[0]) + (dates.at(-1) !== dates[0] ? " – " + fmtDate(dates.at(-1)) : "") : "";
  const who = [state.team ? teamName(state.team) : [...new Set(people.flatMap(p => [...p.teams]))].join(", "),
    `${meets.length} meet${meets.length === 1 ? "" : "s"}${span ? ", " + span : ""}`,
    `${people.length} swimmer${people.length === 1 ? "" : "s"}`,
    `generated ${new Date().toLocaleDateString(undefined, {year:"numeric", month:"short", day:"numeric"})}`].filter(Boolean).join(" · ");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let h = `<div class="near-rep"><div class="near-kicker">EFSL 2025–2028 championships</div>` +
    `<h2>${qual ? "Qualified swimmers" : `Close to qualifying: within ${esc(String(pct))}%`}</h2><p class="near-meta">${esc(who)}</p>` +
    `<p class="near-meta">Each swimmer's best SCM and LCM time per event, against the standard for their age on the championship's first day (${esc(champDatesText())}). ` +
    (people.some(p => !ageAtChamp(p)) ? `Swimmers marked <span class="agechip">no birth date</span> are judged at their latest age in the results, as their results have no birth date. ` : "") +
    (qual ? `A time equal to the standard qualifies. Swimmers who qualified in both courses have both times listed.</p>` : `Events already qualified in either course aren't listed.</p>`);
  if (!people.length) return h + `<p class="empty">Choose swimmers first.</p></div>`;
  for (const c of window.EFSL.championships) {
    const mine = rows.filter(r => r.champ === c.id), cls = QUAL[c.id][0];
    const swimmers = new Set(mine.map(r => r.person.key)).size, events = new Set(mine.map(r => `${r.person.key}|${r.swim.dist}|${r.swim.stroke}`)).size;
    h += `<h3 class="near-champ near-${cls}"><span class="q q-${cls}">${esc(QUAL[c.id][1])} Champs</span> ` +
      (qual ? (mine.length ? `${plural(swimmers, "swimmer")}, ${plural(events, "qualifying event")}` : "no qualifiers yet")
            : (mine.length ? `${plural(mine.length, "time")}, ${plural(swimmers, "swimmer")}` : "none within " + esc(String(pct)) + "%")) + `</h3>`;
    if (!mine.length) continue;
    h += qual ? `<table class="hist near"><thead><tr><th>Swimmer</th><th>Event</th><th>Course</th><th>Qualifying time</th><th>Standard</th><th>Under by</th><th>Swum at</th></tr></thead><tbody>`
              : `<table class="hist near"><thead><tr><th>Swimmer</th><th>Event</th><th>Course</th><th>Best</th><th>Standard</th><th>To drop</th><th>%</th><th>Swum at</th></tr></thead><tbody>`;
    let last = null, lastEvent = null;
    for (const r of mine) {
      const p = r.person, s = r.swim, first = p.key !== last, ev = `${p.key}|${s.dist}|${s.stroke}`, newEvent = ev !== lastEvent;
      last = p.key; lastEvent = ev;
      const nEvents = new Set(mine.filter(x => x.person.key === p.key).map(x => `${x.swim.dist}|${x.swim.stroke}`)).size;
      h += `<tr class="${first ? "near-first" : ""}"><td>${first ? swimmerCell(p, r, qual ? ` <span class="near-age">· ${plural(nEvents, "event")}</span>` : "") : ""}</td>` +
        `<td>${!qual || newEvent ? esc(eventLabel(s.dist, s.stroke)) : ""}</td><td>${esc(s.course)}</td>` +
        (qual ? `<td class="t"><span class="q q-${cls}">${esc(fmt(s.time.cs))}</span></td><td class="t">${esc(fmt(r.standard))}</td><td class="t">${r.margin ? esc(fmt(r.margin)) : "equal"}</td>`
              : `<td class="t">${esc(fmt(s.time.cs))}</td><td class="t">${esc(fmt(r.standard))}</td><td class="t"><span class="gap g-${cls}">−${esc(fmt(r.gap))}</span></td><td class="t">${r.gapPct.toFixed(1)}%</td>`) +
        `<td class="d">${esc(s.meet.label)}, ${esc(fmtDate(s.date))}</td></tr>`;
    }
    h += `</tbody></table>`;
  }
  return h + `</div>`;
}
function renderNear(){
  document.querySelectorAll("#repMode [data-rep]").forEach(b => b.setAttribute("aria-pressed", b.dataset.rep === reportMode));
  $("nearPctBox").hidden = reportMode !== "near";
  $("nearSub").textContent = reportMode === "qualified" ? "Swimmers who have qualified, with their qualifying times and the standards."
    : "Best times that haven't met an EFSL standard yet but are close to it.";
  $("nearBody").innerHTML = nearReport();
}
// Championship dates: defaults from the standards (first day of each), changeable here.
const champDate = c => state.champDates[c.id] || c.date;
const champDatesText = () => window.EFSL.championships.map(c => `${QUAL[c.id][1]} ${fmtDate(champDate(c))}`).join(", ");
/* ------------------------------------------------------------------ birth dates entered by hand */
// For swimmers whose results have no birth date (newer USS IDs). Only used to work out
// ages at the championships: kept in saved sessions, never shown, printed or shared.
let birthKey = null;
function openBirth(key){
  const p = state.people.get(key); if (!p) return;
  birthKey = key;
  $("bdTitle").textContent = `Birth date: ${p.first} ${p.last}`;
  $("bdInput").value = state.births[key] || "";
  $("bdMsg").textContent = ""; $("bdClear").hidden = !state.births[key];
  $("birthDlg").showModal();
}
// Saves after checking it against the ages in the results; returns an error message or "".
function setBirth(key, value){
  const p = state.people.get(key); if (!p) return "";
  if (!value) { delete state.births[key]; }
  else {
    const bad = checkBirth(value, teamSwims().filter(s => s.pkey === key));
    if (bad) return bad.error ? "That isn't a valid date." :
      `That date makes ${p.first} ${bad.implied} on ${fmtDate(bad.date)}, but the results say ${bad.age}. Check the date.`;
    state.births[key] = value;
  }
  rebuildPeople(); render();
  if ($("near").open) { renderNear(); renderNearDates(); }
  return "";
}
function birthSummary(need){
  const missing = need.filter(p => !p.birthEntered).length, entered = need.length - missing, n = k => `${k} swimmer${k === 1 ? "" : "s"}`;
  return missing ? `${n(missing)} without a birth date${entered ? ` · ${entered} entered` : ""}` : `Birth dates entered for ${n(entered)}`;
}
function renderNearDates(){
  $("nearDates").innerHTML = `<span class="k">Championship dates (ages on the first day)</span>` +
    window.EFSL.championships.map(c => `<label>${esc(QUAL[c.id][1])} <input type="date" data-champ="${esc(c.id)}" value="${esc(champDate(c))}"></label>`).join("") +
    (Object.keys(state.champDates).length ? `<button type="button" class="linkbtn" id="datesReset">Reset</button>` : "");
  // swimmers whose results have no birth date, in a collapsed list (stays open across re-renders once opened)
  const need = selectedPeople().filter(p => !p.birth || p.birthEntered);
  const open = $("nearBirths").querySelector("details")?.open;
  $("nearBirths").innerHTML = !need.length ? "" :
    `<details${open ? " open" : ""}><summary>${birthSummary(need)}</summary>` +
    `<p class="small">Enter a birth date to judge them at their age on the championship's first day. It's kept in your saved session only, never shown or shared.</p>` +
    need.map(p => `<label class="bd-row"><span>${esc(p.first)} ${esc(p.last)} <span class="near-age">latest age ${p.lastAge ?? "?"}</span></span>` +
      `<input type="date" data-birth-input="${esc(p.key)}" value="${esc(state.births[p.key] || "")}"><span class="bd-err" data-birth-err="${esc(p.key)}"></span></label>`).join("") +
    `</details>`;
}
function setChampDate(id, value){
  const c = window.EFSL.championships.find(c => c.id === id);
  if (!c) return;
  if (!value || value === c.date) delete state.champDates[id]; else state.champDates[id] = value;
  render(); renderNear(); renderNearDates();
}
function openNear(){ renderNearDates(); renderNear(); $("near").showModal(); }
function printNear(){
  $("nearPrint").innerHTML = nearReport();
  document.body.classList.add("print-near");
  $("near").close();
  window.print();
  document.body.classList.remove("print-near");
  $("nearPrint").innerHTML = "";
}
function nearCSV(){
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  if (reportMode === "qualified") {
    const out = [["Championship","Swimmer","Age at champs","Age from","Sex","Event","Course","Qualifying time","Standard","Under by (s)","Meet","Date"].map(q).join(",")];
    for (const r of reportRows()) out.push([QUAL[r.champ][1], `${r.person.first} ${r.person.last}`, r.age, ageAtChamp(r.person) ? "birth date" : "latest result", r.person.sex,
      eventLabel(r.swim.dist, r.swim.stroke), r.swim.course, fmt(r.swim.time.cs), fmt(r.standard), r.margin ? fmt(r.margin) : "0.00",
      r.swim.meet.label, r.swim.date].map(q).join(","));
    return download(new Blob([out.join("\r\n")], {type:"text/csv"}), "efsl-qualified.csv");
  }
  const lines = [["Championship","Swimmer","Age at champs","Age from","Sex","Event","Course","Best","Standard","To drop (s)","To drop (%)","Meet","Date"].map(q).join(",")];
  for (const r of reportRows()) lines.push([QUAL[r.champ][1], `${r.person.first} ${r.person.last}`, r.age, ageAtChamp(r.person) ? "birth date" : "latest result", r.person.sex,
    eventLabel(r.swim.dist, r.swim.stroke), r.swim.course, fmt(r.swim.time.cs), fmt(r.standard), fmt(r.gap), r.gapPct.toFixed(1),
    r.swim.meet.label, r.swim.date].map(q).join(","));
  download(new Blob([lines.join("\r\n")], {type:"text/csv"}), `close-to-qualifying-${nearPct()}pct.csv`);
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
$("printBtn").onclick = () => { document.body.classList.toggle("with-appendix", $("appendixChk").checked); printAppendix(); window.print(); };
window.addEventListener("beforeprint", printAppendix);   // Cmd+P / the browser's own Print
$("csvBtn").onclick = downloadCSV;
$("clearBtn").onclick = () => { state.files = []; state.swims = []; state.sources = []; state.team = null; state.sharedAges = null; state.births = {}; state.selected.clear(); state.people.clear(); seenText.clear(); $("msg").textContent = ""; renderFiles(); render(); };
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
$("nearBtn").onclick = openNear;
$("nearPct").oninput = renderNear;
$("repMode").addEventListener("click", e => { const b = e.target.closest("[data-rep]"); if (b) { reportMode = b.dataset.rep; renderNear(); } });
// birth dates: the amber labels (table and report), the window, and the list in Close to qualifying
document.addEventListener("click", e => { const b = e.target.closest("[data-birth]"); if (b) { e.preventDefault(); openBirth(b.dataset.birth); } });
$("bdSave").onclick = () => { const err = setBirth(birthKey, $("bdInput").value); if (err) $("bdMsg").textContent = err; else $("birthDlg").close(); };
$("bdClear").onclick = () => { setBirth(birthKey, ""); $("birthDlg").close(); };
$("nearBirths").addEventListener("change", e => {
  const k = e.target.dataset.birthInput; if (!k) return;
  const err = setBirth(k, e.target.value);
  const box = [...$("nearBirths").querySelectorAll("[data-birth-err]")].find(x => x.dataset.birthErr === k);
  if (box) box.textContent = err;
});
$("nearDates").addEventListener("change", e => { if (e.target.dataset.champ) setChampDate(e.target.dataset.champ, e.target.value); });
$("nearDates").addEventListener("click", e => { if (e.target.id === "datesReset") { state.champDates = {}; render(); renderNear(); renderNearDates(); } });
$("nearPrintBtn").onclick = printNear;
$("nearCsv").onclick = nearCSV;
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
