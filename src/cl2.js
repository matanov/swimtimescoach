/*
 * CL2 / SDIF v3 parser.
 * Hy-Tek .cl2 exports are USA Swimming SDIF v3 files: fixed-width 160-char
 * records. Positions below are the spec's 1-based start/length.
 * See docs/sdif-v3-notes.md.
 *
 * Works in the browser (window.CL2) and in Node (require) for tests.
 */
(function (root) {
"use strict";
/* ------------------------------------------------------------------ SDIF v3 parsing
   Positions are the spec's 1-based start/length (USA Swimming SDIF v3, 1998). */
const STROKES = {"1":"Free","2":"Back","3":"Breast","4":"Fly","5":"IM"};
const ROUND_ORDER = {"Prelim":1,"Swim-off":2,"Final":3};
const COURSES = {"1":"SCM","S":"SCM","2":"SCY","Y":"SCY","3":"LCM","L":"LCM"};
const COURSE_ORDER = {SCY:1,SCM:2,LCM:3,"?":4};
const TIME_RE = /^(?:(\d{1,2}):)?(\d{1,2})\.(\d{2})$/;

const f = (line, start, len) => line.substr(start - 1, len).trim();
const int = s => /^\d+$/.test(s) ? parseInt(s, 10) : null;
function sdifDate(s){
  if (!/^\d{8}$/.test(s)) return null;
  const m = +s.slice(0,2), d = +s.slice(2,4), y = +s.slice(4);
  if (!m || !d || !y || m > 12 || d > 31) return null;
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function parseTime(raw, courseCode, fallbackCourse){
  raw = raw.trim(); courseCode = (courseCode || "").trim();
  const t = {raw, cs:null, code:null, course: COURSES[courseCode] || fallbackCourse || null, dq: courseCode === "X"};
  if (!raw) return null;
  const m = raw.match(TIME_RE);
  if (m) t.cs = (+(m[1]||0))*6000 + (+m[2])*100 + (+m[3]);
  else { t.code = raw.toUpperCase(); if (t.code === "DQ") t.dq = true; }
  if (t.dq) t.cs = null;
  return t;
}
function fmt(cs){
  if (cs == null) return "";
  const m = Math.floor(cs/6000), r = cs % 6000, s = Math.floor(r/100), h = r % 100;
  return m ? `${m}:${String(s).padStart(2,"0")}.${String(h).padStart(2,"0")}` : `${s}.${String(h).padStart(2,"0")}`;
}
function splitName(name){
  let last = "", rest = [];
  if (name.includes(",")) { const i = name.indexOf(","); last = name.slice(0,i).trim(); rest = name.slice(i+1).trim().split(/\s+/).filter(Boolean); }
  else { rest = name.split(/\s+/).filter(Boolean); last = rest.pop() || ""; }
  let middle = "";
  if (rest.length > 1 && rest[rest.length-1].length === 1) middle = rest.pop();
  return {last, first: rest.join(" "), middle};
}
const norm = s => s.toUpperCase().replace(/[^A-Z]/g, "");

function parseCL2(text, fileLabel){
  const meet = {name:"", start:null, end:null, course:null, city:"", file:fileLabel};
  const teams = {};
  const swims = [];
  let team = "", lastSwimmer = null;
  const swimmersInFile = new Map();
  
  for (let line of text.split(/\r?\n/)) {
    if (line.length < 2 || !line.trim()) continue;
    line = line.padEnd(160);
    const rec = line.slice(0,2);
    if (rec === "B1") {
      meet.name = f(line,12,30); meet.city = f(line,86,20);
      meet.start = sdifDate(f(line,122,8)); meet.end = sdifDate(f(line,130,8)) || meet.start;
      meet.course = COURSES[f(line,150,1)] || null;
    } else if (rec === "C1") {
      team = f(line,12,6) + f(line,150,1);
      teams[team] = f(line,18,30) || team;
    } else if (rec === "D0") {
      const name = f(line,12,28);
      const dist = int(f(line,68,4)), stroke = f(line,72,1);
      const n = splitName(name);
      const sw = {name, ...n, uss: f(line,40,12), ussNew:"", pref:"", bdate: sdifDate(f(line,56,8)), sex: f(line,66,1)};
      // D3 follows a swimmer's first D0 only; share one object per swimmer per file
      const sk = norm(name) + "|" + sw.uss + "|" + team;
      const existing = swimmersInFile.get(sk);
      const swimmer = existing || sw;
      if (!existing) swimmersInFile.set(sk, sw);
      lastSwimmer = swimmer;
      if (!dist || !STROKES[stroke]) continue; // relay-only swimmer entry
      const base = {
        swimmer, team, teamName: teams[team] || team, age: int(f(line,64,2)),
        dist, stroke, eventNo: f(line,73,4), date: sdifDate(f(line,81,8)) || meet.start, meet
      };
      const rounds = [
        ["Prelim", parseTime(f(line,98,8), f(line,106,1), meet.course), int(f(line,133,3))],
        ["Swim-off", parseTime(f(line,107,8), f(line,115,1), meet.course), null],
        ["Final", parseTime(f(line,116,8), f(line,124,1), meet.course), int(f(line,136,3))],
      ];
      for (const [round, t, place] of rounds) {
        if (!t) continue;
        swims.push({...base, round, time:t, course: t.course || meet.course || "?", place});
      }
    } else if (rec === "D3") {
      if (lastSwimmer) { lastSwimmer.ussNew = f(line,3,14); lastSwimmer.pref = f(line,17,15); }
    }
  }
  return {meet, teams, swims};
}

/* ------------------------------------------------------------------ across files */
const bestOf = list => list.filter(s => s.time.cs != null).reduce((b,s) => (!b || s.time.cs < b.time.cs) ? s : b, null);
const bySwimOrder = (a,b) => (a.date||"").localeCompare(b.date||"") || ROUND_ORDER[a.round] - ROUND_ORDER[b.round];

// Identity: normalized name; split same-name swimmers only if their USS IDs differ.
// Sets s.pkey on every swim and returns key -> person.
function assignPeople(swims){
  const byName = new Map();
  for (const s of swims) {
    const nk = norm(s.swimmer.last) + "|" + norm(s.swimmer.first);
    if (!byName.has(nk)) byName.set(nk, new Set());
    if (s.swimmer.ussNew) byName.get(nk).add(s.swimmer.ussNew.toUpperCase());
  }
  const people = new Map();
  for (const s of swims) {
    const nk = norm(s.swimmer.last) + "|" + norm(s.swimmer.first);
    const key = byName.get(nk).size > 1 ? nk + "|" + (s.swimmer.ussNew.toUpperCase() || "?") : nk;
    s.pkey = key;
    let p = people.get(key);
    if (!p) { p = {key, last:s.swimmer.last, first:s.swimmer.pref || s.swimmer.first, teams:new Set(), sex:s.swimmer.sex, count:0, lastAge:null, lastDate:""}; people.set(key, p); }
    p.teams.add(s.teamName); p.count++;
    if (s.swimmer.pref) p.first = s.swimmer.pref;
    if ((s.date||"") >= p.lastDate) { p.lastDate = s.date || ""; p.lastAge = s.age; }
  }
  return people;
}

// Different meets can share a name (the same invitational every year, or two
// clubs' "Winter Open" on one weekend). They stay separate meets; this sets
// meet.label so they can be told apart: the name alone if unique, else the
// first of year, date, city, or file name that distinguishes it.
// meet.datedLabel is for lists that print the date next to it anyway.
function labelMeets(meets){
  const groups = new Map();
  for (const m of meets) {
    // unlike norm(), keeps digits: "Meet 1" and "Meet 2" are different names
    const k = (m.name || m.file).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const tags = [m => (m.start||"").slice(0,4), m => m.start || "", m => m.city, m => m.file];
  for (const group of groups.values()) {
    for (const m of group) {
      const name = m.name || m.file;
      m.label = m.datedLabel = name;
      if (group.length === 1) continue;
      const i = tags.findIndex(t => t(m) && group.filter(o => t(o) === t(m)).length === 1);
      const tag = tags[i < 0 ? tags.length-1 : i](m);
      m.label = `${name} (${tag})`;
      if (i > 1 || i < 0) m.datedLabel = m.label;
    }
  }
  return meets;
}

/* ------------------------------------------------------------------ event view
   One column per event across all courses. Free distances that differ
   between yards and meters share a column (500Y with 400M, ...). */
const YARDS_TO_METERS = {500:400, 1000:800, 1650:1500};
const COURSE_LETTER = {SCY:"Y", SCM:"S", LCM:"L", "?":"?"};   // Hy-Tek's suffixes

const pairedDist = s => (s.stroke === "1" && s.course === "SCY" && YARDS_TO_METERS[s.dist]) || s.dist;
// Named after the distances actually swum in the column: "400 Free" for a
// meters-only team, "500 Free" for yards only, "400/500 Free" for both.
const columnLabel = (dists, stroke) => `${[...new Set(dists)].sort((a,b) => a - b).join("/")} ${STROKES[stroke]}`;

// Yards and meters times can't be compared, so each course keeps its own best:
// short = SCY, SCM, unknown (in that order); long = LCM. best is null when
// the course has swims but none with a valid time (DQ, NS, ...).
function courseBests(list){
  const out = {short: [], long: []};
  for (const course of ["SCY", "SCM", "?", "LCM"]) {
    const swims = list.filter(s => s.course === course);
    if (swims.length) (course === "LCM" ? out.long : out.short)
      .push({course, letter: COURSE_LETTER[course], best: bestOf(swims), swims});
  }
  return out;
}

/* ------------------------------------------------------------------ sharing
   A shared file carries only the chosen swimmers: their D0/D3 records, plus
   the meet (B1) record and the team (C1) records of teams they swim for.
   Relays, splits, contacts and every other swimmer are left out. keys are
   person keys from assignPeople; a same-name swimmer split by USS ID is kept
   with its namesake. Returns "" when none of them swam an individual event. */
function trimToSwimmers(text, keys){
  const names = new Set([...keys].map(k => k.split("|").slice(0, 2).join("|")));
  const out = [];
  let team = null, keepD3 = false, swims = 0;
  for (const raw of text.split(/\r?\n/)) {
    const rec = raw.slice(0, 2), line = raw.padEnd(160);
    if (rec === "B1") out.push(raw);
    else if (rec === "C1") team = raw;
    else if (rec === "D0") {
      const n = splitName(f(line, 12, 28));
      keepD3 = names.has(norm(n.last) + "|" + norm(n.first));
      if (!keepD3) continue;
      if (team) { out.push(team); team = null; }
      out.push(raw);
      if (int(f(line, 68, 4))) swims++;
    } else if (rec === "D3" && keepD3) out.push(raw);
  }
  return swims ? out.join("\r\n") + "\r\n" : "";
}

const api = { parseCL2, parseTime, fmt, splitName, sdifDate, norm,
              bestOf, bySwimOrder, assignPeople, labelMeets,
              pairedDist, columnLabel, courseBests, trimToSwimmers,
              STROKES, ROUND_ORDER, COURSES, COURSE_ORDER, COURSE_LETTER };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.CL2 = api;
})(typeof window !== "undefined" ? window : globalThis);
