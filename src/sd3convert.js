/*
 * SD3 course converter: relabel or convert SCM / SCY / LCM times in an
 * SDIF v3 file (TeamUnify .sd3 entries, Hy-Tek .cl2 results).
 *
 * Only the 8-character time fields and their course codes are rewritten;
 * every other byte, line length and line ending is kept.
 * Positions are the spec's 1-based columns (docs/sdif-v3-notes.md).
 *
 * Works in the browser (window.SD3Convert) and in Node (require) for tests.
 */
(function (root) {
"use strict";

const COURSE = {"1":"SCM","S":"SCM","s":"SCM","2":"SCY","Y":"SCY","y":"SCY","3":"LCM","L":"LCM","l":"LCM"};
const CODE = {SCM:["1","S"], SCY:["2","Y"], LCM:["3","L"]};      // [digit style, letter style]
const STROKE = {"1":"Free","2":"Back","3":"Breast","4":"Fly","5":"IM","6":"Free Relay","7":"Medley Relay"};
const FIELDS = ["Seed","Prelim","Swim-off","Finals"];
// time field start column and its course column, per record type
const LAYOUT = {
  D0:{t:[[89,97],[98,106],[107,115],[116,124]], dist:68, stroke:72},
  E0:{t:[[46,54],[55,63],[64,72],[73,81]],     dist:22, stroke:26}
};
const MEET_COURSE_COL = 150;   // B1

/* Swim England equivalent-time constants: turn factor per event, and the
   pool measure for yards pools. Key = distance + stroke code. */
const TF = {"501":42.245,"1001":42.245,"2001":43.786,"4001":44.233,"8001":45.525,"15001":46.221,
  "503":63.616,"1003":63.616,"2003":66.598,"504":38.269,"1004":38.269,"2004":39.76,
  "502":40.5,"1002":40.5,"2002":41.98,"2005":49.7,"4005":55.366};
const PMY = {"501":.91147,"502":.91147,"503":.91147,"504":.91147,"1001":.91087,"2001":.91157,
  "4001":.91197,"8001":.91217,"15001":1.004155,"1003":.90895,"2003":.91097,"1004":.91097,
  "2004":.91177,"1002":.91187,"2002":.91247,"2005":.90443,"4005":.91046};

const sub = (s, col, len) => s.substr(col - 1, len);

function parseTime(f){
  const m = String(f).trim().match(/^(?:(\d{1,2}):)?(\d{1,2})\.(\d{2})$/);
  if (!m) return null;
  return (m[1] ? +m[1] * 60 : 0) + +m[2] + +m[3] / 100;
}
function fmtTime(sec){
  let h = Math.round(sec * 100); const m = Math.floor(h / 6000); h -= m * 6000;
  const s = Math.floor(h / 100), hh = String(h % 100).padStart(2, "0");
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}.${hh}` : `${s}.${hh}`;
}

function splitLines(text){
  const out = []; const re = /([^\r\n]*)(\r\n|\n|\r|$)/g; let m;
  while ((m = re.exec(text))) { if (m[0] === "") break; out.push({body:m[1], eol:m[2]}); }
  return out;
}

/* Parse into lines (kept for rebuilding), time items and meet details. */
function parse(text){
  const lines = splitLines(text), items = [], meet = {};
  lines.forEach((ln, i) => {
    const s = ln.body, rec = s.slice(0, 2);
    if (rec === "A0") { meet.fileCode = sub(s, 12, 2); meet.desc = sub(s, 14, 30).trim(); meet.software = sub(s, 44, 20).trim(); }
    else if (rec === "B1") {
      meet.name = sub(s, 12, 30).trim(); meet.city = sub(s, 86, 20).trim();
      meet.start = sub(s, 122, 8); meet.end = sub(s, 130, 8);
      const c = sub(s, MEET_COURSE_COL, 1);
      meet.course = COURSE[c] || ""; meet.courseLine = i; meet.courseChar = c;
    }
    else if (rec === "C1") { const n = sub(s, 18, 30).trim() || sub(s, 12, 6).trim(); meet.team = meet.team ? `${meet.team}, ${n}` : n; }
    else if (LAYOUT[rec]) {
      const L = LAYOUT[rec], dist = parseInt(sub(s, L.dist, 4), 10) || 0, stroke = sub(s, L.stroke, 1);
      const who = rec === "D0" ? sub(s, 12, 28).trim() : `${sub(s, 13, 6).trim()} '${sub(s, 12, 1)}' relay`;
      L.t.forEach(([tc, cc], fi) => {
        if (s.length < cc) return;
        const raw = sub(s, tc, 8), codeChar = sub(s, cc, 1), course = COURSE[codeChar];
        if (!course && !raw.trim()) return;
        items.push({li:i, rec, fi, tc, cc, raw, secs:parseTime(raw), course:course || "?", codeChar,
          dist, stroke, who, relay:rec === "E0", event:`${dist} ${STROKE[stroke] || "?"}`,
          age: rec === "D0" ? sub(s, 64, 2).trim() : "", sex: rec === "D0" ? sub(s, 66, 1).trim() : sub(s, 21, 1).trim()});
      });
    }
  });
  return {lines, items, meet};
}

/* ---- Swim England equivalent-time formula ---- */
function toT50(T, src, dist, stroke){
  if (src === "LCM") return T;
  const k = `${dist}${stroke}`, tf = TF[k];
  const pm = src === "SCY" ? PMY[k] : 1, d1 = (src === "SCY" && dist === 1500) ? 1650 : dist;
  const N = (dist / 100) * (d1 / 100) * 2;
  return (T + Math.sqrt(T * T + 4 * pm * tf * N)) / (2 * pm);
}
function fromT50(T50, tgt, dist, stroke){
  if (tgt === "LCM") return T50;
  const k = `${dist}${stroke}`, tf = TF[k];
  const pm = tgt === "SCY" ? PMY[k] : 1, d1 = (tgt === "SCY" && dist === 1500) ? 1650 : dist;
  return T50 * pm - tf / T50 * (dist / 100) * (d1 / 100) * 2;
}
function standard(T, src, tgt, dist, stroke){
  if (!TF[`${dist}${stroke}`]) return {err:`no standard factor for ${dist} ${STROKE[stroke] || "event"}`};
  if ((src === "SCY" || tgt === "SCY") && stroke === "1" && (dist === 400 || dist === 800))
    return {err:"yard seed for 400/800 free is ambiguous (500/1000 yd)"};
  return {t: fromT50(toT50(T, src, dist, stroke), tgt, dist, stroke)};
}
/* Relays: four equal splits, each leg converted with its own stroke. */
function standardRelay(T, src, tgt, dist, stroke){
  const legs = stroke === "6" ? ["1","1","1","1"] : stroke === "7" ? ["2","3","4","1"] : null;
  if (!legs) return {err:"unknown relay stroke"};
  let sum = 0;
  for (const ls of legs) {
    const r = standard(T / 4, src, tgt, dist / 4, ls);
    if (r.err) return {err:`relay leg: ${r.err}`};
    sum += r.t;
  }
  return {t:sum};
}

/* Decide every change.
   o = {tgt:"LCM"|"SCM", method:"relabel"|"standard"|"custom",
        fields:[seed,prelim,swimoff,finals], srcs:{SCM:true,...},
        fac:{SCM:1.02,...}, off:secondsPer100, relays:bool, meet:bool} */
function plan(parsed, o){
  const changes = [], skipped = [];
  for (const it of parsed.items) {
    if (!o.fields[it.fi] || (it.relay && !o.relays)) continue;
    if (!CODE[it.course] || it.course === o.tgt || !o.srcs[it.course]) continue;
    let newSecs = it.secs, newRaw = it.raw;
    if (it.secs != null && o.method !== "relabel") {
      if (o.method === "standard") {
        const r = (it.relay ? standardRelay : standard)(it.secs, it.course, o.tgt, it.dist, it.stroke);
        if (r.err) { skipped.push({it, why:r.err}); continue; }
        newSecs = r.t;
      } else {
        const f = o.fac[it.course];
        if (!(f > 0)) { skipped.push({it, why:`no valid factor for ${it.course}`}); continue; }
        newSecs = it.secs * f + (o.off || 0) * (it.dist / 100);
      }
      newSecs = Math.round(newSecs * 100) / 100;
      const t = fmtTime(newSecs);
      if (t.length > 8) { skipped.push({it, why:"converted time does not fit the 8-character field"}); continue; }
      newRaw = t.padStart(8, " ");
    }
    changes.push({it, newSecs, newRaw, newCode: CODE[o.tgt][/[0-9]/.test(it.codeChar) ? 0 : 1]});
  }
  const m = parsed.meet; let meetChange = null;
  if (o.meet && m && m.course && m.course !== o.tgt && m.courseLine != null)
    meetChange = {li:m.courseLine, newCode: CODE[o.tgt][/[0-9]/.test(m.courseChar) ? 0 : 1]};
  return {changes, skipped, meetChange};
}

/* Apply a plan; returns the new file as a latin-1 string (one char per byte). */
function build(parsed, p){
  const rows = parsed.lines.map(l => l.body.split(""));
  for (const c of p.changes) {
    const r = rows[c.it.li];
    for (let j = 0; j < 8; j++) r[c.it.tc - 1 + j] = c.newRaw[j];
    r[c.it.cc - 1] = c.newCode;
  }
  if (p.meetChange) rows[p.meetChange.li][MEET_COURSE_COL - 1] = p.meetChange.newCode;
  let out = "";
  rows.forEach((r, i) => {
    const b = r.join("");
    if (b.length !== parsed.lines[i].body.length) throw new Error(`line length changed at line ${i + 1}`);
    out += b + parsed.lines[i].eol;
  });
  return out;
}

/* Pace slower than 4:00 or faster than 0:40 per 100: usually a typo. */
function isUnusual(it){
  if (it.relay || it.secs == null || !it.dist) return false;
  const pace = it.secs / (it.dist / 100);
  return pace > 240 || pace < 40;
}

/* Coach review: every entry in the chosen fields, with its original time, the
   same time relabeled to the target course, and the converted time. The
   converted column uses the custom factors when that method is chosen,
   otherwise the standard conversion. */
function review(parsed, o){
  const convMethod = o.method === "custom" ? "custom" : "standard";
  const rel = plan(parsed, {...o, method:"relabel"}), conv = plan(parsed, {...o, method:convMethod});
  const relMap = new Map(rel.changes.map(c => [c.it, c]));
  const convMap = new Map(conv.changes.map(c => [c.it, c]));
  const skipMap = new Map(conv.skipped.map(s => [s.it, s.why]));
  const rows = parsed.items.filter(it => o.fields[it.fi] && (o.relays || !it.relay)).map(it => {
    const r = relMap.get(it), c = convMap.get(it), skip = skipMap.get(it);
    const orig = {time: it.raw.trim() || "NT", course: CODE[it.course] ? it.course : ""};
    let status, relabeled, converted, delta = null;
    if (it.secs == null) status = "nt";
    else if (it.course === o.tgt) status = "same";
    else if (!CODE[it.course] || !o.srcs[it.course] || (it.relay && !o.relays)) status = "excluded";
    else if (skip) status = "skipped";
    else status = "change";
    relabeled = r ? {time: r.newRaw.trim() || "NT", course: o.tgt} : {...orig};
    if (c) { converted = {time: c.newRaw.trim() || "NT", course: o.tgt}; if (it.secs != null) delta = Math.round((c.newSecs - it.secs) * 100) / 100; }
    else if (skip) converted = null;
    else converted = {...orig};
    const notes = [];
    if (status === "same") notes.push(`already ${o.tgt}`);
    if (status === "nt") notes.push("no time");
    if (status === "excluded") notes.push("not converted (course not selected)");
    if (skip) notes.push(`no conversion: ${skip}`);
    if (isUnusual(it)) notes.push("check time: unusual pace");
    return {line: it.li + 1, who: it.who, age: it.age, sex: it.sex, relay: it.relay, event: it.event,
            field: FIELDS[it.fi], orig, relabeled, converted, delta, status, unusual: isUnusual(it), note: notes.join("; ")};
  });
  const count = s => rows.filter(r => r.status === s).length;
  return {rows, tgt: o.tgt, method: convMethod, fac: o.fac, off: o.off || 0, meetChange: !!rel.meetChange,
          counts: {total: rows.length, change: count("change"), same: count("same"), nt: count("nt"),
                   skipped: count("skipped"), excluded: count("excluded"), unusual: rows.filter(r => r.unusual).length}};
}

/* Review as CSV (UTF-8, comma separated, quoted where needed). */
function reviewCSV(rv){
  const q = v => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Line","Swimmer","Age","Sex","Event","Field","Original time","Original course",
    "Relabeled time","Relabeled course","Converted time","Converted course","Change (s)","Status","Note"];
  const out = [head.join(",")];
  for (const r of rv.rows) out.push([r.line, r.who, r.age, r.sex, r.event, r.field, r.orig.time, r.orig.course,
    r.relabeled.time, r.relabeled.course, r.converted ? r.converted.time : "", r.converted ? r.converted.course : "",
    r.delta == null ? "" : r.delta.toFixed(2), r.status, r.note].map(q).join(","));
  return out.join("\r\n") + "\r\n";
}

/* Built-in example file: a made-up team, safe to show. */
function sampleText(){
  const L = f => { const a = Array(160).fill(" "); for (const [c, v] of f) for (let i = 0; i < v.length; i++) a[c - 1 + i] = v[i]; return a.join("").replace(/\s+$/, ""); };
  const t = s => s.padStart(8, " ");
  const D = (name, dist, stroke, seed, c) => { const sx = /Marco|Luca/.test(name) ? "M" : "F"; return L([[1,"D01EF"],[12,name.padEnd(28)],[40,"000000SAMPLE"],[53,"ITA"],
    [56,"01012012"],[64,"14"],[66,sx],[67,sx],[68,String(dist).padStart(4)],[72,stroke],[73,"  1 "],[77,"1314"],
    [89,t(seed)],[97,seed.trim() ? c : " "]]); };
  return [
    L([[1,"A01V3"],[12,"01Meet Entries"],[44,"TeamUnify, LLC"],[64,"2.0"]]),
    L([[1,"B11"],[12,"Sample Autumn Long Course"],[86,"Vicenza"],[122,"1114202611152026"],[150,"L"]]),
    L([[1,"C11"],[12,"SMPL  Sample Aquatics"]]),
    D("Rossi, Giulia A",50,"1","29.84","S"),
    D("Rossi, Giulia A",100,"1","1:04.12","L"),
    D("Rossi, Giulia A",200,"5","2:31.40","S"),
    D("Bianchi, Marco T",100,"2","1:09.55","S"),
    D("Bianchi, Marco T",200,"2","2:31.02","L"),
    D("Bianchi, Marco T",100,"5","1:12.30","S"),
    D("Conti, Sofia L",100,"3","1:19.66","S"),
    D("Conti, Sofia L",200,"3","2:51.18","S"),
    D("Conti, Sofia L",400,"1","5:02.90","Y"),
    D("Greco, Luca P",100,"4","1:05.47","S"),
    D("Greco, Luca P",1500,"1","18:44.10","S"),
    D("Moretti, Anna V",200,"1","42:10.00","S"),
    L([[1,"E01EF"],[12,"ASMPL "],[19," 4"],[21,"F"],[22," 200"],[26,"6"],[27,"  9 "],[31,"1314"],[46,t("1:58.20")],[54,"S"]]),
    L([[1,"E01EF"],[12,"BSMPL "],[19," 4"],[21,"F"],[22," 200"],[26,"7"],[27," 10 "],[31,"1314"],[46,t("2:14.60")],[54,"L"]]),
    L([[1,"Z01"],[12,"Sample"]])
  ].join("\r\n") + "\r\n";
}

const api = {parse, plan, build, review, reviewCSV, isUnusual, standard, standardRelay, parseTime, fmtTime, sampleText,
             COURSE, CODE, STROKE, FIELDS, TF};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SD3Convert = api;
})(typeof window !== "undefined" ? window : globalThis);
