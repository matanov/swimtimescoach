/* SD3 course converter page (converter.html): DOM only.
   Parsing and conversion live in src/sd3convert.js (window.SD3Convert). */
(function(){
"use strict";
const X = window.SD3Convert;
const $ = id => document.getElementById(id);
const {FIELDS, CODE} = X;
const ORDER = ["SCM","SCY","LCM","NT"];

let state = {name:"", parsed:null, sample:true, outName:""};
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

  const odd = its.filter(i => !i.relay && i.secs != null && i.dist > 0)
    .filter(i => { const pace = i.secs / (i.dist / 100); return pace > 240 || pace < 40; });
  $("oddBox").innerHTML = odd.length ? `<div class="note"><b>Check ${odd.length} unusual time${odd.length > 1 ? "s" : ""}</b><span class="small">Pace is slower than 4:00 or faster than 0:40 per 100. Usually a typo in TeamUnify.</span>` +
    odd.map(i => `<span class="small"><span class="mono">line ${i.li + 1}</span> · ${esc(i.who)} · ${esc(i.event)} · ${FIELDS[i.fi]} <span class="mono">${esc(i.raw.trim())}</span> ${chip(i.course)}</span>`).join("") + `</div>` : "";
}

/* ---------- step 3: options ---------- */
const tgtNow = () => document.querySelector("input[name=tgt]:checked").value;
const methodNow = () => document.querySelector("input[name=method]:checked").value;

function renderSrc(){
  const its = state.parsed ? state.parsed.items : [], tgt = tgtNow();
  const present = ["SCM","SCY","LCM"].filter(c => c !== tgt && its.some(i => i.course === c));
  const prev = {}; document.querySelectorAll("#srcChecks input").forEach(x => prev[x.value] = x.checked);
  $("srcChecks").innerHTML = present.length ? present.map(c => {
    const n = its.filter(i => i.course === c).length;
    return `<label><input type="checkbox" id="src${c}" value="${c}" ${prev[c] === false ? "" : "checked"}> ${chip(c)} <span class="muted small">${n}</span></label>`;
  }).join("") : `<span class="muted small">Every time is already ${tgt}.</span>`;
}

function renderCustom(){
  const box = $("customBox"), tgt = tgtNow();
  box.hidden = methodNow() !== "custom";
  const defaults = {LCM:{SCM:1.02, SCY:1.13}, SCM:{LCM:0.98, SCY:1.11}};
  const prev = {}; box.querySelectorAll("input[data-src]").forEach(x => prev[x.id] = x.value);
  const prevOff = ($("cOffset") || {}).value;
  box.innerHTML = ["SCM","SCY","LCM"].filter(c => c !== tgt).map(s => {
    const id = `fac${s}to${tgt}`, v = prev[id] ?? defaults[tgt][s];
    return `<div class="field"><label class="k" for="${id}">${s} → ${tgt} factor</label><input id="${id}" data-src="${s}" type="number" step="0.001" min="0.5" max="2" value="${v}"></div>`;
  }).join("") + `<div class="field"><label class="k" for="cOffset">Add seconds per 100</label><input id="cOffset" type="number" step="0.01" value="${prevOff ?? 0}"></div>`;
}

function opts(){
  const srcs = {}; document.querySelectorAll("#srcChecks input").forEach(x => srcs[x.value] = x.checked);
  const fac = {}; document.querySelectorAll("#customBox input[data-src]").forEach(x => fac[x.dataset.src] = parseFloat(x.value));
  return {tgt:tgtNow(), method:methodNow(),
    fields:[$("fSeed").checked, $("fPrelim").checked, $("fSwimoff").checked, $("fFinals").checked],
    srcs, fac, off:parseFloat(($("cOffset") || {}).value) || 0, relays:$("fRelay").checked, meet:$("fMeet").checked};
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
    w += `<div class="note info"><span class="small">Relabel only: times stay as swum. ${o.tgt === "LCM"
      ? "Short course times labeled LCM will usually seed swimmers faster than they swim in a 50 m pool."
      : "Long course times labeled SCM will usually seed swimmers slower than their short course ability."}</span></div>`;
  if (p.skipped.length)
    w += `<div class="note"><b>${p.skipped.length} skipped, left unchanged</b>` +
      p.skipped.map(s => `<span class="small"><span class="mono">line ${s.it.li + 1}</span> · ${esc(s.it.who)} · ${esc(s.it.event)} · ${FIELDS[s.it.fi]}: ${esc(s.why)}</span>`).join("") + `</div>`;
  $("warnBox").innerHTML = w;
  $("chgTbl").innerHTML = `<thead><tr><th class="n">Line</th><th>Swimmer</th><th>Event</th><th>Field</th><th class="n">Before</th><th></th><th class="n">After</th><th></th><th class="n">Δ s</th></tr></thead><tbody>` +
    (p.changes.length ? p.changes.map(c => {
      const d = (c.it.secs != null && c.newSecs != null) ? c.newSecs - c.it.secs : 0;
      return `<tr><td class="n mono">${c.it.li + 1}</td><td>${esc(c.it.who)}</td><td>${esc(c.it.event)}</td><td>${FIELDS[c.it.fi]}</td>` +
        `<td class="t">${esc(c.it.raw.trim() || "–")}</td><td>${chip(c.it.course)}</td><td class="t">${esc(c.newRaw.trim() || "–")}</td><td>${chip(o.tgt)}</td>` +
        `<td class="t ${d > 0 ? "delta-up" : d < 0 ? "delta-down" : "zero"}">${d ? (d > 0 ? "+" : "") + d.toFixed(2) : "0.00"}</td></tr>`;
    }).join("") : `<tr><td colspan="9" class="muted">Nothing to change with these options.</td></tr>`) + "</tbody>";
  const base = state.name.replace(/\.[^.]+$/, "") || "converted", ext = (state.name.match(/\.[^.]+$/) || [".sd3"])[0];
  state.outName = `${base}_${o.tgt}_${{relabel:"relabel", standard:"std", custom:"custom"}[o.method]}${ext}`;
  $("dlName").innerHTML = `<span class="mono">${esc(state.outName)}</span>`;
  $("dl").disabled = !(p.changes.length || p.meetChange);
  renderReport(o);
}

/* ---------- step 5: coach review report ---------- */
let lastReview = null;
const nowStamp = () => new Date().toLocaleString(undefined, {day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit"});
function methodText(rv){
  if (rv.method === "custom")
    return "Custom: " + Object.entries(rv.fac).filter(([, f]) => f > 0).map(([c, f]) => `${c} × ${f}`).join(", ") +
      (rv.off ? `, ${rv.off > 0 ? "+" : ""}${rv.off} s per 100` : "");
  return "Standard: Swim England equivalent-time formula";
}
const tcell = (t, strong) => t ? `<span class="${strong ? "rt strong" : "rt"}">${esc(t.time)}</span> <span class="rc">${esc(t.course)}</span>` : `<span class="rt muted">–</span>`;
function renderReport(o){
  const rv = X.review(state.parsed, o); lastReview = rv;
  const m = state.parsed.meet, k = rv.counts;
  const dates = [fmtDate(m.start), fmtDate(m.end)].filter(Boolean);
  const meta = [
    ["Team", esc(m.team || "–")],
    ["Meet dates", esc(dates.length === 2 && dates[0] !== dates[1] ? dates.join(" – ") : (dates[0] || "–"))],
    ["Meet course", m.course ? esc(m.course) + (rv.meetChange && o.meet ? ` → ${rv.tgt}` : "") : "–"],
    ["File", `<span class="mono">${esc(state.sample ? "built-in sample" : state.name)}</span>`],
    ["Proposed course", esc(rv.tgt)],
    ["Converted column", esc(methodText(rv))],
    ["Prepared", esc(nowStamp())]
  ].map(([a, b]) => `<div><span class="k">${a}</span> ${b}</div>`).join("");
  const summary = [[k.total, "entries"], [k.change, `to change to ${rv.tgt}`], [k.same, `already ${rv.tgt}`], [k.nt, "no time"],
    [k.skipped, "no standard conversion"], [k.excluded, "not selected"], [k.unusual, "to check"]]
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
    `<p class="rep-legend small muted">Original: as exported. Relabeled: same time, course code changed to ${esc(rv.tgt)}. ` +
    `Converted: ${esc(methodText(rv))}, rounded to the hundredth. Tick OK for each entry you approve.</p>` +
    `<div class="rep-sign"><span>Reviewed by</span><span>Date</span><span>Signature</span></div>`;
  const base = state.name.replace(/\.[^.]+$/, "") || "entries";
  state.repBase = `${base}_review_${rv.tgt}`;
  $("repName").innerHTML = `<span class="mono">${esc(state.repBase)}.csv</span>`;
  $("repPrint").disabled = $("repCsv").disabled = !rv.rows.length;
}

function refresh(){ renderSrc(); renderCustom(); renderPreview(); }

function load(text, name, isSample){
  $("loadErr").hidden = true;
  const parsed = X.parse(text);
  if (!parsed.items.length && !parsed.meet.name) {
    $("loadErr").hidden = false;
    $("loadErr").innerHTML = `<b>That file doesn't look like SDIF.</b><span class="small">No meet (B1) or entry (D0/E0) records found. Open the .sd3 or .cl2 file itself, not the .zip.</span>`;
    return;
  }
  state = {name, parsed, sample:isSample, outName:""};
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
document.querySelectorAll("input[name=tgt],input[name=method]").forEach(x => x.addEventListener("change", refresh));
$("s3").addEventListener("input", renderPreview);
$("s3").addEventListener("change", e => { if (!e.target.matches("input[name=tgt],input[name=method]")) renderPreview(); });
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
