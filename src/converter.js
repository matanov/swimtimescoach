/* SD3 course converter page (converter.html): DOM only.
   Parsing and conversion live in src/sd3convert.js (window.SD3Convert). */
(function(){
"use strict";
const X = window.SD3Convert;
const $ = id => document.getElementById(id);
const {FIELDS, CODE} = X;
const ORDER = ["SCM","SCY","LCM","NT"];

let state = {name:"", parsed:null, sample:true, outName:"", perEvent:{}, facPrev:{}};
let lastPlan = null;

const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const chip = c => `<span class="c ${c}">${c}</span>`;
const key = i => (i.secs == null || !CODE[i.course]) ? "NT" : i.course;
function fmtDate(d){
  if (!/^\d{8}$/.test(d)) return "";
  const dt = new Date(+d.slice(4), +d.slice(0,2) - 1, +d.slice(2,4));
  return isNaN(dt) ? "" : dt.toLocaleDateString(undefined, {day:"numeric", month:"short", year:"numeric"});
}
function decode(buf){
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return s;
}

/* ---------- step 2: what's in the file ---------- */
function renderStats(){
  const {meet:m, items:its} = state.parsed;
  const swimmers = new Set(its.filter(i => !i.relay).map(i => i.who)).size;
  const indiv = new Set(its.filter(i => !i.relay).map(i => i.li)).size;
  const relays = new Set(its.filter(i => i.relay).map(i => i.li)).size;
  const dates = [fmtDate(m.start), fmtDate(m.end)].filter(Boolean);
  $("meet").innerHTML = [
    ["Meet", esc(m.name || "(no meet record)")],
    ["Dates", esc(dates.length === 2 && dates[0] !== dates[1] ? dates.join(" – ") : (dates[0] || "–"))],
    ["Meet course", m.course ? chip(m.course) : "–"],
    ["File", esc(m.desc || "SDIF") + (m.software ? `<div class="small muted">${esc(m.software)}</div>` : "")],
    ["Team", esc(m.team || "–")]
  ].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("counts").innerHTML = [["Swimmers", swimmers], ["Individual entries", indiv], ["Relays", relays]]
    .map(([k, v]) => `<div><div class="k">${k}</div><div class="v big">${v}</div></div>`).join("");

  let bars = "";
  FIELDS.forEach((f, fi) => {
    const sel = its.filter(i => i.fi === fi); if (!sel.length) return;
    const cnt = {}; sel.forEach(i => cnt[key(i)] = (cnt[key(i)] || 0) + 1);
    bars += `<div class="bar-row"><span class="k">${f} · ${sel.length}</span><div class="bar">` +
      ORDER.filter(c => cnt[c]).map(c => `<span class="${c}" style="flex:${cnt[c]}" title="${c}: ${cnt[c]}">${cnt[c]}</span>`).join("") + `</div></div>`;
  });
  $("bars").innerHTML = bars || `<p class="muted">No times found. Is this an SDIF entries or results file?</p>`;

  const usedF = FIELDS.map((_, fi) => its.some(i => i.fi === fi));
  let h = `<thead><tr><th>Course</th><th>Type</th>${FIELDS.map((f, fi) => usedF[fi] ? `<th class="n">${f}</th>` : "").join("")}<th class="n">Total</th></tr></thead><tbody>`;
  for (const c of ORDER) for (const rel of [false, true]) {
    const sel = its.filter(i => i.relay === rel && key(i) === c); if (!sel.length) continue;
    h += `<tr><td>${chip(c)}</td><td>${rel ? "Relay" : "Individual"}</td>` +
      FIELDS.map((_, fi) => { if (!usedF[fi]) return ""; const n = sel.filter(i => i.fi === fi).length; return `<td class="n${n ? "" : " zero"}">${n}</td>`; }).join("") +
      `<td class="n"><b>${sel.length}</b></td></tr>`;
  }
  $("courseTbl").innerHTML = h + "</tbody>";

  const ev = {};
  its.forEach(i => { const e = ev[i.event] || (ev[i.event] = {d:i.dist, s:+i.stroke, c:{}}); const k = key(i); e.c[k] = (e.c[k] || 0) + 1; });
  $("eventTbl").innerHTML = `<thead><tr><th>Event</th>${ORDER.map(c => `<th class="n">${chip(c)}</th>`).join("")}</tr></thead><tbody>` +
    Object.entries(ev).sort((a, b) => a[1].s - b[1].s || a[1].d - b[1].d)
      .map(([n, e]) => `<tr><td>${esc(n)}</td>${ORDER.map(c => `<td class="n${e.c[c] ? "" : " zero"}">${e.c[c] || 0}</td>`).join("")}</tr>`).join("") + "</tbody>";

  const odd = its.filter(X.isUnusual);
  $("oddBox").innerHTML = odd.length ? `<div class="note"><b>Check ${odd.length} unusual time${odd.length > 1 ? "s" : ""}</b><span class="small">Pace is slower than 4:00 or faster than 0:40 per 100. Usually a typo in TeamUnify.</span>` +
    odd.map(i => `<span class="small"><span class="mono">line ${i.li + 1}</span> · ${esc(i.who)} · ${esc(i.event)} · ${FIELDS[i.fi]} <span class="mono">${esc(i.raw.trim())}</span> ${chip(i.course)}</span>`).join("") + `</div>` : "";
}

/* ---------- step 3: options ---------- */
const tgtNow = () => document.querySelector("input[name=tgt]:checked").value;
const methodNow = () => document.querySelector("input[name=method]:checked").value;
const mixedNow = () => $("mixed").checked;
/* Target settings only: default course plus per-event courses in a two-pool meet. */
const tgtOpts = () => ({tgt:tgtNow(), perEvent: mixedNow() ? state.perEvent : null});
const targetsUsed = () => {
  const o = tgtOpts(); if (!o.perEvent || !state.parsed) return [o.tgt];
  return [...new Set([o.tgt, ...X.events(state.parsed).map(e => X.targetOf(e, o))])];
};

/* Two-pool meet: one row per event with its own LCM / SCM switch. */
function renderEvents(){
  const on = mixedNow(), tgt = tgtNow();
  $("evBox").hidden = !on;
  $("tgtLabel").textContent = on ? "Default course" : "Make every time";
  $("meetTgtWord").textContent = on ? `default (${tgt})` : tgt;
  if (!on || !state.parsed) { $("evTgtTbl").innerHTML = ""; return; }
  const o = tgtOpts();
  $("evTgtTbl").innerHTML = `<thead><tr><th>Event</th><th>Times now</th><th>Make it</th></tr></thead><tbody>` +
    X.events(state.parsed).map(e => {
      const cur = X.targetOf(e, o);
      const now = ORDER.filter(c => e.counts[c]).map(c => `${chip(c)} <span class="small">${e.counts[c]}</span>`).join(" ");
      return `<tr class="${cur !== tgt ? "ev-other" : ""}"><td>${esc(e.event)}</td><td>${now}</td><td><div class="seg sm" role="radiogroup" aria-label="Course for ${esc(e.event)}">` +
        ["LCM","SCM"].map(c => `<label><input type="radio" name="ev${e.key}" value="${c}" data-ev="${e.key}"${cur === c ? " checked" : ""}><span>${c}</span></label>`).join("") +
        `</div></td></tr>`;
    }).join("") + "</tbody>";
}

function renderSrc(){
  const its = state.parsed ? state.parsed.items : [], tgt = tgtNow(), o = tgtOpts();
  const present = ["SCM","SCY","LCM"].filter(c => its.some(i => i.course === c && X.targetOf(i, o) !== c));
  const prev = {}; document.querySelectorAll("#srcChecks input").forEach(x => prev[x.value] = x.checked);
  $("srcChecks").innerHTML = present.length ? present.map(c => {
    const n = its.filter(i => i.course === c).length;
    return `<label><input type="checkbox" id="src${c}" value="${c}" ${prev[c] === false ? "" : "checked"}> ${chip(c)} <span class="muted small">${n}</span></label>`;
  }).join("") : `<span class="muted small">Every time is already ${o.perEvent ? "on its event's course" : tgt}.</span>`;
}

function renderCustom(){
  const box = $("customBox"), m = methodNow();
  $("fallbackRow").hidden = m !== "standard";
  box.hidden = !(m === "custom" || (m === "standard" && $("fFallback").checked));
  const defaults = {LCM:{SCM:1.02, SCY:1.13}, SCM:{LCM:0.98, SCY:1.11}};
  box.querySelectorAll("input").forEach(x => state.facPrev[x.id] = x.value);   // kept across target switches
  const tgts = targetsUsed();
  box.innerHTML = tgts.flatMap(tgt => ["SCM","SCY","LCM"].filter(c => c !== tgt).map(s => {
    const id = `fac${s}to${tgt}`, v = state.facPrev[id] ?? defaults[tgt][s];
    return `<div class="field"><label class="k" for="${id}">${s} → ${tgt} factor</label><input id="${id}" data-src="${s}" data-tgt="${tgt}" type="number" step="0.001" min="0.5" max="2" value="${v}"></div>`;
  }).concat(`<div class="field"><label class="k" for="cOff${tgt}">Add seconds per 100${tgts.length > 1 ? ` → ${tgt}` : ""}</label>` +
    `<input id="cOff${tgt}" data-off="${tgt}" type="number" step="0.01" value="${state.facPrev[`cOff${tgt}`] ?? 0}"></div>`)).join("");
}

function opts(){
  const srcs = {}; document.querySelectorAll("#srcChecks input").forEach(x => srcs[x.value] = x.checked);
  const fac = {}; document.querySelectorAll("#customBox input[data-src]").forEach(x => (fac[x.dataset.tgt] ||= {})[x.dataset.src] = parseFloat(x.value));
  const off = {}; document.querySelectorAll("#customBox input[data-off]").forEach(x => off[x.dataset.off] = parseFloat(x.value) || 0);
  return {...tgtOpts(), method:methodNow(),
    fields:[$("fSeed").checked, $("fPrelim").checked, $("fSwimoff").checked, $("fFinals").checked],
    srcs, fac, off, fallback:$("fFallback").checked, relays:$("fRelay").checked, meet:$("fMeet").checked};
}

/* ---------- step 4: preview ---------- */
function renderPreview(){
  if (!state.parsed || !state.parsed.items.length) {
    $("summary").innerHTML = ""; $("chgTbl").innerHTML = ""; $("warnBox").innerHTML = ""; $("dl").disabled = true; return;
  }
  const o = opts(), p = X.plan(state.parsed, o), m = state.parsed.meet; lastPlan = p;
  const altered = p.changes.filter(c => c.newRaw !== c.it.raw).length;
  $("summary").innerHTML =
    `<div><div class="k">Course codes changed</div><div class="v big">${p.changes.length}</div></div>` +
    `<div><div class="k">Times altered</div><div class="v big">${altered}</div></div>` +
    `<div><div class="k">Skipped</div><div class="v big">${p.skipped.length}</div></div>` +
    `<div><div class="k">Meet course</div><div class="v">${p.meetChange ? `${chip(m.course)} → ${chip(o.tgt)}` : (m.course ? chip(m.course) + " unchanged" : "–")}</div></div>`;
  let w = "";
  if (o.method === "relabel" && p.changes.length)
    w += `<div class="note info"><span class="small">Relabel only: times stay as swum. ${o.perEvent
      ? "Short course times labeled LCM will usually seed swimmers faster than they swim in a 50 m pool, and long course times labeled SCM slower."
      : o.tgt === "LCM"
      ? "Short course times labeled LCM will usually seed swimmers faster than they swim in a 50 m pool."
      : "Long course times labeled SCM will usually seed swimmers slower than their short course ability."}</span></div>`;
  const fb = p.changes.filter(c => c.how === "fallback").length;
  if (fb)
    w += `<div class="note info"><span class="small">${fb} time${fb > 1 ? "s" : ""} with no standard conversion converted with your custom factor (marked <i>custom</i>).</span></div>`;
  if (p.skipped.length)
    w += `<div class="note"><b>${p.skipped.length} skipped, left unchanged</b>` +
      p.skipped.map(s => `<span class="small"><span class="mono">line ${s.it.li + 1}</span> · ${esc(s.it.who)} · ${esc(s.it.event)} · ${FIELDS[s.it.fi]}: ${esc(s.why)}</span>`).join("") + `</div>`;
  $("warnBox").innerHTML = w;
  $("chgTbl").innerHTML = `<thead><tr><th class="n">Line</th><th>Swimmer</th><th>Event</th><th>Field</th><th class="n">Before</th><th></th><th class="n">After</th><th></th><th class="n">Δ s</th></tr></thead><tbody>` +
    (p.changes.length ? p.changes.map(c => {
      const d = (c.it.secs != null && c.newSecs != null) ? c.newSecs - c.it.secs : 0;
      return `<tr><td class="n mono">${c.it.li + 1}</td><td>${esc(c.it.who)}</td><td>${esc(c.it.event)}</td><td>${FIELDS[c.it.fi]}</td>` +
        `<td class="t">${esc(c.it.raw.trim() || "–")}</td><td>${chip(c.it.course)}</td><td class="t">${esc(c.newRaw.trim() || "–")}</td><td>${chip(c.tgt)}${c.how === "fallback" ? ` <span class="small muted">custom</span>` : ""}</td>` +
        `<td class="t ${d > 0 ? "delta-up" : d < 0 ? "delta-down" : "zero"}">${d ? (d > 0 ? "+" : "") + d.toFixed(2) : "0.00"}</td></tr>`;
    }).join("") : `<tr><td colspan="9" class="muted">Nothing to change with these options.</td></tr>`) + "</tbody>";
  const base = state.name.replace(/\.[^.]+$/, "") || "converted", ext = (state.name.match(/\.[^.]+$/) || [".sd3"])[0];
  state.outName = `${base}_${targetsUsed().length > 1 ? "mixed" : o.tgt}_${{relabel:"relabel", standard:"std", custom:"custom"}[o.method]}${ext}`;
  $("dlName").innerHTML = `<span class="mono">${esc(state.outName)}</span>`;
  $("dl").disabled = !(p.changes.length || p.meetChange);
  renderReport(o);
}

/* ---------- step 5: coach review report ---------- */
let lastReview = null;
const nowStamp = () => new Date().toLocaleString(undefined, {day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit"});
function customText(rv){
  const one = Object.keys(rv.fac).length < 2;
  return Object.entries(rv.fac).flatMap(([t, by]) => Object.entries(by).filter(([, f]) => f > 0)
      .map(([c, f]) => `${c} → ${t} × ${f}`)).join(", ") +
    Object.entries(rv.off).map(([t, v]) => `, ${v > 0 ? "+" : ""}${v} s per 100${one ? "" : ` (→ ${t})`}`).join("");
}
function methodText(rv){
  if (rv.method === "custom") return "Custom: " + customText(rv) + ", rounded to 0.01 s";
  return "Standard: Swim England equivalent-time formula, rounded to 0.1 s" +
    (rv.fallback ? `; events without one: custom ${customText(rv)}` : "");
}
const tcell = (t, strong) => t ? `<span class="${strong ? "rt strong" : "rt"}">${esc(t.time)}</span> <span class="rc">${esc(t.course)}</span>` : `<span class="rt muted">–</span>`;
/* "LCM", or for a two-pool meet "LCM, except SCM: 50 Free, 100 Breast". */
function proposedText(rv){
  if (!rv.mixed) return rv.tgt;
  const by = {}; rv.other.forEach(e => (by[e.tgt] ||= []).push(e.event));
  return `${rv.tgt}, except ` + Object.entries(by).map(([t, evs]) => `${t}: ${evs.join(", ")}`).join("; ");
}
function renderReport(o){
  const rv = X.review(state.parsed, o); lastReview = rv;
  const m = state.parsed.meet, k = rv.counts;
  const dates = [fmtDate(m.start), fmtDate(m.end)].filter(Boolean);
  const meta = [
    ["Team", esc(m.team || "–")],
    ["Meet dates", esc(dates.length === 2 && dates[0] !== dates[1] ? dates.join(" – ") : (dates[0] || "–"))],
    ["Meet course", m.course ? esc(m.course) + (rv.meetChange && o.meet ? ` → ${rv.tgt}` : "") : "–"],
    ["File", `<span class="mono">${esc(state.sample ? "built-in sample" : state.name)}</span>`],
    ["Proposed course", esc(proposedText(rv))],
    ["Converted column", esc(methodText(rv))],
    ["Prepared", esc(nowStamp())]
  ].map(([a, b]) => `<div><span class="k">${a}</span> ${b}</div>`).join("");
  const summary = [[k.total, "entries"], [k.change, rv.mixed ? "to change course" : `to change to ${rv.tgt}`], [k.same, rv.mixed ? "already on their course" : `already ${rv.tgt}`], [k.nt, "no time"],
    [k.fallback, "by custom factor"], [k.skipped, "no standard conversion"], [k.excluded, "not selected"], [k.unusual, "to check"]]
    .filter(([n], i) => i < 2 || n).map(([n, t]) => `<b>${n}</b> ${t}`).join(" · ");
  let body = "", group = null;
  for (const r of rv.rows) {
    const g = r.relay ? "Relays" : r.who;
    if (g !== group) {
      group = g;
      const sub = r.relay ? "" : [r.age && `age ${r.age}`, {F:"female", M:"male"}[r.sex]].filter(Boolean).join(", ");
      body += `<tr class="grp"><th colspan="8">${esc(g)}${sub ? ` <span class="muted">· ${esc(sub)}</span>` : ""}</th></tr>`;
    }
    const d = r.delta;
    body += `<tr class="st-${r.status}${r.unusual ? " odd" : ""}"><td class="tick"><span class="box"></span></td>` +
      `<td>${esc(r.relay ? `${r.event} (${r.who})` : r.event)}</td><td>${esc(r.field)}</td>` +
      `<td class="n">${tcell(r.orig)}</td><td class="n">${tcell(r.relabeled)}</td><td class="n">${tcell(r.converted, r.status === "change")}</td>` +
      `<td class="n mono ${d > 0 ? "delta-up" : d < 0 ? "delta-down" : ""}">${d == null ? "" : (d > 0 ? "+" : "") + d.toFixed(2)}</td>` +
      `<td class="note-c">${esc(r.note)}</td></tr>`;
  }
  $("report").innerHTML =
    `<div class="rep-head"><div class="rep-kicker">Entry review before submission</div><h3 class="rep-title">${esc(m.name || "Meet")}</h3>` +
    `<div class="rep-meta">${meta}</div><p class="rep-sum">${summary}</p></div>` +
    (rv.rows.length ? `<div class="rep-tbl"><table class="rep"><thead><tr><th class="tick">OK</th><th>Event</th><th>Field</th>` +
      `<th class="n">Original</th><th class="n">Relabeled</th><th class="n">Converted</th><th class="n">Change s</th><th>Note</th></tr></thead><tbody>${body}</tbody></table></div>`
      : `<p class="muted">No entries in the selected time fields.</p>`) +
    `<p class="rep-legend small muted">Original: as exported. Relabeled: same time, course code changed to ${esc(rv.mixed ? "the event's course" : rv.tgt)}. ` +
    `Converted: ${esc(methodText(rv))}. Tick OK for each entry you approve.</p>` +
    `<div class="rep-sign"><span>Reviewed by</span><span>Date</span><span>Signature</span></div>`;
  const base = state.name.replace(/\.[^.]+$/, "") || "entries";
  state.repBase = `${base}_review_${rv.mixed ? "mixed" : rv.tgt}`;
  $("repName").innerHTML = `<span class="mono">${esc(state.repBase)}.csv</span>`;
  $("repPrint").disabled = $("repCsv").disabled = !rv.rows.length;
}

function refresh(){ renderEvents(); renderSrc(); renderCustom(); renderPreview(); }

function load(text, name, isSample){
  $("loadErr").hidden = true;
  const parsed = X.parse(text);
  if (!parsed.items.length && !parsed.meet.name) {
    $("loadErr").hidden = false;
    $("loadErr").innerHTML = `<b>That file doesn't look like SDIF.</b><span class="small">No meet (B1) or entry (D0/E0) records found. Open the .sd3 or .cl2 file itself, not the .zip.</span>`;
    return;
  }
  state = {name, parsed, sample:isSample, outName:"", perEvent:{}, facPrev:state.facPrev || {}};
  $("fname").textContent = isSample ? "built-in example (fictional swimmers)" : name;
  $("srcBadge").textContent = isSample ? "Sample" : "Your file";
  $("srcBadge").className = "badge" + (isSample ? " sample" : "");
  (parsed.meet.course === "SCM" ? $("tgtSCM") : $("tgtLCM")).checked = true;
  renderStats(); refresh();
}

/* ---------- events ---------- */
function readFile(f){
  const r = new FileReader();
  r.onload = () => load(decode(r.result), f.name, false);
  r.onerror = () => { $("loadErr").hidden = false; $("loadErr").textContent = "Could not read that file."; };
  r.readAsArrayBuffer(f);
}
$("pick").addEventListener("click", () => $("file").click());
$("loadSample").addEventListener("click", () => load(X.sampleText(), "sample.sd3", true));
$("file").addEventListener("change", e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ""; });
const drop = $("cvDrop");
["dragenter","dragover"].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
document.addEventListener("dragleave", e => { if (e.target === document.documentElement || !e.relatedTarget) drop.classList.remove("over"); });
document.addEventListener("drop", e => {
  e.preventDefault(); drop.classList.remove("over");
  const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f);
});
const RESHAPE = "input[name=tgt],input[name=method],#mixed,#fFallback,input[data-ev]";   // these change which controls are shown
$("s3").addEventListener("input", e => { if (!e.target.matches(RESHAPE)) renderPreview(); });
$("s3").addEventListener("change", e => {
  if (e.target.matches("input[data-ev]")) state.perEvent[e.target.dataset.ev] = e.target.value;
  if (e.target.matches(RESHAPE)) refresh(); else renderPreview();
});
function saveFile(text, name, type){
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
$("repCsv").addEventListener("click", () => {
  if (!lastReview) return;
  saveFile("\uFEFF" + X.reviewCSV(lastReview), `${state.repBase}.csv`, "text/csv;charset=utf-8");   // BOM so Excel reads accents
  $("repName").innerHTML = `Saved <span class="mono">${esc(state.repBase)}.csv</span>`;
});
$("repPrint").addEventListener("click", () => {
  const title = document.title;
  document.title = state.repBase;                    // default PDF file name
  document.body.classList.add("print-report");
  window.print();
  document.title = title;
  document.body.classList.remove("print-report");
});
$("dl").addEventListener("click", () => {
  try {
    const out = X.build(state.parsed, lastPlan);
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    const url = URL.createObjectURL(new Blob([bytes], {type:"application/octet-stream"}));
    const a = document.createElement("a"); a.href = url; a.download = state.outName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $("dlName").innerHTML = `Saved <span class="mono">${esc(state.outName)}</span>`;
  } catch (err) { $("dlName").textContent = "Could not build the file: " + err.message; }
});

load(X.sampleText(), "sample.sd3", true);
})();
